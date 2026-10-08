import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractComponents } from "../src/components.js";
import { computeEdges } from "../src/edges.js";
import type { Component, ComponentEdges, Heritage } from "../src/types.js";
import { loadWorkspace } from "../src/workspace.js";

const fixture = (name: string) => path.join(import.meta.dirname, "fixtures", name);

function fixtureEdges(name: string): Map<string, ComponentEdges> {
  return computeEdges(extractComponents(loadWorkspace(fixture(name))).map(({ component }) => component));
}

function component(
  name: string,
  selector: string | null,
  template = "",
  heritage: Heritage = { extends: null, implements: [] },
): Component {
  const file = `src/${name}.component.ts`;
  return {
    id: `${file}#${name}`,
    name,
    file,
    project: "app",
    projectAssigned: true,
    selector,
    standalone: true,
    changeDetection: "eager",
    changeDetectionExplicit: false,
    template: { source: template, file, line: 3 },
    heritage,
  };
}

const id = (name: string) => `src/${name}.component.ts#${name}`;

/** Edges of a `Host` component with `template`, given other components as name -> selector. */
function hostEdges(template: string, selectors: Record<string, string>): ComponentEdges {
  const host = component("Host", "app-host", template);
  const others = Object.entries(selectors).map(([name, selector]) => component(name, selector));
  const edges = computeEdges([host, ...others]).get(host.id);
  if (edges === undefined) {
    throw new Error("no edges computed for Host");
  }
  return edges;
}

function templateTargets(template: string, selectors: Record<string, string>): string[] {
  return hostEdges(template, selectors).edges.map((edge) => edge.to);
}

describe("template selector matching", () => {
  it.each([
    ["tag", "app-a", "<app-a></app-a>"],
    ["attribute on a static attribute", "[appA]", "<div appA></div>"],
    ["attribute on a bound input", "[appA]", '<div [appA]="value"></div>'],
    ["attribute on a two-way binding", "[appA]", '<div [(appA)]="value"></div>'],
    ["attribute on an output", "[appA]", '<div (appA)="handle()"></div>'],
    ["attribute with value", "input[type=checkbox]", '<input type="checkbox">'],
    ["class", ".app-a", '<div class="x app-a"></div>'],
    ["element and attribute", "tr[appRow]", "<table><tbody><tr appRow></tr></tbody></table>"],
    ["comma selector, first part", "app-a, [appA]", "<app-a></app-a>"],
    ["comma selector, second part", "app-a, [appA]", "<span appA></span>"],
    [":not()", "[appA]:not(textarea)", "<input appA>"],
    ["structural directive host", "app-a", '<app-a *ngIf="show"></app-a>'],
  ])("matches a %s selector", (_, selector, template) => {
    expect(templateTargets(template, { A: selector })).toEqual([id("A")]);
  });

  it.each([
    ["element and attribute on another tag", "tr[appRow]", "<div appRow></div>"],
    [":not() on the excluded tag", "[appA]:not(textarea)", "<textarea appA></textarea>"],
    ["attribute on an attribute binding", "[appA]", '<div [attr.appA]="value"></div>'],
    ["attribute with another value", "input[type=checkbox]", '<input type="text">'],
    ["components on <ng-container>", "[appA]", "<ng-container appA></ng-container>"],
    ["components on <ng-template>", "[appA]", "<ng-template appA></ng-template>"],
    ["elements inside ICU cases, which Angular renders as plain DOM", "app-a", "{n, plural, =1 {<app-a></app-a>} other {x}}"],
  ])("does not match %s", (_, selector, template) => {
    expect(hostEdges(template, { A: selector })).toEqual({ edges: [], unmatchedElements: [] });
  });

  it("matches an element against a comma selector only once", () => {
    expect(hostEdges("<app-a appA></app-a>", { A: "app-a, [appA]" }).edges).toEqual([
      { to: id("A"), kind: "template", ambiguous: false },
    ]);
  });

  it.each([
    ["@if", "@if (a) { <app-t /> }"],
    ["@else if", "@if (a) { x } @else if (b) { <app-t /> }"],
    ["@else", "@if (a) { x } @else { <app-t /> }"],
    ["@for", "@for (i of items; track i) { <app-t /> }"],
    ["@empty", "@for (i of items; track i) { x } @empty { <app-t /> }"],
    ["@switch @case", "@switch (a) { @case (1) { <app-t /> } }"],
    ["@switch @default", "@switch (a) { @case (1) { x } @default { <app-t /> } }"],
    ["@defer", "@defer { <app-t /> }"],
    ["@placeholder", "@defer { x } @placeholder { <app-t /> }"],
    ["@loading", "@defer { x } @loading { <app-t /> }"],
    ["@error", "@defer { x } @error { <app-t /> }"],
    ["<ng-template>", "<ng-template><app-t /></ng-template>"],
    ["<ng-container>", "<ng-container><app-t /></ng-container>"],
    ["<ng-content> fallback", "<ng-content><app-t /></ng-content>"],
    ["an i18n element", "<p i18n>Hi <app-t /></p>"],
    ["a nested element after @let", "@let x = 1; <div><app-t /></div>"],
  ])("finds elements inside %s", (_, template) => {
    expect(templateTargets(template, { T: "app-t" })).toEqual([id("T")]);
  });
});

describe("edges", () => {
  it("deduplicates repeated uses and sorts by target and kind", () => {
    const host = component("Host", null, "<app-b /><app-a /><app-b />", {
      extends: id("B"),
      implements: [id("A")],
    });
    const edges = computeEdges([host, component("A", "app-a"), component("B", "app-b")]).get(host.id)?.edges;
    expect(edges).toEqual([
      { to: id("A"), kind: "implements", ambiguous: false },
      { to: id("A"), kind: "template", ambiguous: false },
      { to: id("B"), kind: "extends", ambiguous: false },
      { to: id("B"), kind: "template", ambiguous: false },
    ]);
  });

  it("drops self-references of a recursive component", () => {
    const tree = component("Tree", "app-tree", "@for (c of children; track c) { <app-tree [node]=\"c\" /> }");
    expect(computeEdges([tree]).get(tree.id)).toEqual({ edges: [], unmatchedElements: [] });
  });

  it("adds an ambiguous edge to each component an element matches", () => {
    expect(hostEdges("<app-dup />", { A: "app-dup", B: "app-dup" }).edges).toEqual([
      { to: id("A"), kind: "template", ambiguous: true },
      { to: id("B"), kind: "template", ambiguous: true },
    ]);
  });

  it("keeps an edge ambiguous when another use of the same component is not", () => {
    expect(hostEdges("<app-dup /><div appOnlyA></div>", { A: "app-dup, [appOnlyA]", B: "app-dup" }).edges).toEqual([
      { to: id("A"), kind: "template", ambiguous: true },
      { to: id("B"), kind: "template", ambiguous: true },
    ]);
  });

  it("lists custom elements matching no component, without Angular built-ins", () => {
    const template = [
      "<router-outlet /><router-outlet />",
      "<mat-icon>x</mat-icon><app-a /><unknown></unknown>",
      '<ng-container><ng-content select="x" /></ng-container><ng-template><b>x</b></ng-template>',
      "<svg><font-face /></svg>",
    ].join("\n");
    expect(hostEdges(template, { A: "app-a" }).unmatchedElements).toEqual(["font-face", "mat-icon", "router-outlet"]);
  });
});

describe("template errors", () => {
  it("fails with the file and the line within it", () => {
    const broken = component("Broken", null, "<div>\n  <span></div>");
    expect(() => computeEdges([broken])).toThrow(/^src\/Broken\.component\.ts:4: Unexpected closing tag "div"/);
  });

  it("fails on an invalid selector", () => {
    expect(() => computeEdges([component("Bad", ":not(:not(a))")])).toThrow(
      'src/Bad.component.ts: invalid selector ":not(:not(a))": Nesting :not in a selector is not allowed',
    );
  });
});

describe("computeEdges on the v22 fixture", () => {
  const edges = fixtureEdges("v22");
  const button = "libs/shared/src/lib/button.component.ts#ButtonComponent";

  it("follows templateUrl templates into control flow and lists unmatched elements", () => {
    expect(edges.get("src/app/app.component.ts#AppComponent")).toEqual({
      edges: [
        { to: button, kind: "template", ambiguous: false },
        { to: "src/app/list/list.component.ts#ListComponent", kind: "template", ambiguous: false },
      ],
      unmatchedElements: ["router-outlet"],
    });
  });

  it("matches inline templates by tag and by attribute", () => {
    expect(edges.get("src/app/list/list.component.ts#ListComponent")?.edges).toEqual([
      { to: "src/app/list/item.component.ts#ItemComponent", kind: "template", ambiguous: false },
    ]);
    expect(edges.get("src/app/list/item.component.ts#ItemComponent")?.edges).toEqual([
      { to: button, kind: "template", ambiguous: false },
    ]);
  });

  it("adds heritage edges next to template edges", () => {
    expect(edges.get("libs/orphan/widgets/widget.component.ts#WidgetComponent")?.edges).toEqual([
      { to: button, kind: "implements", ambiguous: false },
      { to: button, kind: "template", ambiguous: false },
    ]);
    expect(edges.get("src/app/legacy.component.ts#LegacyComponent")?.edges).toEqual([
      { to: "libs/shared/src/lib/card-base.component.ts#CardBaseComponent", kind: "extends", ambiguous: false },
    ]);
  });
});

describe("computeEdges on the v21 fixture", () => {
  const edges = fixtureEdges("v21");
  const list = "libs/vault/src/vault-list.component.ts#VaultListComponent";
  const item = "libs/vault/src/vault-item.component.ts#VaultItemComponent";

  it("connects the vault template cycle in both directions", () => {
    expect(edges.get(list)?.edges).toEqual([{ to: item, kind: "template", ambiguous: false }]);
    expect(edges.get(item)?.edges).toEqual([{ to: list, kind: "template", ambiguous: false }]);
  });

  it("combines extends and template edges of a templateUrl component", () => {
    expect(edges.get("apps/web/src/app/shell.component.ts#ShellComponent")?.edges).toEqual([
      { to: "libs/components/src/button/button.component.ts#ButtonComponent", kind: "template", ambiguous: false },
      { to: "libs/components/src/dialog/base-dialog.component.ts#BaseDialogComponent", kind: "extends", ambiguous: false },
      { to: list, kind: "template", ambiguous: false },
    ]);
  });
});
