// Access-token signing and secret sealing (ADR-0021 "Tokens and keys").
// In AWS both use KMS keys; locally and in tests a PEM key and an AES key from
// configuration. Each pair sits behind one interface.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  randomBytes,
  sign,
} from "node:crypto";
import {
  DecryptCommand,
  EncryptCommand,
  GetPublicKeyCommand,
  KMSClient,
  SignCommand,
} from "@aws-sdk/client-kms";
import type { Config } from "../config.ts";

export interface Jwk {
  readonly kty: string;
  readonly kid: string;
  readonly [key: string]: unknown;
}

export interface TokenSigner {
  readonly keyId: string;
  /** ES256 signature (IEEE P-1363, r‖s) over the JWS signing input. */
  sign(signingInput: string): Promise<Buffer>;
  publicKey(): Promise<KeyObject>;
  jwks(): Promise<Jwk[]>;
}

export interface SecretSealer {
  seal(plaintext: Buffer, context: string): Promise<Buffer>;
  open(sealed: Buffer, context: string): Promise<Buffer>;
}

function jwkOf(key: KeyObject, kid: string): Jwk {
  const jwk = key.export({ format: "jwk" }) as Record<string, unknown>;
  return { ...jwk, kty: String(jwk.kty), kid, alg: "ES256", use: "sig" };
}

export class LocalSigner implements TokenSigner {
  private readonly privateKey: KeyObject;
  private readonly publicKeyObject: KeyObject;

  constructor(
    pem: string,
    readonly keyId: string,
  ) {
    this.privateKey = createPrivateKey(pem);
    if (
      this.privateKey.asymmetricKeyType !== "ec" ||
      this.privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    )
      throw new Error("JWT_PRIVATE_KEY_PEM must be a P-256 EC private key (ES256)");
    this.publicKeyObject = createPublicKey(this.privateKey);
  }

  async sign(signingInput: string): Promise<Buffer> {
    return sign("sha256", Buffer.from(signingInput), { key: this.privateKey, dsaEncoding: "ieee-p1363" });
  }

  async publicKey(): Promise<KeyObject> {
    return this.publicKeyObject;
  }

  async jwks(): Promise<Jwk[]> {
    return [jwkOf(this.publicKeyObject, this.keyId)];
  }
}

/** DER ECDSA signature (KMS output) → IEEE P-1363 r‖s, 32 bytes each (JWS ES256). */
export function derToP1363(der: Buffer): Buffer {
  let offset = 2;
  if (der[0] !== 0x30) throw new Error("Not a DER ECDSA signature");
  if ((der[1] ?? 0) & 0x80) offset += (der[1] ?? 0) & 0x7f;
  const readInt = (): Buffer => {
    if (der[offset] !== 0x02) throw new Error("Not a DER ECDSA signature");
    const length = der[offset + 1] ?? 0;
    const value = der.subarray(offset + 2, offset + 2 + length);
    offset += 2 + length;
    const trimmed = value[0] === 0 ? value.subarray(1) : value;
    if (trimmed.length > 32) throw new Error("ECDSA integer too long for P-256");
    return Buffer.concat([Buffer.alloc(32 - trimmed.length), trimmed]);
  };
  const r = readInt();
  const s = readInt();
  return Buffer.concat([r, s]);
}

export class KmsSigner implements TokenSigner {
  private cachedKey: KeyObject | undefined;

  constructor(
    private readonly kms: KMSClient,
    private readonly kmsKeyId: string,
    readonly keyId: string,
  ) {}

  async sign(signingInput: string): Promise<Buffer> {
    const digest = createHash("sha256").update(signingInput).digest();
    const out = await this.kms.send(
      new SignCommand({
        KeyId: this.kmsKeyId,
        Message: digest,
        MessageType: "DIGEST",
        SigningAlgorithm: "ECDSA_SHA_256",
      }),
    );
    if (out.Signature === undefined) throw new Error("KMS returned no signature");
    return derToP1363(Buffer.from(out.Signature));
  }

  async publicKey(): Promise<KeyObject> {
    if (this.cachedKey === undefined) {
      const out = await this.kms.send(new GetPublicKeyCommand({ KeyId: this.kmsKeyId }));
      if (out.PublicKey === undefined) throw new Error("KMS returned no public key");
      this.cachedKey = createPublicKey({ key: Buffer.from(out.PublicKey), format: "der", type: "spki" });
    }
    return this.cachedKey;
  }

  async jwks(): Promise<Jwk[]> {
    return [jwkOf(await this.publicKey(), this.keyId)];
  }
}

/** AES-256-GCM with the context as associated data: `iv(12) ‖ tag(16) ‖ ciphertext`. */
export class LocalSealer implements SecretSealer {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("SECRET_SEAL_KEY must be 32 bytes");
  }

  async seal(plaintext: Buffer, context: string): Promise<Buffer> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  async open(sealed: Buffer, context: string): Promise<Buffer> {
    const decipher = createDecipheriv("aes-256-gcm", this.key, sealed.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(sealed.subarray(12, 28));
    return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
  }
}

/** KMS Encrypt/Decrypt with the context as the encryption context. Seeds are far below the 4 KB limit. */
export class KmsSealer implements SecretSealer {
  constructor(
    private readonly kms: KMSClient,
    private readonly kmsKeyId: string,
  ) {}

  async seal(plaintext: Buffer, context: string): Promise<Buffer> {
    const out = await this.kms.send(
      new EncryptCommand({
        KeyId: this.kmsKeyId,
        Plaintext: plaintext,
        EncryptionContext: { purpose: context },
      }),
    );
    if (out.CiphertextBlob === undefined) throw new Error("KMS returned no ciphertext");
    return Buffer.from(out.CiphertextBlob);
  }

  async open(sealed: Buffer, context: string): Promise<Buffer> {
    const out = await this.kms.send(
      new DecryptCommand({
        KeyId: this.kmsKeyId,
        CiphertextBlob: sealed,
        EncryptionContext: { purpose: context },
      }),
    );
    if (out.Plaintext === undefined) throw new Error("KMS returned no plaintext");
    return Buffer.from(out.Plaintext);
  }
}

export function createSigner(config: Config): TokenSigner {
  if (config.JWT_SIGNER === "kms")
    return new KmsSigner(
      new KMSClient({ region: config.AWS_REGION }),
      config.JWT_KMS_KEY_ID ?? "",
      config.JWT_KEY_ID,
    );
  return new LocalSigner(config.JWT_PRIVATE_KEY_PEM ?? "", config.JWT_KEY_ID);
}

export function createSealer(config: Config): SecretSealer {
  if (config.SECRET_SEALER === "kms")
    return new KmsSealer(new KMSClient({ region: config.AWS_REGION }), config.SECRET_KMS_KEY_ID ?? "");
  return new LocalSealer(Buffer.from(config.SECRET_SEAL_KEY ?? "", "base64").subarray(0, 32));
}
