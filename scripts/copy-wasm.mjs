// Copies the web-ifc WASM binaries into public/ so Vite serves them as
// static assets. Runs automatically after npm install (see package.json).
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, "..", "node_modules", "web-ifc");
const dest = path.join(root, "..", "public", "vendor", "web-ifc");

mkdirSync(dest, { recursive: true });

for (const file of ["web-ifc.wasm", "web-ifc-mt.wasm"]) {
  copyFileSync(path.join(src, file), path.join(dest, file));
}

console.log("[copy-wasm] web-ifc WASM binaries copied to public/vendor/web-ifc");
