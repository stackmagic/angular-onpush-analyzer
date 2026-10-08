import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface Project {
  name: string;
  /** Workspace-relative posix directory whose files belong to the project. */
  root: string;
}

export interface Workspace {
  root: string;
  angularVersion: string;
  angularMajor: number;
  projects: Project[];
  program: ts.Program;
}

export interface ProjectAssignment {
  project: string;
  projectAssigned: boolean;
}

const TSCONFIG_CANDIDATES = ["tsconfig.base.json", "tsconfig.json"];
const EXCLUDED_DIRS = new Set(["node_modules", "dist"]);
// A single version, optionally prefixed with ^, ~ or v; ranges like ">=21 <23" or "||" are ambiguous.
const SIMPLE_VERSION = /^[v^~]?(\d+(?:\.(?:\d+|x))*(?:-[0-9A-Za-z.-]+)?)$/;
const EMPTY_FILES_LIST = 18002;

export function loadWorkspace(workspaceRoot: string): Workspace {
  const root = path.resolve(workspaceRoot);
  const { angularVersion, angularMajor } = readAngularVersion(root);
  return { root, angularVersion, angularMajor, projects: readProjects(root), program: createProgram(root) };
}

export function relativePath(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

export function assignProject(projects: Project[], file: string): ProjectAssignment {
  let best: Project | undefined;
  for (const project of projects) {
    const contains = file.startsWith(`${project.root}/`);
    if (contains && (best === undefined || project.root.length > best.root.length)) {
      best = project;
    }
  }
  if (best !== undefined) {
    return { project: best.name, projectAssigned: true };
  }
  return { project: path.posix.dirname(file).split("/").slice(0, 2).join("/"), projectAssigned: false };
}

function readAngularVersion(root: string): { angularVersion: string; angularMajor: number } {
  const file = path.join(root, "package.json");
  const pkg = readJson(file) as Record<string, Record<string, unknown> | undefined>;
  const raw = pkg["dependencies"]?.["@angular/core"] ?? pkg["devDependencies"]?.["@angular/core"];
  if (typeof raw !== "string") {
    throw new Error(`${file}: @angular/core is missing from dependencies and devDependencies`);
  }
  const angularVersion = SIMPLE_VERSION.exec(raw.trim())?.[1];
  if (angularVersion === undefined) {
    throw new Error(`${file}: cannot parse @angular/core version "${raw}"`);
  }
  const angularMajor = Number(/^\d+/.exec(angularVersion)?.[0]);
  return { angularVersion, angularMajor };
}

function readProjects(root: string): Project[] {
  const file = path.join(root, "angular.json");
  const projects = (readJson(file) as { projects?: unknown }).projects;
  if (typeof projects !== "object" || projects === null || Array.isArray(projects)) {
    throw new Error(`${file}: "projects" must be an object`);
  }
  return Object.entries(projects as Record<string, { root?: unknown; sourceRoot?: unknown }>).map(
    ([name, project]) => {
      if (typeof project.root !== "string") {
        throw new Error(`${file}: project "${name}" has no string "root"`);
      }
      const root = normalizeDir(project.root);
      if (root !== "") {
        return { name, root };
      }
      // An empty root (Angular CLI's default app) would claim every file in the workspace;
      // narrow it to the sourceRoot, which the CLI itself defaults to "src".
      const sourceRoot = typeof project.sourceRoot === "string" ? normalizeDir(project.sourceRoot) : "";
      return { name, root: sourceRoot === "" ? "src" : sourceRoot };
    },
  );
}

function normalizeDir(dir: string): string {
  const normalized = path.posix.normalize(dir.replaceAll("\\", "/")).replace(/\/+$/, "");
  return normalized === "." ? "" : normalized;
}

function createProgram(root: string): ts.Program {
  const configFile = TSCONFIG_CANDIDATES.map((name) => path.join(root, name)).find((file) => existsSync(file));
  if (configFile === undefined) {
    throw new Error(`${root}: neither ${TSCONFIG_CANDIDATES.join(" nor ")} found`);
  }
  const { config, error } = ts.readConfigFile(configFile, ts.sys.readFile);
  if (error !== undefined) {
    throw new Error(formatDiagnostic(error));
  }
  const { extends: base, compilerOptions } = config as { extends?: unknown; compilerOptions?: unknown };
  // Only compilerOptions matter: the root files are collected by scanning, so the config's own
  // file list is replaced by an empty one (whose "empty files list" error is expected).
  const parsed = ts.parseJsonConfigFileContent(
    { extends: base, compilerOptions, files: [] },
    ts.sys,
    root,
    undefined,
    configFile,
  );
  const errors = parsed.errors.filter((diagnostic) => diagnostic.code !== EMPTY_FILES_LIST);
  if (errors.length > 0) {
    throw new Error(errors.map(formatDiagnostic).join("\n"));
  }
  const options = { ...parsed.options, noEmit: true, skipLibCheck: true };
  // Parent pointers let consumers walk any node (getSourceFile, getText) before the checker binds.
  return ts.createProgram(collectSourceFiles(root), options, ts.createCompilerHost(options, true));
}

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && !EXCLUDED_DIRS.has(entry.name)) {
        files.push(...collectSourceFiles(file));
      }
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !/\.(spec|stories|d)\.ts$/.test(entry.name)) {
      files.push(file);
    }
  }
  return files.sort();
}

function readJson(file: string): unknown {
  if (!existsSync(file)) {
    throw new Error(`${file}: file not found`);
  }
  const { config, error } = ts.parseConfigFileTextToJson(file, readFileSync(file, "utf8"));
  if (error !== undefined) {
    throw new Error(formatDiagnostic(error));
  }
  return config;
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  return diagnostic.file === undefined ? message : `${diagnostic.file.fileName}: ${message}`;
}
