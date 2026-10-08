import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildReport } from "../src/report/data.js";
import { gitCommit } from "../src/report/git.js";
import { baseFiles, createWorkspace } from "./temp-workspace.js";

const fixture = (name: string) => path.join(import.meta.dirname, "fixtures", name);
const NOW = new Date("2026-01-02T03:04:05.678Z");

function componentOf(report: ReturnType<typeof buildReport>, id: string) {
  const found = report.components.find((component) => component.id === id);
  if (found === undefined) {
    throw new Error(`no component ${id}`);
  }
  return found;
}

describe("buildReport on the v21 fixture", () => {
  const report = buildReport(fixture("v21"), NOW);

  it("describes the workspace", () => {
    expect(report.meta).toMatchObject({
      generatedAt: "2026-01-02T03:04:05.678Z",
      workspace: "v21",
      angularVersion: expect.stringMatching(/^21\./),
    });
  });

  it("sorts components by id and counts them", () => {
    const ids = report.components.map(({ id }) => id);
    expect(ids).toEqual([...ids].sort());
    expect(report.meta.counts).toEqual({ total: 6, eager: 5, onpush: 1, ready: 4, perWave: { "0": 4, "1": 1 }, cycles: 1 });
  });

  it("reports a cycle member with its group", () => {
    expect(report.cycles).toEqual([
      ["libs/vault/src/vault-item.component.ts#VaultItemComponent", "libs/vault/src/vault-list.component.ts#VaultListComponent"],
    ]);
    expect(report.meta.counts.cycles).toBe(1);
    expect(componentOf(report, "libs/vault/src/vault-item.component.ts#VaultItemComponent")).toMatchObject({
      name: "VaultItemComponent",
      selector: "vault-item",
      template: { file: "libs/vault/src/vault-item.component.ts", line: 7 },
      dependencies: [{ to: "libs/vault/src/vault-list.component.ts#VaultListComponent", kind: "template", ambiguous: false }],
      cycleId: 0,
      transitiveDependencies: 1,
      transitiveDependents: 2,
    });
  });

  it("omits the template source", () => {
    expect(componentOf(report, "libs/vault/src/vault-item.component.ts#VaultItemComponent").template).toEqual({
      file: "libs/vault/src/vault-item.component.ts",
      line: 7,
    });
  });

  it("survives a JSON round trip", () => {
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});

describe("buildReport on the v22 fixture", () => {
  const report = buildReport(fixture("v22"), NOW);

  it("reports an implicit onpush component without a wave", () => {
    expect(componentOf(report, "src/app/app.component.ts#AppComponent")).toMatchObject({
      changeDetection: "onpush",
      changeDetectionExplicit: false,
      ready: false,
      wave: null,
      unmatchedElements: ["router-outlet"],
    });
  });

  it("reports a ready eager leaf in wave 0", () => {
    expect(componentOf(report, "src/app/legacy.component.ts#LegacyComponent")).toMatchObject({
      changeDetection: "eager",
      heritage: { extends: "libs/shared/src/lib/card-base.component.ts#CardBaseComponent", implements: [] },
      dependencies: [{ to: "libs/shared/src/lib/card-base.component.ts#CardBaseComponent", kind: "extends", ambiguous: false }],
      ready: true,
      wave: 0,
    });
  });

  it("counts components per wave", () => {
    expect(report.meta.counts).toEqual({ total: 7, eager: 2, onpush: 5, ready: 2, perWave: { "0": 2 }, cycles: 0 });
  });
});

describe("buildReport warnings", () => {
  it("attaches the file each warning line refers to", () => {
    const root = createWorkspace({
      ...baseFiles(),
      "src/a.component.ts": [
        'import { Component, inject } from "@angular/core";',
        'import { UserService } from "./user.service";',
        "",
        '@Component({ selector: "app-a", templateUrl: "./a.component.html" })',
        "export class AComponent {",
        "  private user = inject(UserService);",
        "  items: string[] = [];",
        "  load() {",
        "    setTimeout(() => {",
        '      this.items = ["x"];',
        "    });",
        "  }",
        "}",
      ].join("\n"),
      "src/a.component.html": "<p>{{ items.length }}</p>\n<p>{{ user.name }}</p>\n",
      "src/user.service.ts": "export class UserService { name = ''; }",
    });
    const [component] = buildReport(root, NOW).components;
    expect(component?.warnings).toEqual([
      { kind: "service-state-in-template", message: expect.any(String), line: 2, file: "src/a.component.html" },
      { kind: "async-assignment", message: expect.any(String), line: 10, file: "src/a.component.ts" },
    ]);
  });
});

describe("gitCommit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is null outside a git repository", () => {
    expect(gitCommit(createWorkspace({ "a.txt": "" }))).toBeNull();
  });

  it("returns HEAD of a repository", () => {
    const root = createWorkspace({ "a.txt": "" });
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-C", root, ...args], {
        encoding: "utf8",
      }).trim();
    git("init", "-q");
    git("add", ".");
    git("commit", "-q", "-m", "init");
    expect(gitCommit(root)).toBe(git("rev-parse", "HEAD"));
    expect(gitCommit(root)).toMatch(/^[0-9a-f]{40}$/);
  });

  it("says so when git is not installed", () => {
    vi.stubEnv("PATH", "");
    expect(() => gitCommit(createWorkspace({ "a.txt": "" }))).toThrow("git not found on PATH");
  });

  it("fails loudly on a repository without commits", () => {
    const root = createWorkspace({ "a.txt": "" });
    execFileSync("git", ["-C", root, "init", "-q"]);
    expect(() => gitCommit(root)).toThrow(/git rev-parse HEAD failed/);
  });
});
