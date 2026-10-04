// Allowed upload formats: photos (spec §6.1.9; ADR-0023 K2-02) and documents
// (ADR-0026 K3-16). The declared type is checked against the file's first
// bytes at completion, so a mislabelled or polyglot upload never reaches a
// decoder as the type it claims.
import type { DOCUMENT_CONTENT_TYPES, PHOTO_CONTENT_TYPES } from "@aestara/api-contracts";

export type PhotoContentType = (typeof PHOTO_CONTENT_TYPES)[number];
type UploadContentType = PhotoContentType | (typeof DOCUMENT_CONTENT_TYPES)[number];

const SIGNATURES: Record<UploadContentType, readonly number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  // "%PDF-"
  "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d],
};

export function matchesSignature(contentType: string, firstBytes: Buffer): boolean {
  const signature = SIGNATURES[contentType as UploadContentType];
  return signature?.every((byte, i) => firstBytes[i] === byte) ?? false;
}

/** The file extension used in download names; names never carry PHI. */
export function extensionFor(contentType: string): string {
  return contentType === "image/png" ? "png" : "jpg";
}
