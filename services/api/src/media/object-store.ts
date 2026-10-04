// Private object storage (spec §6.1.9, §7.4; Bible §6.6, §21.2; ADR-0023 K2-03,
// K2-09). Keys are `{objectClass}/{UUIDv7}`: opaque, with no tenant, patient or
// PHI, and never returned by the API. Uploads are presigned PUTs that S3 checks
// against the declared SHA-256 and refuses when the key already exists
// (If-None-Match: *), so an object is written once. Downloads are presigned GETs
// marked private and no-store.
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { uuidv7 } from "@aestara/database";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Inject, Injectable } from "@nestjs/common";
import { AwsClients } from "../aws/clients.ts";
import { ApiError } from "../common/errors.ts";
import { CONFIG, type Config } from "../config.ts";

export type ObjectClass = "CLINICAL_ORIGINAL" | "CLINICAL_DERIVATIVE" | "DOCUMENT";

/** Presigned URL lifetimes (spec §6.1.9). */
export const UPLOAD_URL_SECONDS = 600;
export const VIEW_URL_SECONDS = 120;

export interface SignedRequest {
  readonly url: string;
  readonly expiresAt: Date;
  readonly headers: Record<string, string>;
}

export interface StoredObject {
  readonly byteSize: number;
  readonly contentType: string | undefined;
  /** Base64 SHA-256 that S3 verified on upload, when the store records one. */
  readonly sha256Base64: string | undefined;
}

export const hexToBase64 = (hex: string): string => Buffer.from(hex, "hex").toString("base64");

function storageUnavailable(): ApiError {
  return new ApiError("SERVICE_UNAVAILABLE", "Photo storage is temporarily unavailable.", undefined, {
    "Retry-After": "5",
  });
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

@Injectable()
export class ObjectStore {
  readonly bucket: string;

  constructor(
    private readonly aws: AwsClients,
    @Inject(CONFIG) private readonly config: Pick<Config, "MEDIA_BUCKET" | "MEDIA_KMS_KEY_ID">,
  ) {
    this.bucket = config.MEDIA_BUCKET;
  }

  newKey(objectClass: ObjectClass): string {
    return `${objectClass}/${uuidv7()}`;
  }

  get kmsKeyId(): string | null {
    return this.config.MEDIA_KMS_KEY_ID ?? null;
  }

  /** A presigned PUT of exactly these bytes to a key that must not exist yet. */
  async presignUpload(input: {
    key: string;
    contentType: string;
    sha256Hex?: string;
    now?: Date;
  }): Promise<SignedRequest> {
    const checksum = input.sha256Hex === undefined ? undefined : hexToBase64(input.sha256Hex);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
      IfNoneMatch: "*",
      ...(checksum !== undefined ? { ChecksumSHA256: checksum } : {}),
    });
    const signed = [
      "content-type",
      "if-none-match",
      ...(checksum !== undefined ? ["x-amz-checksum-sha256"] : []),
    ];
    try {
      const url = await getSignedUrl(this.aws.presigner, command, {
        expiresIn: UPLOAD_URL_SECONDS,
        signableHeaders: new Set(signed),
        unhoistableHeaders: new Set(signed),
      });
      const now = input.now ?? new Date();
      return {
        url,
        expiresAt: new Date(now.getTime() + UPLOAD_URL_SECONDS * 1000),
        headers: {
          "Content-Type": input.contentType,
          "If-None-Match": "*",
          ...(checksum !== undefined ? { "x-amz-checksum-sha256": checksum } : {}),
        },
      };
    } catch {
      throw storageUnavailable();
    }
  }

  /** A presigned GET, private and never cached; the file name carries no PHI. */
  async presignDownload(input: {
    key: string;
    contentType: string;
    fileName: string;
    seconds?: number;
    disposition?: "inline" | "attachment";
    now?: Date;
  }): Promise<{ url: string; expiresAt: Date }> {
    const seconds = input.seconds ?? VIEW_URL_SECONDS;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ResponseCacheControl: "private, no-store",
      ResponseContentDisposition: `${input.disposition ?? "inline"}; filename="${input.fileName}"`,
      ResponseContentType: input.contentType,
    });
    try {
      const url = await getSignedUrl(this.aws.presigner, command, { expiresIn: seconds });
      const now = input.now ?? new Date();
      return { url, expiresAt: new Date(now.getTime() + seconds * 1000) };
    } catch {
      throw storageUnavailable();
    }
  }

  /** Size, type and verified checksum of a stored object; undefined when nothing was uploaded. */
  async head(key: string): Promise<StoredObject | undefined> {
    try {
      const out = await this.aws.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key, ChecksumMode: "ENABLED" }),
      );
      return {
        byteSize: Number(out.ContentLength ?? -1),
        contentType: out.ContentType,
        sha256Base64: out.ChecksumSHA256?.split("-")[0],
      };
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw storageUnavailable();
    }
  }

  /** The first bytes of an object, for the file-type check. */
  async firstBytes(key: string, count = 16): Promise<Buffer> {
    try {
      const out = await this.aws.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${count - 1}` }),
      );
      return Buffer.from((await out.Body?.transformToByteArray()) ?? []).subarray(0, count);
    } catch {
      throw storageUnavailable();
    }
  }

  /** SHA-256 (hex) computed by reading the object, for stores that record none (the emulator). */
  async sha256Hex(key: string): Promise<string> {
    try {
      const out = await this.aws.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const hash = createHash("sha256");
      for await (const chunk of out.Body as Readable) hash.update(chunk as Buffer);
      return hash.digest("hex");
    } catch {
      throw storageUnavailable();
    }
  }

  /** Reads a whole small object (derivatives, scan inputs). */
  async read(key: string, maxBytes: number): Promise<Buffer> {
    try {
      const out = await this.aws.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of out.Body as Readable) {
        total += (chunk as Buffer).length;
        if (total > maxBytes) throw new Error("object larger than expected");
        chunks.push(chunk as Buffer);
      }
      return Buffer.concat(chunks);
    } catch {
      throw storageUnavailable();
    }
  }

  /** Writes a file the platform generated to the media bucket, once (a consultation summary). */
  async writeNew(key: string, body: Buffer, contentType: string): Promise<void> {
    try {
      await this.putNew(this.bucket, key, body, contentType);
    } catch {
      throw storageUnavailable();
    }
  }

  /** Writes an object that must not exist yet (the worker's archive and the local scanner's fixtures). */
  async putNew(bucket: string, key: string, body: Buffer, contentType: string): Promise<void> {
    await this.aws.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        IfNoneMatch: "*",
        ChecksumSHA256: createHash("sha256").update(body).digest("base64"),
      }),
    );
  }
}
