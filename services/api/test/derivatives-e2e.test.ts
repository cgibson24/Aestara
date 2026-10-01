// Derivatives with the real image-processing service (ADR-0023 K2-01, K2-06;
// Bible §29 "a standard photo session works end to end"). photos.test.ts plays
// image-processing itself; here the Python service runs as its own process
// against the same emulated S3 and SQS, so every hop is real: upload, scan,
// relay, dispatch, rendering, verification and signed viewing.
// Runs when TEST_IMAGE_PROCESSING=1 (CI sets it; it needs uv and
// services/image-processing synced), alongside the database tests.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AwsClients } from "../src/aws/clients.ts";
import type { Worker } from "../src/worker/module.ts";
import { OutboxRelay } from "../src/worker/relay.ts";
import { databaseAvailable, startApi, startWorker, type TestApi } from "./support/app.ts";
import { bearer, Fixtures, type StaffMember } from "./support/fixtures.ts";

const SERVICE_DIR = resolve(import.meta.dirname, "../../image-processing");
const enabled = databaseAvailable() && process.env.TEST_IMAGE_PROCESSING === "1";

/** A synthetic 2400 x 1800 JPEG stored sideways (EXIF orientation 6), made by libvips. */
function sourceJpeg(): Buffer {
  const script = [
    "import sys, pyvips",
    "x = pyvips.Image.xyz(2400, 1800)",
    "img = (x[0] * 255 / 2400).cast('uchar').bandjoin([(x[1] * 255 / 1800).cast('uchar'), (x[0] % 256).cast('uchar')])",
    "img = img.copy(interpretation='srgb')",
    "img.set_type(pyvips.GValue.gint_type, 'orientation', 6)",
    "sys.stdout.buffer.write(img.jpegsave_buffer(Q=90))",
  ].join("\n");
  return execFileSync(
    "uv",
    ["run", "--frozen", "--no-dev", "--project", SERVICE_DIR, "python", "-c", script],
    {
      maxBuffer: 64 * 1024 * 1024,
    },
  );
}

describe.runIf(enabled)("derivatives through the real image-processing service", () => {
  let api: TestApi;
  let worker: Worker;
  let service: ChildProcess;
  let org: string;
  let patient: string;
  let photographer: StaffMember;
  let faceProtocol: string;

  const call = (method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    api.request({
      method: method as "GET",
      url: `/api/v1${url}`,
      headers: { ...bearer(photographer), ...headers },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });

  beforeAll(async () => {
    api = await startApi();
    worker = await startWorker(api);
    const fx = new Fixtures(api);
    org = await fx.organization();
    patient = await fx.patient(org);
    photographer = await fx.staff(org, "PHOTOGRAPHER");
    await api.db.query("SELECT app_seed_standard_protocols($1::uuid)", [org]);
    const protocols = await call("GET", "/photography-protocols");
    faceProtocol = protocols.json().data.find((p: { name: string }) => p.name === "Face").id;
    service = spawn(
      "uv",
      ["run", "--frozen", "--no-dev", "--project", SERVICE_DIR, "python", "-m", "aestara_image_processing"],
      {
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          APP_ENV: "test",
          AWS_ENDPOINT_URL: api.aws.endpoint,
          IMAGE_JOBS_QUEUE_URL: api.aws.queues.imageJobs,
          IMAGE_RESULTS_QUEUE_URL: api.aws.queues.imageResults,
          HEARTBEAT_FILE: join(mkdtempSync(join(tmpdir(), "aestara-ip-")), "heartbeat"),
          LOG_LEVEL: "warning",
        },
        stdio: ["ignore", "ignore", "inherit"],
        // Its own process group, so the consumer and its sandbox children stop together.
        detached: true,
      },
    );
  });
  afterAll(async () => {
    if (service?.pid !== undefined && service.exitCode === null) {
      const exited = new Promise((done) => service.once("exit", done));
      process.kill(-service.pid, "SIGKILL");
      await exited;
    }
    await worker?.stop();
    await api?.close();
  });

  it("renders upright, metadata-free derivatives that the api verifies and serves", async () => {
    const original = sourceJpeg();
    const session = await call(
      "POST",
      `/patients/${patient}/photo-sessions`,
      { protocolId: faceProtocol },
      { "idempotency-key": crypto.randomUUID() },
    );
    const intent = await call(
      "POST",
      `/patients/${patient}/photos/uploads`,
      {
        photoSessionId: session.json().data.id,
        viewKey: "FRONT",
        contentType: "image/jpeg",
        byteSize: original.length,
        sha256: createHash("sha256").update(original).digest("hex"),
        capturedAt: new Date().toISOString(),
      },
      { "idempotency-key": crypto.randomUUID() },
    );
    expect(intent.statusCode, intent.body).toBe(201);
    const { photoId, upload } = intent.json().data;
    expect((await fetch(upload.url, { method: "PUT", headers: upload.headers, body: original })).status).toBe(
      200,
    );
    const completed = await call(
      "POST",
      `/patients/${patient}/photos/${photoId}/complete-upload`,
      undefined,
      {
        "idempotency-key": crypto.randomUUID(),
      },
    );
    expect(completed.statusCode, completed.body).toBe(200);

    // Scan, accept, relay and dispatch; then the service renders and the worker records.
    await worker.consumer("scan-requests").pollOnce(1);
    await worker.consumer("scan-results").pollOnce(1);
    await worker.context.get(OutboxRelay).relayOnce();
    await worker.consumer("worker-events").pollOnce(1);
    let photo:
      | { derivatives: { kind: string; status: string; widthPx?: number; heightPx?: number }[] }
      | undefined;
    for (let i = 0; i < 60; i++) {
      await worker.consumer("image-results").pollOnce(1);
      photo = (await call("GET", `/patients/${patient}/photos/${photoId}`)).json().data;
      if (photo?.derivatives.every((d) => d.status !== "PENDING")) break;
    }
    expect(photo?.derivatives).toEqual([
      { kind: "THUMBNAIL", status: "AVAILABLE", widthPx: 300, heightPx: 400 },
      { kind: "DISPLAY_PREVIEW", status: "AVAILABLE", widthPx: 1536, heightPx: 2048 },
    ]);

    const job = await api.db.query(
      `SELECT status, "resultSummary" FROM "AIJob" WHERE "jobType" = 'IMAGE_DERIVATIVE' AND "inputSummary"->>'photoId' = $1`,
      [photoId],
    );
    expect(job.rows[0].status).toBe("SUCCEEDED");
    const meta = await api.db.query(
      `SELECT d."generationMetadata" AS meta FROM "PhotoDerivative" d WHERE d."sourcePhotoId" = $1 AND d.kind = 'THUMBNAIL'`,
      [photoId],
    );
    expect(meta.rows[0].meta).toMatchObject({
      generator: "aestara-image-processing",
      metadataStripped: true,
    });
    expect(meta.rows[0].meta.generatorVersion).toMatch(/\+libvips\./);

    const url = await call("POST", `/patients/${patient}/photos/${photoId}/access-urls`, {
      variant: "THUMBNAIL",
    });
    expect(url.statusCode, url.body).toBe(201);
    const thumbnail = Buffer.from(await (await fetch(url.json().data.url)).arrayBuffer());
    expect(thumbnail.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(thumbnail.includes(Buffer.from("Exif\0\0"))).toBe(false);

    // The original is unchanged (read from the bucket: ORIGINAL bytes need photo.export).
    const key = await api.db.query(
      `SELECT s."objectKey" FROM "PatientPhoto" p JOIN "StorageObject" s ON s.id = p."originalObjectId" WHERE p.id = $1`,
      [photoId],
    );
    const stored = await worker.context
      .get(AwsClients)
      .s3.send(new GetObjectCommand({ Bucket: api.aws.mediaBucket, Key: key.rows[0].objectKey }));
    expect(Buffer.from((await stored.Body?.transformToByteArray()) ?? []).equals(original)).toBe(true);
  }, 120_000);
});
