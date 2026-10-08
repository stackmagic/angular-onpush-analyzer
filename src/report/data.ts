import path from "node:path";
import { extractComponents } from "../components.js";
import { computeEdges } from "../edges.js";
import { analyzeGraph } from "../graph.js";
import { compare } from "../sort.js";
import type { Component, ComponentGraph, Edge, Dependent, Heritage, Warning } from "../types.js";
import { computeWarnings } from "../warnings.js";
import { loadWorkspace } from "../workspace.js";
import { gitCommit } from "./git.js";

export interface ReportWarning extends Warning {
  /** Workspace-relative file the line refers to: the template file for template warnings, else the component file. */
  file: string;
}

/** The template source is omitted to keep the report small; `file` and `line` locate it. */
export interface ReportComponent {
  id: string;
  name: string;
  file: string;
  project: string;
  projectAssigned: boolean;
  selector: string | null;
  standalone: boolean;
  changeDetection: Component["changeDetection"];
  changeDetectionExplicit: boolean;
  template: { file: string; line: number };
  heritage: Heritage;
  dependencies: Edge[];
  dependents: Dependent[];
  unmatchedElements: string[];
  transitiveDependencies: number;
  transitiveDependents: number;
  cycleId: number | null;
  ready: boolean;
  wave: number | null;
  warnings: ReportWarning[];
}

export interface ReportCounts {
  total: number;
  eager: number;
  onpush: number;
  ready: number;
  /** Eager components per migration wave, keyed by wave number. */
  perWave: Record<string, number>;
  cycles: number;
}

export interface Report {
  meta: {
    generatedAt: string;
    workspace: string;
    angularVersion: string;
    gitCommit: string | null;
    counts: ReportCounts;
  };
  components: ReportComponent[];
  cycles: string[][];
}

export function buildReport(workspaceRoot: string, generatedAt: Date): Report {
  const workspace = loadWorkspace(workspaceRoot);
  const extracted = extractComponents(workspace);
  const edges = computeEdges(extracted.map(({ component }) => component));
  const { components: graph, cycles } = analyzeGraph(
    extracted.map(({ component }) => component),
    edges,
  );

  const components = extracted
    .map((item): ReportComponent => {
      const { component } = item;
      const { template, ...facts } = component;
      return {
        ...facts,
        template: { file: template.file, line: template.line },
        ...(graph.get(component.id) as ComponentGraph),
        unmatchedElements: (edges.get(component.id) as { unmatchedElements: string[] }).unmatchedElements,
        warnings: computeWarnings(item).map((warning) => ({
          ...warning,
          file: warning.kind === "service-state-in-template" ? template.file : component.file,
        })),
      };
    })
    .sort((a, b) => compare(a.id, b.id));

  return {
    meta: {
      generatedAt: generatedAt.toISOString(),
      workspace: path.basename(workspace.root),
      angularVersion: workspace.angularVersion,
      gitCommit: gitCommit(workspace.root),
      counts: countComponents(components, cycles.length),
    },
    components,
    cycles,
  };
}

function countComponents(components: ReportComponent[], cycles: number): ReportCounts {
  const perWave: Record<string, number> = {};
  for (const { wave } of components) {
    if (wave !== null) {
      perWave[wave] = (perWave[wave] ?? 0) + 1;
    }
  }
  return {
    total: components.length,
    eager: components.filter(({ changeDetection }) => changeDetection === "eager").length,
    onpush: components.filter(({ changeDetection }) => changeDetection === "onpush").length,
    ready: components.filter(({ ready }) => ready).length,
    perWave,
    cycles,
  };
}
