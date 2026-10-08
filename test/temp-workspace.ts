import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { onTestFinished } from "vitest";

export function baseFiles(angularCore = "22.0.0"): Record<string, string> {
  return {
    "package.json": JSON.stringify({ dependencies: { "@angular/core": angularCore } }),
    "angular.json": JSON.stringify({ projects: { app: { root: "", sourceRoot: "src" } } }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { experimentalDecorators: true } }),
  };
}

/** Writes `files` (workspace-relative path -> content) to a temp dir removed after the current test. */
export function createWorkspace(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "onpush-ws-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
}
