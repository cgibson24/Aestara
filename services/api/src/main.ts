// Entry point: load and validate configuration, build the app, listen, and
// shut down cleanly on SIGTERM (ECS task stop).
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const { app, logger } = await createApp(config);
app.enableShutdownHooks();
await app.listen(config.PORT, config.HOST);
logger.info({ port: config.PORT }, "api listening");
