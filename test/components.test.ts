import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractComponents } from "../src/components.js";
import type { Component } from "../src/types.js";
import { loadWorkspace } from "../src/workspace.js";
import { baseFiles, createWorkspace } from "./temp-workspace.js";

const fixture = (name: string) => path.join(import.meta.dirname, "fixtures", name);

function extract(root: string): Map<string, Component> {
  return new Map(extractComponents(loadWorkspace(root)).map(({ component }) => [component.id, component]));
}

function extractSingle(angularCore: string, metadata: string, extraFiles: Record<string, string> = {}): Component {
  const root = createWorkspace({
    ...baseFiles(angularCore),
    ...extraFiles,
    "src/a.component.ts": [
      'import { ChangeDetectionStrategy, Component } from "@angular/core";',
      "",
      `@Component(${metadata})`,
      "export class AComponent {}",
    ].join("\n"),
  });
  const [component, ...rest] = extract(root).values();
  expect(rest).toEqual([]);
  if (component === undefined) {
    throw new Error("no component extracted");
  }
  return component;
}

function changeDetectionOf(angularCore: string, strategy: string | undefined) {
  const property = strategy === undefined ? "" : `changeDetection: ChangeDetectionStrategy.${strategy}, `;
  const { changeDetection, changeDetectionExplicit } = extractSingle(angularCore, `{ ${property}template: "" }`);
  return { changeDetection, changeDetectionExplicit };
}

function extractionError(metadata: string, extraFiles: Record<string, string> = {}): string {
  try {
    extractSingle("22.0.0", metadata, extraFiles);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("extraction did not fail");
}

describe("extractComponents on the v22 fixture", () => {
  const extracted = extractComponents(loadWorkspace(fixture("v22")));
  const components = new Map(extracted.map(({ component }) => [component.id, component]));

  it("finds every component, sorted by id, ignoring specs, stories, directives and other classes", () => {
    expect([...components.keys()]).toEqual([
      "libs/orphan/widgets/widget.component.ts#WidgetComponent",
      "libs/shared/src/lib/button.component.ts#ButtonComponent",
      "libs/shared/src/lib/card-base.component.ts#CardBaseComponent",
      "src/app/app.component.ts#AppComponent",
      "src/app/legacy.component.ts#LegacyComponent",
      "src/app/list/item.component.ts#ItemComponent",
      "src/app/list/list.component.ts#ListComponent",
    ]);
  });

  it("extracts all facts of a templateUrl component", () => {
    expect(components.get("src/app/app.component.ts#AppComponent")).toEqual({
      id: "src/app/app.component.ts#AppComponent",
      name: "AppComponent",
      file: "src/app/app.component.ts",
      project: "app",
      projectAssigned: true,
      selector: "app-root",
      standalone: true,
      changeDetection: "onpush",
      changeDetectionExplicit: false,
      template: {
        source: expect.stringContaining("<app-list [items]"),
        file: "src/app/app.component.html",
        line: 1,
      },
      heritage: { extends: null, implements: [] },
    });
  });

  it("extracts all facts of an inline template component outside every project", () => {
    expect(components.get("libs/orphan/widgets/widget.component.ts#WidgetComponent")).toEqual({
      id: "libs/orphan/widgets/widget.component.ts#WidgetComponent",
      name: "WidgetComponent",
      file: "libs/orphan/widgets/widget.component.ts",
      project: "libs/orphan",
      projectAssigned: false,
      selector: "orphan-widget",
      standalone: true,
      changeDetection: "onpush",
      changeDetectionExplicit: false,
      template: {
        source: "<shared-button sharedHighlight>Go</shared-button>",
        file: "libs/orphan/widgets/widget.component.ts",
        line: 6,
      },
      heritage: { extends: null, implements: ["libs/shared/src/lib/button.component.ts#ButtonComponent"] },
    });
  });

  it("records the line a multi-line inline template starts on", () => {
    const template = components.get("src/app/list/list.component.ts#ListComponent")?.template;
    expect(template?.line).toBe(8);
    expect(template?.source).toMatch(/^\n {4}@for \(item of items\(\)/);
  });

  it("reads explicit strategies, standalone and missing selectors", () => {
    expect(components.get("src/app/list/item.component.ts#ItemComponent")).toMatchObject({
      changeDetection: "onpush",
      changeDetectionExplicit: true,
    });
    expect(components.get("src/app/legacy.component.ts#LegacyComponent")).toMatchObject({
      standalone: false,
      changeDetection: "eager",
      changeDetectionExplicit: true,
    });
    expect(components.get("libs/shared/src/lib/card-base.component.ts#CardBaseComponent")?.selector).toBeNull();
  });

  it("resolves extends through import aliases, aliased barrel re-exports and tsconfig paths", () => {
    expect(components.get("src/app/legacy.component.ts#LegacyComponent")?.heritage).toEqual({
      extends: "libs/shared/src/lib/card-base.component.ts#CardBaseComponent",
      implements: [],
    });
  });

  it("exposes the class declaration of each component", () => {
    for (const { component, declaration } of extracted) {
      expect(declaration.name?.text).toBe(component.name);
      expect(declaration.getSourceFile().fileName).toBe(path.join(fixture("v22"), component.file));
    }
  });
});

describe("extractComponents on the v21 fixture", () => {
  const components = extract(fixture("v21"));

  it("resolves extends through a baseUrl paths mapping to a barrel directory", () => {
    expect(components.get("apps/web/src/app/shell.component.ts#ShellComponent")?.heritage).toEqual({
      extends: "libs/components/src/dialog/base-dialog.component.ts#BaseDialogComponent",
      implements: [],
    });
  });

  it("assigns nested projects by the longest root", () => {
    expect(components.get("apps/web/admin/admin.component.ts#AdminComponent")?.project).toBe("web-admin");
    expect(components.get("apps/web/src/app/shell.component.ts#ShellComponent")?.project).toBe("web");
    expect(components.get("libs/vault/src/vault-list.component.ts#VaultListComponent")).toMatchObject({
      project: "libs/vault",
      projectAssigned: false,
    });
  });

  it("defaults absent strategies to eager", () => {
    expect(components.get("libs/vault/src/vault-item.component.ts#VaultItemComponent")).toMatchObject({
      changeDetection: "eager",
      changeDetectionExplicit: false,
      standalone: true,
    });
  });
});

describe("heritage through an extended tsconfig", () => {
  it("resolves extends through paths that only a parent tsconfig declares", () => {
    const component = (name: string, body = "") =>
      `import { Component } from "@angular/core";\n\n@Component({ template: "" })\nexport class ${name} {${body}}\n`;
    const root = createWorkspace({
      ...baseFiles(),
      "tsconfig.json": JSON.stringify({ extends: "./config/tsconfig.paths.json" }),
      "config/tsconfig.paths.json": JSON.stringify({
        compilerOptions: { experimentalDecorators: true, baseUrl: "..", paths: { "@lib": ["libs/x/src"] } },
      }),
      "libs/x/src/index.ts": 'export * from "./base.component";\n',
      "libs/x/src/base.component.ts": component("BaseComponent", " value = 1; "),
      "src/child.component.ts": `import { BaseComponent } from "@lib";\n${component("ChildComponent").replace(
        "ChildComponent {",
        "ChildComponent extends BaseComponent {",
      )}`,
    });
    expect(extract(root).get("src/child.component.ts#ChildComponent")?.heritage).toEqual({
      extends: "libs/x/src/base.component.ts#BaseComponent",
      implements: [],
    });
  });
});

describe("changeDetection", () => {
  it.each([
    ["22.0.0", "Eager", "eager", true],
    ["22.0.0", "Default", "eager", true],
    ["22.0.0", "OnPush", "onpush", true],
    ["22.0.0", undefined, "onpush", false],
    ["21.2.0", "OnPush", "onpush", true],
    ["21.2.0", undefined, "eager", false],
  ])("Angular %s with %s is %s (explicit: %s)", (version, strategy, changeDetection, changeDetectionExplicit) => {
    expect(changeDetectionOf(version, strategy)).toEqual({ changeDetection, changeDetectionExplicit });
  });

  it("fails on a non-literal strategy with file and line", () => {
    expect(extractionError('{\n  template: "",\n  changeDetection: strategy,\n}')).toBe(
      "src/a.component.ts:5: unsupported changeDetection value `strategy`",
    );
  });
});

describe("standalone", () => {
  it("defaults to false before Angular 19", () => {
    expect(extractSingle("18.2.0", '{ template: "" }').standalone).toBe(false);
  });

  it("reads standalone: true", () => {
    expect(extractSingle("18.2.0", '{ template: "", standalone: true }').standalone).toBe(true);
  });

  it("fails on a non-boolean value", () => {
    expect(extractionError('{ template: "", standalone: isStandalone }')).toMatch(/:3: standalone must be true or false/);
  });
});

describe("metadata errors", () => {
  it("fails on spread metadata", () => {
    expect(extractionError('{ ...shared, template: "" }')).toMatch(/:3: @Component metadata entries must be `key: value`/);
  });

  it("accepts shorthand properties and checks them like any other value", () => {
    expect(extractSingle("22.0.0", '{ imports, template: "" }').template.source).toBe("");
    expect(extractionError("{ template }")).toMatch(/:3: template must be a string literal/);
  });

  it("fails on non-object metadata", () => {
    expect(extractionError("metadata")).toMatch(/:3: @Component metadata must be an object literal/);
  });

  it("accepts string-literal keys", () => {
    const component = extractSingle("22.0.0", '{ "selector": "app-quoted", "template": "<p></p>" }');
    expect(component.selector).toBe("app-quoted");
    expect(component.template.source).toBe("<p></p>");
  });

  it("fails on an anonymous component class", () => {
    const root = createWorkspace({
      ...baseFiles(),
      "src/a.component.ts": 'import { Component } from "@angular/core";\n\n@Component({ template: "" })\nexport default class {}\n',
    });
    expect(() => extract(root)).toThrow(/src\/a\.component\.ts:3: @Component class has no name/);
  });

  it("recognizes a property-access decorator such as ng.Component", () => {
    const root = createWorkspace({
      ...baseFiles(),
      "src/a.component.ts": 'import * as ng from "@angular/core";\n\n@ng.Component({ template: "" })\nexport class AComponent {}\n',
    });
    expect([...extract(root).keys()]).toEqual(["src/a.component.ts#AComponent"]);
  });

  it("fails on a non-literal selector", () => {
    expect(extractionError('{ selector: SELECTOR, template: "" }')).toMatch(/:3: selector must be a string literal/);
  });
});

describe("templates", () => {
  it("reads templateUrl relative to the component file", () => {
    const component = extractSingle("22.0.0", '{ templateUrl: "./tpl/a.html" }', { "src/tpl/a.html": "<p>hi</p>" });
    expect(component.template).toEqual({ source: "<p>hi</p>", file: "src/tpl/a.html", line: 1 });
  });

  it("reads no-substitution template literals", () => {
    expect(extractSingle("22.0.0", "{ template: `<p>hi</p>` }").template.source).toBe("<p>hi</p>");
  });

  it("fails when the templateUrl file is missing", () => {
    expect(extractionError('{ templateUrl: "./missing.html" }')).toBe(
      "src/a.component.ts:3: templateUrl file not found: src/missing.html",
    );
  });

  it("fails on a template with substitutions", () => {
    expect(extractionError("{ template: `<p>${x}</p>` }")).toMatch(/:3: template must be a string literal/);
  });

  it("fails without a template", () => {
    expect(extractionError('{ selector: "a-b" }')).toMatch(/:3: @Component has neither template nor templateUrl/);
  });

  it("fails with both template and templateUrl", () => {
    expect(extractionError('{ template: "", templateUrl: "./a.html" }')).toMatch(
      /:3: @Component has both template and templateUrl/,
    );
  });
});
