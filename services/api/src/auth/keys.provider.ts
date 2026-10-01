// Nest providers for keys and token codecs, all derived from configuration.
import type { Provider } from "@nestjs/common";
import { deriveKey } from "../common/crypto.ts";
import { CursorCodec } from "../common/cursor.ts";
import { CONFIG, type Config } from "../config.ts";
import { createSealer, createSigner, type TokenSigner } from "./keys.ts";
import { AccessTokens, RefreshTokens } from "./tokens.ts";

export interface ServerKeys {
  /** HMAC key for the lockout identifier hash (ADR-0021). */
  readonly identifier: Buffer;
  readonly refresh: Buffer;
  readonly cursor: Buffer;
}

export const KEYS = Symbol("KEYS");
export const SEALER = Symbol("SEALER");
export const SIGNER = Symbol("SIGNER");

export const keyProviders: Provider[] = [
  {
    provide: KEYS,
    inject: [CONFIG],
    useFactory: (config: Config): ServerKeys => ({
      identifier: deriveKey(config.API_SECRET_KEY, "login-identifier"),
      refresh: deriveKey(config.API_SECRET_KEY, "refresh-token"),
      cursor: deriveKey(config.API_SECRET_KEY, "cursor"),
    }),
  },
  { provide: SIGNER, inject: [CONFIG], useFactory: (config: Config) => createSigner(config) },
  { provide: SEALER, inject: [CONFIG], useFactory: (config: Config) => createSealer(config) },
  { provide: AccessTokens, inject: [SIGNER], useFactory: (signer: TokenSigner) => new AccessTokens(signer) },
  {
    provide: RefreshTokens,
    inject: [KEYS],
    useFactory: (keys: ServerKeys) => new RefreshTokens(keys.refresh),
  },
  { provide: CursorCodec, inject: [KEYS], useFactory: (keys: ServerKeys) => new CursorCodec(keys.cursor) },
];
