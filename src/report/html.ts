import { readFileSync } from "node:fs";
import path from "node:path";
import type { Report } from "./data.js";

/** Copied next to the compiled module by the build script. */
const ASSETS_DIR = path.join(import.meta.dirname, "assets");

/** A single self-contained page (data, styles and script inline) that also works from file://. */
export function renderHtml(report: Report): string {
  const asset = (name: string) => readFileSync(path.join(ASSETS_DIR, name), "utf8");
  const parts = {
    style: asset("report.css"),
    script: asset("report.js"),
    data: embeddableJson(report),
  };
  return asset("template.html").replace(/\{\{(style|script|data)\}\}/g, (_placeholder, name: keyof typeof parts) => parts[name]);
}

/**
 * JSON safe inside a <script> element: "<" only occurs within JSON strings, where "\u003c" is an
 * equivalent escape, so data such as "</script>" or "<!--" cannot end the element early.
 */
function embeddableJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}
