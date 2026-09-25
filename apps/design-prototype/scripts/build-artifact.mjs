#!/usr/bin/env node
// Builds a single, self-contained HTML page of the prototype for sharing as a
// Claude artifact: app code and CSS inlined, React 18 loaded from cdnjs.
// Output: dist-artifact/aestara-design-prototype.html
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
execFileSync("npx", ["vite", "build", "--logLevel", "error"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, ARTIFACT: "1" },
});

const out = join(root, "dist-artifact");
const css = readFileSync(join(out, "prototype.css"), "utf8");
const js = readFileSync(join(out, "prototype.js"), "utf8").replaceAll("</script", "<\\/script");

const html = `<title>Aestara Design Prototype</title>
<meta name="description" content="Static design prototype of the Aestara provider iPad/iPhone app, patient app and admin web. Hard-coded data, no backend.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>
${css}
</style>
<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>
${js}
</script>
`;
writeFileSync(join(out, "aestara-design-prototype.html"), html);
console.log(
  `design-prototype: wrote dist-artifact/aestara-design-prototype.html (${Math.round(html.length / 1024)} KB)`,
);
