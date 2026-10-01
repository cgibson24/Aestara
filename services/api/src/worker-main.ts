// Entry point of the worker process: load and validate its configuration,
// start the relay, the queue consumers and the scheduled jobs, and stop
// cleanly on SIGTERM (ECS task stop).
import { loadWorkerConfig } from "./config.ts";
import { createWorker } from "./worker/module.ts";

const worker = await createWorker(loadWorkerConfig());
worker.start();
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    worker.logger.info({ signal }, "worker stopping");
    void worker.stop().then(() => process.exit(0));
  });
