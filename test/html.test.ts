import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildReport } from "../src/report/data.js";
import { renderHtml } from "../src/report/html.js";

const report = buildReport(path.join(import.meta.dirname, "fixtures", "v21"), new Date("2026-01-02T03:04:05.678Z"));

function embeddedData(html: string): unknown {
  const match = /<script id="report-data" type="application\/json">(.*?)<\/script>/s.exec(html);
  if (match?.[1] === undefined) {
    throw new Error("no embedded report data");
  }
  return JSON.parse(match[1]);
}

describe("renderHtml", () => {
  it("embeds the report data so that it round-trips", () => {
    expect(embeddedData(renderHtml(report))).toEqual(report);
  });

  it("keeps markup and placeholder-like text in the data from breaking out", () => {
    const hostile = "</script><script>alert(1)</script><!-- {{script}} $& $1";
    const tampered = { ...report, components: report.components.map((component) => ({ ...component, name: hostile })) };

    const html = renderHtml(tampered);

    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(html).not.toContain("<!-- {{");
    expect(embeddedData(html)).toEqual(tampered);
  });

  it("inlines styles and script and makes no external requests", () => {
    const html = renderHtml(report);

    expect(html).not.toMatch(/\{\{\w+\}\}/);
    expect(html).toContain("<style>\n:root {");
    expect(html).toMatch(/<script type="module">\nconst report = /);
    expect(html).not.toMatch(/\b(src|href)\s*=\s*["']?(https?:)?\/\//i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<link\b/i);
  });
});
