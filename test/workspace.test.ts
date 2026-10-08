import path from "node:path";
import { describe, expect, it } from "vitest";
import { assignProject, loadWorkspace, relativePath } from "../src/workspace.js";
import { baseFiles, createWorkspace } from "./temp-workspace.js";

const fixture = (name: string) => path.join(import.meta.dirname, "fixtures", name);

function rootFiles(root: string): string[] {
  const workspace = loadWorkspace(root);
  return workspace.program.getRootFileNames().map((file) => relativePath(workspace.root, file));
}

function baseFilesWithout(name: string): Record<string, string> {
  return Object.fromEntries(Object.entries(baseFiles()).filter(([file]) => file !== name));
}

describe("loadWorkspace", () => {
  it("reads the @angular/core version from dependencies", () => {
    const workspace = loadWorkspace(fixture("v22"));
    expect(workspace.angularVersion).toBe("22.1.0");
    expect(workspace.angularMajor).toBe(22);
  });

  it("reads the @angular/core version from devDependencies", () => {
    const workspace = loadWorkspace(fixture("v21"));
    expect(workspace.angularVersion).toBe("21.2.0");
    expect(workspace.angularMajor).toBe(21);
  });

  it("fails without package.json", () => {
    expect(() => loadWorkspace(createWorkspace(baseFilesWithout("package.json")))).toThrow(/package\.json: file not found/);
  });

  it("fails when @angular/core is not a dependency", () => {
    const root = createWorkspace({ ...baseFiles(), "package.json": JSON.stringify({ dependencies: {} }) });
    expect(() => loadWorkspace(root)).toThrow(/@angular\/core is missing/);
  });

  it("fails on an unparseable @angular/core version", () => {
    expect(() => loadWorkspace(createWorkspace(baseFiles("latest")))).toThrow(/cannot parse @angular\/core version "latest"/);
  });

  it.each([">=21.0.0 <23", "^21.0.0 || ^22.0.0", "workspace:*", "npm:@angular/core@22.0.0"])(
    "fails on the non-simple @angular/core version %s",
    (version) => {
      expect(() => loadWorkspace(createWorkspace(baseFiles(version)))).toThrow(/cannot parse @angular\/core version/);
    },
  );

  it.each([
    ["22.0.0", "22.0.0", 22],
    ["^22.1.0", "22.1.0", 22],
    ["v21.2.x", "21.2.x", 21],
    ["22.0.0-rc.1", "22.0.0-rc.1", 22],
    ["22", "22", 22],
  ])("accepts the simple @angular/core version %s", (raw, version, major) => {
    const workspace = loadWorkspace(createWorkspace(baseFiles(raw)));
    expect([workspace.angularVersion, workspace.angularMajor]).toEqual([version, major]);
  });

  it("fails without angular.json", () => {
    expect(() => loadWorkspace(createWorkspace(baseFilesWithout("angular.json")))).toThrow(/angular\.json: file not found/);
  });

  it("fails without a tsconfig", () => {
    expect(() => loadWorkspace(createWorkspace(baseFilesWithout("tsconfig.json")))).toThrow(/neither tsconfig\.base\.json nor tsconfig\.json found/);
  });

  it("fails when angular.json projects is not an object", () => {
    const root = createWorkspace({ ...baseFiles(), "angular.json": JSON.stringify({ projects: [] }) });
    expect(() => loadWorkspace(root)).toThrow(/angular\.json: "projects" must be an object/);
    const missing = createWorkspace({ ...baseFiles(), "angular.json": "{}" });
    expect(() => loadWorkspace(missing)).toThrow(/angular\.json: "projects" must be an object/);
  });

  it("fails when a project has no string root", () => {
    const root = createWorkspace({ ...baseFiles(), "angular.json": JSON.stringify({ projects: { app: { root: 3 } } }) });
    expect(() => loadWorkspace(root)).toThrow(/project "app" has no string "root"/);
  });

  it("fails on an unparseable tsconfig", () => {
    const root = createWorkspace({ ...baseFiles(), "tsconfig.json": "{ not json" });
    expect(() => loadWorkspace(root)).toThrow(/tsconfig\.json/);
  });

  it("fails when the tsconfig extends a missing file", () => {
    const root = createWorkspace({ ...baseFiles(), "tsconfig.json": JSON.stringify({ extends: "./missing.json" }) });
    expect(() => loadWorkspace(root)).toThrow(/missing\.json/);
  });

  it("takes paths and baseUrl from the chosen tsconfig's parent via extends", () => {
    const root = createWorkspace({
      ...baseFiles(),
      "tsconfig.json": JSON.stringify({ extends: "./config/tsconfig.paths.json" }),
      "config/tsconfig.paths.json": JSON.stringify({
        compilerOptions: { experimentalDecorators: true, baseUrl: "..", paths: { "@lib": ["libs/x/src"] } },
      }),
    });
    const options = loadWorkspace(root).program.getCompilerOptions();
    expect(options.paths).toEqual({ "@lib": ["libs/x/src"] });
    expect(options.baseUrl).toBe(root);
  });

  it("narrows an empty project root to its sourceRoot and normalizes roots", () => {
    expect(loadWorkspace(fixture("v22")).projects).toEqual([
      { name: "app", root: "src" },
      { name: "shared", root: "libs/shared" },
    ]);
    expect(loadWorkspace(fixture("v21")).projects).toEqual([
      { name: "web", root: "apps/web" },
      { name: "web-admin", root: "apps/web/admin" },
      { name: "components", root: "libs/components" },
    ]);
  });

  it("defaults an empty project root without sourceRoot to src", () => {
    const root = createWorkspace({ ...baseFiles(), "angular.json": JSON.stringify({ projects: { app: { root: "" } } }) });
    expect(loadWorkspace(root).projects).toEqual([{ name: "app", root: "src" }]);
  });

  it("prefers tsconfig.base.json over tsconfig.json", () => {
    expect(loadWorkspace(fixture("v21")).program.getCompilerOptions().paths).toEqual({
      "@acme/components": ["libs/components/src"],
    });
  });

  it("uses all .ts files except specs, stories, declarations, node_modules, dist and hidden dirs as root files", () => {
    const root = createWorkspace({
      ...baseFiles(),
      "src/a.ts": "",
      "src/a.spec.ts": "",
      "src/a.stories.ts": "",
      "src/types.d.ts": "",
      "src/b.html": "",
      "src/node_modules/x/c.ts": "",
      "dist/main.ts": "",
      ".angular/e.ts": "",
      "libs/x/f.ts": "",
    });
    expect(rootFiles(root)).toEqual(["libs/x/f.ts", "src/a.ts"]);
  });
});

describe("assignProject", () => {
  const projects = loadWorkspace(fixture("v21")).projects;

  it("picks the project with the longest matching root", () => {
    expect(assignProject(projects, "apps/web/admin/admin.component.ts")).toEqual({
      project: "web-admin",
      projectAssigned: true,
    });
    expect(assignProject(projects, "apps/web/src/app/shell.component.ts")).toEqual({
      project: "web",
      projectAssigned: true,
    });
  });

  it("matches whole path segments only", () => {
    expect(assignProject(projects, "apps/webby/src/x.ts")).toEqual({ project: "apps/webby", projectAssigned: false });
  });

  it("labels unassigned files with their first two path segments", () => {
    expect(assignProject(projects, "libs/vault/src/vault-list.component.ts")).toEqual({
      project: "libs/vault",
      projectAssigned: false,
    });
  });
});
