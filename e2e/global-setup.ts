import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.join(import.meta.dirname, "..");
const REPORTS_DIR = path.join(tmpdir(), "onpush-analyzer-e2e");

/** Every payload sets window.__x or loads "x" if it ever ends up parsed as markup. */
export const HOSTILE_WORKSPACE = "ws<img src=x onerror=window.__x=1>";
export const HOSTILE_DIR = `bu"tt'on <img src=x onerror=window.__x=2> #%41 ?a=1&b`;
export const HOSTILE_SELECTOR = `acme-button, [acmeBtn="<img src=x onerror=window.__x=3>"]`;
export const HOSTILE_PROJECT = `comp<b>onents"'</script><img src=x onerror=window.__x=4>`;

export function reportUrl(name: "v21" | "hostile"): string {
  return pathToFileURL(path.join(REPORTS_DIR, name, "index.html")).href;
}

/** Generates the reports with the built CLI, so a broken build or asset copy fails here. */
export default function globalSetup(): () => void {
  rmSync(REPORTS_DIR, { recursive: true, force: true });
  mkdirSync(REPORTS_DIR);
  const fixture = path.join(ROOT, "test", "fixtures", "v21");
  generateReport(fixture, "v21");
  generateReport(createHostileWorkspace(fixture), "hostile");
  return () => rmSync(REPORTS_DIR, { recursive: true, force: true });
}

function generateReport(workspace: string, name: string): void {
  execFileSync(process.execPath, [path.join(ROOT, "dist", "main.js"), workspace, "--out", path.join(REPORTS_DIR, name)]);
}

/** The v21 fixture with markup, quotes and URL-special characters in names that reach the page. */
function createHostileWorkspace(fixture: string): string {
  const workspace = path.join(REPORTS_DIR, HOSTILE_WORKSPACE);
  cpSync(fixture, workspace, { recursive: true });
  const components = path.join(workspace, "libs", "components", "src");
  renameSync(path.join(components, "button"), path.join(components, HOSTILE_DIR));
  edit(path.join(components, "index.ts"), (text) =>
    text.replace('"./button/button.component"', JSON.stringify(`./${HOSTILE_DIR}/button.component`)),
  );
  edit(path.join(components, HOSTILE_DIR, "button.component.ts"), (text) =>
    text.replace('selector: "acme-button"', `selector: ${JSON.stringify(HOSTILE_SELECTOR)}`),
  );
  edit(path.join(workspace, "angular.json"), (text) => {
    const { components: project, ...projects } = JSON.parse(text).projects;
    return JSON.stringify({ projects: { ...projects, [HOSTILE_PROJECT]: project } });
  });
  return workspace;
}

function edit(file: string, change: (text: string) => string): void {
  const text = readFileSync(file, "utf8");
  const changed = change(text);
  if (changed === text) {
    throw new Error(`hostile workspace: ${file} did not change`);
  }
  writeFileSync(file, changed);
}
