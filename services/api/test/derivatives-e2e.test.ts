// Derivatives and registration with the real image-processing service
// (ADR-0023 K2-01, K2-06; ADR-0026 K3-13; Bible §29 "a standard photo session
// works end to end"). photos.test.ts and before-after.test.ts play
// image-processing themselves; here the Python service runs as its own process
// against the same emulated S3 and SQS, so every hop is real: upload, scan,
// relay, dispatch, rendering, verification, signed viewing and alignment.
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

/**
 * A synthetic textured JPEG (shapes on a plain ground, made by OpenCV), turned
 * clockwise by `turn` degrees about its centre: features for registration.
 */
function texturedJpeg(turn: number): Buffer {
  const script = [
    "import sys, cv2, numpy as np",
    "rng = np.random.default_rng(7)",
    "img = np.full((1600, 1200, 3), 200, np.uint8)",
    "for _ in range(500):",
    "    x, y, r = int(rng.integers(0, 1200)), int(rng.integers(0, 1600)), int(rng.integers(6, 50))",
    "    c = tuple(int(v) for v in rng.integers(0, 255, 3))",
    "    cv2.circle(img, (x, y), r, c, -1) if rng.random() < 0.5 else cv2.rectangle(img, (x, y), (x + r, y + r // 2), c, -1)",
    `m = cv2.getRotationMatrix2D((600, 800), ${-turn}, 1.0)`,
    "img = cv2.warpAffine(img, m, (1200, 1600), borderValue=(200, 200, 200))",
    "sys.stdout.buffer.write(cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 90])[1].tobytes())",
  ].join("\n");
  return execFileSync(
    "uv",
    ["run", "--frozen", "--no-dev", "--project", SERVICE_DIR, "python", "-c", script],
    { maxBuffer: 64 * 1024 * 1024 },
  );
}

describe.runIf(enabled)("derivatives and registration through the real image-processing service", () => {
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

  it("aligns a before/after pair from the rendered previews", async () => {
    const fx = new Fixtures(api);
    const surgeon = await fx.staff(org, "SURGEON_PHYSICIAN");
    const as = (who: StaffMember, method: string, url: string, payload?: unknown, headers = {}) =>
      api.request({
        method: method as "GET",
        url: `/api/v1${url}`,
        headers: { ...bearer(who), ...headers },
        ...(payload !== undefined ? { payload: payload as object } : {}),
      });
    const idem = () => ({ "idempotency-key": crypto.randomUUID() });
    async function photoOf(bytes: Buffer, capturedAt: Date): Promise<string> {
      // Each photo in its own session, started when it was taken.
      const session = await as(
        photographer,
        "POST",
        `/patients/${patient}/photo-sessions`,
        { protocolId: faceProtocol, startedAt: capturedAt.toISOString() },
        idem(),
      );
      const intent = await as(
        photographer,
        "POST",
        `/patients/${patient}/photos/uploads`,
        {
          photoSessionId: session.json().data.id,
          viewKey: "FRONT",
          contentType: "image/jpeg",
          byteSize: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          capturedAt: capturedAt.toISOString(),
        },
        idem(),
      );
      const { photoId, upload } = intent.json().data;
      await fetch(upload.url, { method: "PUT", headers: upload.headers, body: bytes });
      await as(
        photographer,
        "POST",
        `/patients/${patient}/photos/${photoId}/complete-upload`,
        undefined,
        idem(),
      );
      return photoId;
    }

    const before = await photoOf(texturedJpeg(0), new Date(Date.now() - 86_400_000));
    const after = await photoOf(texturedJpeg(5), new Date());
    for (let i = 0; i < 4; i++) {
      await worker.consumer("scan-requests").pollOnce(1);
      await worker.consumer("scan-results").pollOnce(1);
    }
    await worker.context.get(OutboxRelay).relayOnce();
    await worker.consumer("worker-events").pollOnce(1);
    await worker.consumer("worker-events").pollOnce(1);
    for (let i = 0; i < 60; i++) {
      await worker.consumer("image-results").pollOnce(1);
      const ready = await api.db.query(
        `SELECT count(*)::int AS n FROM "PhotoDerivative" WHERE "sourcePhotoId" = ANY($1) AND kind = 'DISPLAY_PREVIEW'`,
        [[before, after]],
      );
      if (ready.rows[0].n === 2) break;
    }

    const set = await as(
      surgeon,
      "POST",
      `/patients/${patient}/before-after`,
      { beforePhotoId: before, afterPhotoId: after },
      idem(),
    );
    expect(set.statusCode, set.body).toBe(201);
    const setId = set.json().data.id;
    const queued = await as(
      surgeon,
      "POST",
      `/patients/${patient}/before-after/${setId}/auto-registration`,
      undefined,
      idem(),
    );
    expect(queued.statusCode, queued.body).toBe(202);
    await worker.context.get(OutboxRelay).relayOnce();
    await worker.consumer("worker-events").pollOnce(1);
    let aligned:
      | { registrationMode: string; registrationTransform?: { rotationDeg: number; scale: number } }
      | undefined;
    for (let i = 0; i < 60; i++) {
      await worker.consumer("image-results").pollOnce(1);
      aligned = (await as(surgeon, "GET", `/patients/${patient}/before-after/${setId}`)).json().data;
      if (aligned?.registrationMode === "AUTOMATIC") break;
    }
    expect(aligned?.registrationMode).toBe("AUTOMATIC");
    // The after photo was turned 5° clockwise, so aligning it turns it back.
    expect(aligned?.registrationTransform?.rotationDeg).toBeCloseTo(-5, 0);
    expect(aligned?.registrationTransform?.scale).toBeCloseTo(1, 1);
  }, 180_000);
});
