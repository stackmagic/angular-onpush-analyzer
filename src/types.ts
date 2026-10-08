export type ChangeDetection = "eager" | "onpush";

export interface ComponentTemplate {
  source: string;
  /** Workspace-relative posix path of the templateUrl file, or of the .ts file for inline templates. */
  file: string;
  /** 1-based line in `file` on which `source` starts. */
  line: number;
}

export interface Heritage {
  extends: string | null;
  implements: string[];
}

export interface Component {
  id: string;
  name: string;
  file: string;
  project: string;
  projectAssigned: boolean;
  selector: string | null;
  standalone: boolean;
  changeDetection: ChangeDetection;
  changeDetectionExplicit: boolean;
  template: ComponentTemplate;
  heritage: Heritage;
}

export type EdgeKind = "template" | "extends" | "implements";

export interface Edge {
  /** Id of the component depended on. */
  to: string;
  kind: EdgeKind;
  /** A template element using `to` also matched other components' selectors. */
  ambiguous: boolean;
}

export interface ComponentEdges {
  edges: Edge[];
  /** Custom element tag names in the template that match no component. */
  unmatchedElements: string[];
}

export interface Dependent {
  /** Id of the component that depends on this one. */
  from: string;
  kind: EdgeKind;
  ambiguous: boolean;
}

export interface ComponentGraph {
  dependencies: Edge[];
  dependents: Dependent[];
  /** Distinct components reachable through dependencies, excluding the component itself. */
  transitiveDependencies: number;
  /** Distinct components that reach this one through dependencies, excluding the component itself. */
  transitiveDependents: number;
  /** Index into `GraphAnalysis.cycles`, or null if the component is not part of a cycle. */
  cycleId: number | null;
  ready: boolean;
  /** Null for onpush components. */
  wave: number | null;
}

export interface GraphAnalysis {
  components: Map<string, ComponentGraph>;
  /** Strongly connected groups of more than one component; members and groups sorted by id. */
  cycles: string[][];
}

export type WarningKind = "async-assignment" | "input-mutation" | "service-state-in-template";

export interface Warning {
  kind: WarningKind;
  message: string;
  /** 1-based; in the template file for `service-state-in-template`, else in the component file. */
  line: number;
}
