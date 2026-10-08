import { describe, expect, it } from "vitest";
import { extractComponents } from "../src/components.js";
import type { Warning } from "../src/types.js";
import { computeWarnings } from "../src/warnings.js";
import { loadWorkspace } from "../src/workspace.js";
import { baseFiles, createWorkspace } from "./temp-workspace.js";

/** Class body lines start at line 5 of src/a.component.ts. */
const BODY_LINE = 5;

function warningsOf(body: string[], metadata = 'template: ""', extraFiles: Record<string, string> = {}): Warning[] {
  const root = createWorkspace({
    ...baseFiles(),
    ...extraFiles,
    "src/a.component.ts": [
      'import { Component, Input, inject, input, model } from "@angular/core";',
      "",
      `@Component({ ${metadata} })`,
      "export class AComponent {",
      ...body,
      "}",
    ].join("\n"),
  });
  const [extracted, ...rest] = extractComponents(loadWorkspace(root));
  expect(rest).toEqual([]);
  if (extracted === undefined) {
    throw new Error("no component extracted");
  }
  return computeWarnings(extracted);
}

const alsoLines = (lines: number[]) => (lines.length === 0 ? "" : ` (also lines ${lines.join(", ")})`);

describe("async-assignment", () => {
  const shown = (body: string[]) =>
    warningsOf(body, 'template: "{{ items }} {{ loading }} {{ total }} {{ count }} {{ state }} {{ last }} {{ a }}"');

  it.each([
    ["subscribe()", "this.svc.items$.subscribe((items) => {", "this.items = items;", "});"],
    ["subscribe()", "this.svc.items$.subscribe({ next: (items) => {", "this.items = items;", "} });"],
    ["subscribe()", "this.svc.items$.subscribe({ next(items) {", "this.items = items;", "} });"],
    ["setTimeout()", "setTimeout(() => {", "this.items = [];", "}, 10);"],
    ["setInterval()", "window.setInterval(function () {", "this.items = [];", "}, 10);"],
    ["then()", "this.svc.load().then((items) => {", "this.items = items;", "});"],
  ])("warns about an assignment inside a %s callback", (construct, open, assignment, close) => {
    expect(shown(["ngOnInit() {", open, assignment, close, "}"])).toEqual([
      {
        kind: "async-assignment",
        message: `this.items assigned inside ${construct} callback without markForCheck`,
        line: BODY_LINE + 2,
      },
    ]);
  });

  it("warns about assignments after an await, but not before it", () => {
    const warnings = shown([
      "async load() {",
      "  this.loading = true;",
      "  this.items = await this.svc.load();",
      "  this.loading = false;",
      "}",
    ]);
    expect(warnings).toEqual([
      { kind: "async-assignment", message: "this.items assigned after await without markForCheck", line: BODY_LINE + 2 },
      { kind: "async-assignment", message: "this.loading assigned after await without markForCheck", line: BODY_LINE + 3 },
    ]);
  });

  it("ignores an await inside a nested function", () => {
    expect(shown(["async load() {", "  const f = async () => await this.svc.load();", "  this.loading = false;", "}"])).toEqual([]);
  });

  it.each([
    ["a synchronous method", ["ngOnInit() {", "  this.items = [];", "}"]],
    ["a non-async callback", ["ngOnInit() {", "  this.list.forEach((item) => { this.last = item; });", "}"]],
    ["a callback passed to another call", ["ngOnInit() {", "  this.svc.items$.pipe(map((items) => { this.items = items; }));", "}"]],
    ["a signal update", ["ngOnInit() {", "  this.svc.items$.subscribe((items) => this.items.set(items));", "}"]],
    ["an assignment to a local", ["ngOnInit() {", "  this.svc.items$.subscribe((items) => { let x = items; x = []; });", "}"]],
    ["a property assignment", ["ngOnInit() {", "  this.svc.items$.subscribe((items) => { this.state.items = items; });", "}"]],
  ])("does not warn about %s", (_, body) => {
    expect(shown(body)).toEqual([]);
  });

  it("covers nested functions, compound assignments and increments", () => {
    const warnings = shown([
      "ngOnInit() {",
      "  this.svc.items$.subscribe((items) => {",
      "    items.forEach((item) => { this.total += item.price; });",
      "    this.count++;",
      "  });",
      "}",
    ]);
    expect(warnings.map(({ message, line }) => [message, line])).toEqual([
      ["this.total assigned inside subscribe() callback without markForCheck", BODY_LINE + 2],
      ["this.count assigned inside subscribe() callback without markForCheck", BODY_LINE + 3],
    ]);
  });

  it("reports repeated updates of a field in one construct once, listing the other lines", () => {
    const warnings = shown([
      "ngOnInit() {",
      "  this.a$.subscribe(() => { this.loading = false; });",
      "  this.b$.subscribe(() => { this.loading = false; });",
      "  setTimeout(() => { this.loading = false; });",
      "}",
    ]);
    expect(warnings).toEqual([
      {
        kind: "async-assignment",
        message: "this.loading assigned inside subscribe() callback without markForCheck (also lines 7)",
        line: BODY_LINE + 1,
      },
      { kind: "async-assignment", message: "this.loading assigned inside setTimeout() callback without markForCheck", line: BODY_LINE + 3 },
    ]);
  });

  it.each(["markForCheck", "detectChanges"])("is suppressed when the class calls %s anywhere", (method) => {
    const body = ["ngOnInit() {", "  this.a$.subscribe((a) => { this.a = a; });", "}", `refresh() { this.cdr.${method}(); }`];
    expect(shown(body)).toEqual([]);
  });

  const ASSIGN_AFTER_AWAIT = ["async load() {", "  this.items = await this.svc.load();", "}"];

  it.each([
    ["directly", "{{ items }}", []],
    ["through this", "{{ this.items }}", []],
    ["through an async pipe", "{{ items | async }}", []],
    ["through a getter", "{{ size }}", ["get size() { return this.items.length; }"]],
    ["through a called method", "{{ label() }}", ["label() { return this.items.join(); }"]],
  ])("warns about a field the template shows %s", (_, template, members) => {
    const body = [...members, ...ASSIGN_AFTER_AWAIT];
    expect(warningsOf(body, `template: "${template}"`).map(({ message }) => message)).toEqual([
      "this.items assigned after await without markForCheck",
    ]);
  });

  it.each([
    ["at all", "{{ other }}", []],
    ["only in an event handler", "<button (click)='log(items)'></button>", []],
    ["through a member it does not read", "{{ other }}", ["get size() { return this.items.length; }"]],
  ])("does not warn about a field the template does not show %s", (_, template, members) => {
    const body = [...members, ...ASSIGN_AFTER_AWAIT];
    expect(warningsOf(body, `template: "${template}"`)).toEqual([]);
  });
});

describe("input-mutation", () => {
  const mutation = (input: string, line: number, otherLines: number[] = []): Warning => ({
    kind: "input-mutation",
    message: `input ${input} mutated in place; assign a new value instead${alsoLines(otherLines)}`,
    line,
  });

  it.each(["push(1)", "pop()", "shift()", "unshift(1)", "splice(0, 1)", "sort()", "reverse()", "fill(0)", "copyWithin(0, 1)"])(
    "warns about %s on an @Input() field",
    (call) => {
      expect(warningsOf(["@Input() items: number[] = [];", `add() { this.items.${call}; }`])).toEqual([
        mutation("items", BODY_LINE + 1),
      ]);
    },
  );

  it("warns about property and element assignments at any depth", () => {
    const warnings = warningsOf([
      "@Input() config: any;",
      "@Input() items: number[] = [];",
      "update() {",
      "  this.config.a.b = 1;",
      "  this.items[0] = 2;",
      "  this.config.count++;",
      "}",
    ]);
    expect(warnings).toEqual([mutation("config", BODY_LINE + 3, [BODY_LINE + 5]), mutation("items", BODY_LINE + 4)]);
  });

  it.each(["(this.items as any).push(1)", "this.items!.sort()", "(this.items!).reverse()"])(
    "warns about %s through type assertions and parentheses",
    (statement) => {
      expect(warningsOf(["@Input() items: number[] = [];", `add() { ${statement}; }`])).toEqual([mutation("items", BODY_LINE + 1)]);
    },
  );

  it("warns about mutations through an @Input() getter of a setter/getter pair", () => {
    const warnings = warningsOf([
      "private _items: number[] = [];",
      "@Input() set items(value: number[]) { this._items = value; }",
      "get items() { return this._items; }",
      "add() { this.items.push(1); }",
    ]);
    expect(warnings).toEqual([mutation("items", BODY_LINE + 3)]);
  });

  it.each([
    ["input()", "input<number[]>([])"],
    ["input.required()", "input.required<number[]>()"],
    ["model()", "model<number[]>([])"],
    ["model.required()", "model.required<number[]>()"],
  ])("warns about mutations of a %s signal input through its call", (_, initializer) => {
    const warnings = warningsOf([`items = ${initializer};`, "add() {", "  this.items().push(1);", "  this.items()[0] = 2;", "}"]);
    expect(warnings).toEqual([mutation("items", BODY_LINE + 2, [BODY_LINE + 3])]);
  });

  it.each([
    ["reassigning the input", ["@Input() items: number[] = [];", "add() { this.items = [...this.items, 1]; }"]],
    ["mutating a copy", ["@Input() items: number[] = [];", "sorted() { return this.items.slice().sort(); }"]],
    ["mutating a non-input field", ["items: number[] = [];", "add() { this.items.push(1); this.items[0] = 2; }"]],
    ["setting a model signal", ["value = model(0);", "inc() { this.value.set(1); }"]],
    ["calling a non-mutating method", ["@Input() items: number[] = [];", "has() { return this.items.includes(1); }"]],
  ])("does not warn about %s", (_, body) => {
    expect(warningsOf(body)).toEqual([]);
  });
});

describe("service-state-in-template", () => {
  const read = (path: string, line: number, otherLines: number[] = []): Warning => ({
    kind: "service-state-in-template",
    message: `template reads ${path} from an injected service; OnPush will not see its changes${alsoLines(otherLines)}`,
    line,
  });
  const inline = (template: string) => `template: \`${template}\``;

  it("warns about members of constructor parameter properties and inject() fields", () => {
    const warnings = warningsOf(
      [
        "private readonly store = inject(Store);",
        "constructor(protected userService: UserService, readonly config: Config, plain: Plain) {}",
      ],
      inline("{{ userService.name }} @if (store.loading) {} {{ config.a.b }} {{ plain.x }}"),
    );
    expect(warnings).toEqual([read("config.a", 3), read("store.loading", 3), read("userService.name", 3)]);
  });

  it("warns about reads through this, safe navigation and in bindings, once per field and member", () => {
    const warnings = warningsOf(
      ["svc = inject(Svc);"],
      inline('\n<p [title]="svc.a.b">{{ this.svc.a }}</p>\n<p>{{ svc?.b }}</p>\n<p>{{ svc.a }}</p>'),
    );
    expect(warnings).toEqual([read("svc.a", 4, [6]), read("svc.b", 5)]);
  });

  it.each([
    ["a method call", "{{ svc.getName() }}"],
    ["a signal call", "{{ svc.count() }}"],
    ["a safe call", "{{ svc.count?.() }}"],
    ["a pipe nested in an async pipe", "{{ (svc.a$ | translate) | async }}"],
    ["a member of a non-component receiver", "{{ item.svc.name }}"],
    ["an async pipe", "@for (item of svc.items$ | async; track item) { {{ item }} }"],
    ["an event handler", '<button (click)="svc.toggle(svc.flag)"></button>'],
    ["a non-injected field", "{{ model.name }}"],
    ["the injected field itself", '<app-x [svc]="svc" />'],
  ])("does not warn about %s", (_, template) => {
    expect(warningsOf(["svc = inject(Svc);", "model = { name: '' };"], inline(template))).toEqual([]);
  });

  it("does not warn about values injected with constant-case tokens", () => {
    const warnings = warningsOf(
      ["params = inject<Params>(DIALOG_DATA);", "constructor(@Inject(DIALOG_DATA) protected data: Data) {}"],
      inline("{{ params.name }} {{ data.name }}"),
    );
    expect(warnings).toEqual([]);
  });

  it("reports lines of a templateUrl file", () => {
    const warnings = warningsOf(["constructor(private svc: Svc) {}"], 'templateUrl: "./a.html"', {
      "src/a.html": "<div>\n  <p>\n    {{ svc.name }}\n  </p>\n</div>\n",
    });
    expect(warnings).toEqual([read("svc.name", 3)]);
  });

  it("fails on template parse errors", () => {
    expect(() => warningsOf(["svc = inject(Svc);"], inline("\n<p>{{ svc. }}</p>"))).toThrow(/^src\/a\.component\.ts:4: /);
  });
});

it("sorts warnings of all kinds by line", () => {
  const warnings = warningsOf(
    [
      "svc = inject(Svc);",
      "@Input() items: number[] = [];",
      "ngOnInit() { this.svc.a$.subscribe((a) => { this.a = a; }); }",
      "add() { this.items.push(1); }",
    ],
    'template: "{{ svc.b }} {{ a }}"',
  );
  expect(warnings.map(({ kind, line }) => [kind, line])).toEqual([
    ["service-state-in-template", 3],
    ["async-assignment", BODY_LINE + 2],
    ["input-mutation", BODY_LINE + 3],
  ]);
});

it("orders warnings on the same line by kind", () => {
  const warnings = warningsOf(
    ["@Input() items: number[] = [];", "ngOnInit() { this.a$.subscribe((a) => { this.a = a; this.items.push(1); }); }"],
    'template: "{{ a }}"',
  );
  expect(warnings.map(({ kind, line }) => [kind, line])).toEqual([
    ["async-assignment", BODY_LINE + 1],
    ["input-mutation", BODY_LINE + 1],
  ]);
});
