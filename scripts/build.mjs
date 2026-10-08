import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

rmSync("dist", { recursive: true, force: true });
const { status } = spawnSync(process.execPath, [tsc, "-p", "tsconfig.build.json"], { stdio: "inherit" });
if (status !== 0) {
  process.exit(status ?? 1);
}
// Per-file copy: fs.cpSync on a directory fails on some Docker bind mounts (Node 24.21, EACCES).
mkdirSync("dist/report/assets", { recursive: true });
for (const asset of readdirSync("src/report/assets")) {
  copyFileSync(`src/report/assets/${asset}`, `dist/report/assets/${asset}`);
}
