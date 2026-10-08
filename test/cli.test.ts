import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { parseCliArgs, run, USAGE } from "../src/cli.js";
import { baseFiles, createWorkspace } from "./temp-workspace.js";

describe("parseCliArgs", () => {
  it("reads the workspace root and out dir", () => {
    expect(parseCliArgs(["/ws", "--out", "/tmp/o"])).toEqual({ workspaceRoot: "/ws", out: "/tmp/o" });
  });

  it("defaults out to report", () => {
    expect(parseCliArgs(["/ws"]).out).toBe("report");
  });

  it("fails with usage when the workspace root is missing", () => {
    expect(() => parseCliArgs([])).toThrow(USAGE);
  });

  it("fails with usage on unknown options", () => {
    expect(() => parseCliArgs(["/ws", "--bogus"])).toThrow(USAGE);
  });
});

describe("run", () => {
  it("writes report.json and index.html into a new out dir and summarizes", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "onpush-out-"));
    onTestFinished(() => rmSync(tmp, { recursive: true, force: true }));
    const out = path.join(tmp, "nested", "report");

    const summary = run({ workspaceRoot: path.join(import.meta.dirname, "fixtures", "v21"), out });

    const text = readFileSync(path.join(out, "report.json"), "utf8");
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "meta": {');
    const report = JSON.parse(text);
    expect(report.meta.workspace).toBe("v21");
    expect(readFileSync(path.join(out, "index.html"), "utf8")).toMatch(/^<!doctype html>/);
    expect(summary).toBe(
      [
        "6 components, 17% OnPush, 4 ready to migrate",
        "Report written. Open in a browser:",
        `  ${path.join(out, "index.html")}`,
        `  ${pathToFileURL(path.join(out, "index.html")).href}`,
        "Raw data:",
        `  ${path.join(out, "report.json")}`,
      ].join("\n"),
    );
  });

  it("reports 0% OnPush for a workspace without components", () => {
    const workspaceRoot = createWorkspace(baseFiles());
    const out = path.join(workspaceRoot, "out");

    expect(run({ workspaceRoot, out }).split("\n")[0]).toBe("0 components, 0% OnPush, 0 ready to migrate");
  });

  it("fails loudly when the workspace is not an Angular workspace", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "onpush-empty-"));
    onTestFinished(() => rmSync(tmp, { recursive: true, force: true }));
    expect(() => run({ workspaceRoot: tmp, out: path.join(tmp, "out") })).toThrow();
  });
});

describe("cli process", () => {
  const repoRoot = path.join(import.meta.dirname, "..");
  const buildDir = mkdtempSync(path.join(repoRoot, ".cli-test-"));
  const cli = path.join(buildDir, "main.js");

  beforeAll(() => {
    const build = spawnSync(
      process.execPath,
      [path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.build.json", "--outDir", buildDir],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(build.status, build.stdout).toBe(0);
    return () => rmSync(buildDir, { recursive: true, force: true });
  }, 60_000);

  it("exits 2 with usage on a usage error", () => {
    const result = spawnSync(process.execPath, [cli], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(USAGE);
  });

  it("exits 1 with the error message on a runtime error", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "onpush-empty-"));
    onTestFinished(() => rmSync(empty, { recursive: true, force: true }));
    const result = spawnSync(process.execPath, [cli, empty, "--out", path.join(empty, "out")], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).not.toBe("");
    expect(result.stderr).not.toContain(USAGE);
  });
});
