import { parseTemplate } from "@angular/compiler";
import type { ComponentTemplate } from "./types.js";

/** Parses a component template into its root nodes; throws listing every parse error with file and line. */
export function parseComponentTemplate(template: ComponentTemplate) {
  const parsed = parseTemplate(template.source, template.file, { preserveWhitespaces: false });
  if (parsed.errors !== null) {
    throw new Error(
      parsed.errors.map((error) => `${template.file}:${template.line + error.span.start.line}: ${error.msg}`).join("\n"),
    );
  }
  return parsed.nodes;
}
