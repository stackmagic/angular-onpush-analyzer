import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractComponents } from "../src/components.js";
import { computeEdges } from "../src/edges.js";
import { analyzeGraph } from "../src/graph.js";
import type { ChangeDetection, Edge, EdgeKind } from "../src/types.js";
import { loadWorkspace } from "../src/workspace.js";

/** Builds a graph from `name: [changeDetection, ...dependencies]`; a dependency may be `name!` for an ambiguous edge. */
function analyze(spec: Record<string, [ChangeDetection, ...string[]]>, kind: EdgeKind = "template") {
  const components = Object.entries(spec).map(([id, [changeDetection]]) => ({ id, changeDetection }));
  const edges = new Map(
    Object.entries(spec).map(([id, [, ...targets]]) => [
      id,
      {
        edges: targets.map(
          (target): Edge => ({ to: target.replace("!", ""), kind, ambiguous: target.endsWith("!") }),
        ),
      },
    ]),
  );
  const { components: graph, cycles } = analyzeGraph(components, edges);
  const get = (id: string) => {
    const entry = graph.get(id);
    if (entry === undefined) {
      throw new Error(`no graph entry for ${id}`);
    }
    return entry;
  };
  return { get, cycles };
}

const waves = (spec: Record<string, [ChangeDetection, ...string[]]>) => {
  const { get } = analyze(spec);
  return Object.keys(spec).map((id) => get(id).wave);
};

describe("ready and wave", () => {
  it("makes a leaf eager component ready in wave 0", () => {
    const { get } = analyze({ a: ["eager"] });
    expect(get("a")).toMatchObject({ ready: true, wave: 0 });
  });

  it("makes an eager component with onpush dependencies ready", () => {
    const { get } = analyze({ a: ["eager", "b", "c"], b: ["onpush"], c: ["onpush", "b"] });
    expect(get("a")).toMatchObject({ ready: true, wave: 0 });
  });

  it("blocks an eager component with an eager dependency", () => {
    const { get } = analyze({ a: ["eager", "b"], b: ["eager"] });
    expect(get("a")).toMatchObject({ ready: false, wave: 1 });
    expect(get("b")).toMatchObject({ ready: true, wave: 0 });
  });

  it("numbers a chain of eager components", () => {
    expect(waves({ a: ["eager", "b"], b: ["eager", "c"], c: ["eager"] })).toEqual([2, 1, 0]);
  });

  it("takes the longest branch of a diamond", () => {
    expect(
      waves({ a: ["eager", "b", "c"], b: ["eager", "d"], c: ["eager", "e"], d: ["eager"], e: ["eager", "d"] }),
    ).toEqual([3, 1, 2, 0, 1]);
  });

  it("looks through onpush components only for their own blockers, not for waves", () => {
    expect(waves({ a: ["eager", "b"], b: ["onpush", "c"], c: ["eager"] })).toEqual([0, null, 0]);
  });

  it("gives onpush components no readiness and no wave", () => {
    const { get } = analyze({ a: ["onpush", "b"], b: ["eager"] });
    expect(get("a")).toMatchObject({ ready: false, wave: null });
  });

  it("counts ambiguous and non-template edges like any other", () => {
    expect(waves({ a: ["eager", "b!"], b: ["eager"] })).toEqual([1, 0]);
    const { get } = analyze({ a: ["eager", "b"], b: ["eager"] }, "extends");
    expect(get("a").wave).toBe(1);
  });
});

describe("cycles", () => {
  it("makes a cycle of eager components with an onpush dependency ready as a whole", () => {
    const { get, cycles } = analyze({ a: ["eager", "b", "x"], b: ["eager", "a"], x: ["onpush"] });
    expect(cycles).toEqual([["a", "b"]]);
    expect(get("a")).toMatchObject({ ready: true, wave: 0, cycleId: 0 });
    expect(get("b")).toMatchObject({ ready: true, wave: 0, cycleId: 0 });
    expect(get("x").cycleId).toBeNull();
  });

  it("puts a cycle with an eager outside dependency in the next wave", () => {
    const { get } = analyze({ a: ["eager", "b"], b: ["eager", "a", "x"], x: ["eager"] });
    expect(get("a")).toMatchObject({ ready: false, wave: 1 });
    expect(get("b")).toMatchObject({ ready: false, wave: 1 });
  });

  it("waits for the wave of a cycle depended on from outside", () => {
    expect(waves({ a: ["eager", "b"], b: ["eager", "c"], c: ["eager", "b", "d"], d: ["eager"] })).toEqual([2, 1, 1, 0]);
  });

  it("handles a cycle with one onpush and one eager member", () => {
    const { get } = analyze({ a: ["eager", "b"], b: ["onpush", "a"] });
    expect(get("a")).toMatchObject({ ready: true, wave: 0, cycleId: 0 });
    expect(get("b")).toMatchObject({ ready: false, wave: null, cycleId: 0 });
  });

  it("is blocked by an eager dependency of an onpush cycle member", () => {
    const { get } = analyze({ a: ["eager", "b"], b: ["onpush", "a", "x"], x: ["eager"] });
    expect(get("a")).toMatchObject({ ready: false, wave: 1 });
  });

  it("orders groups by smallest member and members by id", () => {
    const { get, cycles } = analyze({
      z: ["eager", "y"],
      y: ["eager", "z"],
      c: ["eager", "a"],
      a: ["eager", "b"],
      b: ["eager", "c"],
      solo: ["eager"],
    });
    expect(cycles).toEqual([
      ["a", "b", "c"],
      ["y", "z"],
    ]);
    expect(get("b").cycleId).toBe(0);
    expect(get("z").cycleId).toBe(1);
    expect(get("solo").cycleId).toBeNull();
  });
});

describe("deep graphs", () => {
  it("analyzes a long eager chain without overflowing the call stack", () => {
    const length = 5_000;
    // Ids sort in chain order, so the first traversal starts at the head and goes the full depth.
    const name = (i: number) => `c${String(i).padStart(5, "0")}`;
    const spec: Record<string, [ChangeDetection, ...string[]]> = {};
    for (let i = 0; i < length; i++) {
      spec[name(i)] = i === length - 1 ? ["eager"] : ["eager", name(i + 1)];
    }
    const { get, cycles } = analyze(spec);
    expect(cycles).toEqual([]);
    expect(get(name(length - 1)).wave).toBe(0);
    expect(get(name(0))).toMatchObject({ wave: length - 1, transitiveDependencies: length - 1 });
  });
});

describe("dependencies and dependents", () => {
  it("lists direct dependencies and sorted dependents with their kinds", () => {
    const components = ["a", "b", "c"].map((id) => ({ id, changeDetection: "eager" as const }));
    const { components: graph } = analyzeGraph(
      components,
      new Map([
        ["a", { edges: [] }],
        ["b", { edges: [{ to: "a", kind: "template", ambiguous: true }] }],
        [
          "c",
          {
            edges: [
              { to: "a", kind: "extends", ambiguous: false },
              { to: "a", kind: "template", ambiguous: false },
            ],
          },
        ],
      ]),
    );
    expect(graph.get("a")?.dependents).toEqual([
      { from: "b", kind: "template", ambiguous: true },
      { from: "c", kind: "extends", ambiguous: false },
      { from: "c", kind: "template", ambiguous: false },
    ]);
    expect(graph.get("c")?.dependencies).toHaveLength(2);
    expect(graph.get("a")?.transitiveDependents).toBe(2);
  });

  it("counts transitive reach once per component, excluding the component itself", () => {
    const { get } = analyze({
      a: ["eager", "b", "c"],
      b: ["eager", "d"],
      c: ["eager", "d"],
      d: ["eager", "a"],
      e: ["eager", "a"],
    });
    expect(get("a")).toMatchObject({ transitiveDependencies: 3, transitiveDependents: 4 });
    expect(get("d")).toMatchObject({ transitiveDependencies: 3, transitiveDependents: 4 });
    expect(get("e")).toMatchObject({ transitiveDependencies: 4, transitiveDependents: 0 });
  });
});

describe("invalid input", () => {
  it("throws on an unknown edge target", () => {
    expect(() => analyze({ a: ["eager", "ghost"] })).toThrow("a depends on unknown component ghost");
  });

  it("throws on a component without edges", () => {
    expect(() => analyzeGraph([{ id: "a", changeDetection: "eager" }], new Map())).toThrow("no edges given");
  });

  it("throws on edges of an unknown component", () => {
    expect(() => analyzeGraph([], new Map([["ghost", { edges: [] }]]))).toThrow("unknown component ghost");
  });
});

describe("analyzeGraph on the v21 fixture", () => {
  const components = extractComponents(loadWorkspace(path.join(import.meta.dirname, "fixtures", "v21"))).map(
    ({ component }) => component,
  );
  const { components: graph, cycles } = analyzeGraph(components, computeEdges(components));
  const list = "libs/vault/src/vault-list.component.ts#VaultListComponent";
  const item = "libs/vault/src/vault-item.component.ts#VaultItemComponent";

  it("detects the vault template cycle", () => {
    expect(cycles).toContainEqual([item, list].sort());
    expect(graph.get(list)?.cycleId).toBe(graph.get(item)?.cycleId);
    expect(graph.get(list)?.cycleId).not.toBeNull();
  });

  it("derives a consistent wave for every component", () => {
    for (const { id, changeDetection } of components) {
      const entry = graph.get(id);
      expect(entry?.wave === null).toBe(changeDetection === "onpush");
      expect(entry?.ready).toBe(entry?.wave === 0);
    }
  });
});
