import { compare } from "./sort.js";
import type { Component, ComponentEdges, ComponentGraph, Dependent, GraphAnalysis } from "./types.js";

type GraphNode = Pick<Component, "id" | "changeDetection">;

/** Derives dependents, transitive counts, cycles, readiness and migration waves from the component edges. */
export function analyzeGraph(
  components: GraphNode[],
  edges: Map<string, Pick<ComponentEdges, "edges">>,
): GraphAnalysis {
  const ids = components.map(({ id }) => id).sort(compare);
  const eager = new Set(components.filter(({ changeDetection }) => changeDetection === "eager").map(({ id }) => id));
  const known = new Set(ids);

  const dependencies = new Map(
    ids.map((id) => {
      const componentEdges = edges.get(id);
      if (componentEdges === undefined) {
        throw new Error(`no edges given for component ${id}`);
      }
      return [id, componentEdges.edges];
    }),
  );
  const dependents = new Map<string, Dependent[]>(ids.map((id) => [id, []]));
  for (const [from, outgoing] of dependencies) {
    for (const { to, kind, ambiguous } of outgoing) {
      const incoming = dependents.get(to);
      if (incoming === undefined) {
        throw new Error(`${from} depends on unknown component ${to}`);
      }
      incoming.push({ from, kind, ambiguous });
    }
  }
  for (const id of edges.keys()) {
    if (!known.has(id)) {
      throw new Error(`edges given for unknown component ${id}`);
    }
  }
  for (const incoming of dependents.values()) {
    incoming.sort((a, b) => compare(a.from, b.from) || compare(a.kind, b.kind));
  }

  const dependencyIds = new Map(ids.map((id) => [id, uniqueTargets(dependencies.get(id) ?? [])]));
  const dependentIds = new Map(ids.map((id) => [id, uniqueSources(dependents.get(id) ?? [])]));

  // Tarjan emits a group only after every group it depends on, which is the order wave numbers need.
  const groups = stronglyConnectedComponents(ids, dependencyIds);
  const groupOf = new Map<string, number>();
  groups.forEach((group, index) => group.forEach((id) => groupOf.set(id, index)));
  const groupWave = new Map<number, number>();
  const groupReady = new Map<number, boolean>();
  groups.forEach((group, index) => {
    const blockerWaves = group
      .flatMap((id) => dependencyIds.get(id) ?? [])
      .filter((to) => groupOf.get(to) !== index && eager.has(to))
      .map((to) => groupWave.get(groupOf.get(to) as number) as number);
    groupWave.set(index, blockerWaves.length === 0 ? 0 : 1 + Math.max(...blockerWaves));
    groupReady.set(index, blockerWaves.length === 0);
  });

  const cycles = groups
    .filter((group) => group.length > 1)
    .map((group) => [...group].sort(compare))
    .sort((a, b) => compare(a[0] as string, b[0] as string));
  const cycleIds = new Map(cycles.flatMap((group, index) => group.map((id) => [id, index] as const)));

  const result = new Map<string, ComponentGraph>();
  for (const id of ids) {
    const group = groupOf.get(id) as number;
    const isEager = eager.has(id);
    result.set(id, {
      dependencies: dependencies.get(id) ?? [],
      dependents: dependents.get(id) ?? [],
      transitiveDependencies: reachableCount(id, dependencyIds),
      transitiveDependents: reachableCount(id, dependentIds),
      cycleId: cycleIds.get(id) ?? null,
      ready: isEager && groupReady.get(group) === true,
      wave: isEager ? (groupWave.get(group) as number) : null,
    });
  }
  return { components: result, cycles };
}

function uniqueTargets(edges: { to: string }[]): string[] {
  return [...new Set(edges.map(({ to }) => to))];
}

function uniqueSources(dependents: Dependent[]): string[] {
  return [...new Set(dependents.map(({ from }) => from))];
}

function reachableCount(start: string, adjacency: Map<string, string[]>): number {
  const seen = new Set<string>([start]);
  const queue = [start];
  for (const current of queue) {
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.size - 1;
}

/** Tarjan's algorithm with an explicit work stack, so deep chains cannot overflow the call stack; groups are returned dependencies-first. */
function stronglyConnectedComponents(ids: string[], adjacency: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const groups: string[][] = [];

  const open = (id: string): { id: string; nextEdge: number } => {
    index.set(id, index.size);
    lowLink.set(id, index.get(id) as number);
    stack.push(id);
    onStack.add(id);
    return { id, nextEdge: 0 };
  };
  const lowerLink = (id: string, value: number): void => {
    lowLink.set(id, Math.min(lowLink.get(id) as number, value));
  };

  for (const root of ids) {
    if (index.has(root)) {
      continue;
    }
    const work = [open(root)];
    while (work.length > 0) {
      const frame = work[work.length - 1] as (typeof work)[number];
      const targets = adjacency.get(frame.id) ?? [];
      if (frame.nextEdge < targets.length) {
        const next = targets[frame.nextEdge] as string;
        frame.nextEdge += 1;
        if (!index.has(next)) {
          work.push(open(next));
        } else if (onStack.has(next)) {
          lowerLink(frame.id, index.get(next) as number);
        }
        continue;
      }

      work.pop();
      if (lowLink.get(frame.id) === index.get(frame.id)) {
        const group: string[] = [];
        let member: string;
        do {
          member = stack.pop() as string;
          onStack.delete(member);
          group.push(member);
        } while (member !== frame.id);
        groups.push(group);
      }
      const parent = work[work.length - 1];
      if (parent !== undefined) {
        lowerLink(parent.id, lowLink.get(frame.id) as number);
      }
    }
  }
  return groups;
}
