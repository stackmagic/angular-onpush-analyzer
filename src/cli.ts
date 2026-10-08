import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildReport } from "./report/data.js";
import { renderHtml } from "./report/html.js";

export const USAGE = "Usage: onpush-analyzer <workspaceRoot> [--out <dir>]";

export interface CliOptions {
  workspaceRoot: string;
  out: string;
}

export function parseCliArgs(argv: string[]): CliOptions {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { out: { type: "string", default: "report" } },
      allowPositionals: true,
    });
  } catch (error) {
    throw new Error(`${(error as Error).message}\n${USAGE}`, { cause: error });
  }
  const [workspaceRoot, ...extra] = parsed.positionals;
  if (workspaceRoot === undefined || extra.length > 0) {
    throw new Error(USAGE);
  }
  return { workspaceRoot, out: parsed.values.out };
}

export function main(): void {
  let options: CliOptions;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(2);
  }
  try {
    console.log(run(options));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

/** Writes report.json and index.html into the out dir and returns a summary naming where to open the report. */
export function run({ workspaceRoot, out }: CliOptions): string {
  const report = buildReport(workspaceRoot, new Date());
  const reportFile = path.resolve(out, "report.json");
  const htmlFile = path.resolve(out, "index.html");
  mkdirSync(out, { recursive: true });
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(htmlFile, renderHtml(report));
  const { total, onpush, ready } = report.meta.counts;
  const onpushPercent = total === 0 ? 0 : Math.round((onpush / total) * 100);
  return [
    `${total} components, ${onpushPercent}% OnPush, ${ready} ready to migrate`,
    "Report written. Open in a browser:",
    `  ${htmlFile}`,
    `  ${pathToFileURL(htmlFile).href}`,
    "Raw data:",
    `  ${reportFile}`,
  ].join("\n");
}
