// Playwright global setup: the Layer 1 stack from services/api/scripts/test-stack.ts
// (fresh database, seed, api from dist) on port 3100, and the built portal
// served by `vite preview`, which proxies /api to the api as one site would.
// Writes the seed's invitation token to e2e/.stack.json for the tests.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startStack } from "../../../services/api/scripts/test-stack.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const STACK_FILE = join(here, ".stack.json");
const API_PORT = 3100;
const ORIGIN = "http://localhost:5174";

export default async function globalSetup(): Promise<() => Promise<void>> {
  const stack = await startStack({ apiPort: API_PORT, origins: [ORIGIN] });
  writeFileSync(
    STACK_FILE,
    JSON.stringify({ invitationToken: stack.invitationToken, email: stack.adminEmail }),
  );

  // npx starts vite as a child: give it its own process group and stop the group.
  const web = spawn("npx", ["vite", "preview", "--host", "localhost"], {
    cwd: join(here, ".."),
    env: { ...process.env, AESTARA_API_URL: `http://127.0.0.1:${API_PORT}` },
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  });
  const stopWeb = () => {
    if (web.pid !== undefined && web.exitCode === null)
      try {
        process.kill(-web.pid, "SIGTERM");
      } catch {
        // already gone
      }
  };
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${ORIGIN}/`)).ok) break;
    } catch {
      // not listening yet
    }
    if (web.exitCode !== null || Date.now() > deadline) {
      stopWeb();
      await stack.stop();
      throw new Error("vite preview did not start");
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  return async () => {
    stopWeb();
    await stack.stop();
  };
}
