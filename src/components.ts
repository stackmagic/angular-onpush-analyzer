import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { ChangeDetection, Component, ComponentTemplate, Heritage } from "./types.js";
import { compare } from "./sort.js";
import { assignProject, relativePath, type Workspace } from "./workspace.js";

export interface ExtractedComponent {
  component: Component;
  declaration: ts.ClassDeclaration;
}

interface Candidate {
  id: string;
  name: string;
  file: string;
  declaration: ts.ClassDeclaration;
  metadata: Map<string, ts.Expression>;
}

interface Context {
  workspace: Workspace;
  checker: ts.TypeChecker;
  ids: Map<ts.Node, string>;
}

const STRATEGIES = new Map<string, ChangeDetection>([
  ["Eager", "eager"],
  ["Default", "eager"],
  ["OnPush", "onpush"],
]);

export function extractComponents(workspace: Workspace): ExtractedComponent[] {
  const candidates = workspace.program.getRootFileNames().flatMap((fileName) => findCandidates(workspace, fileName));
  const context: Context = {
    workspace,
    checker: workspace.program.getTypeChecker(),
    ids: new Map(candidates.map((candidate) => [candidate.declaration, candidate.id])),
  };
  return candidates
    .map((candidate) => ({ component: readComponent(context, candidate), declaration: candidate.declaration }))
    .sort((a, b) => compare(a.component.id, b.component.id));
}

function findCandidates(workspace: Workspace, fileName: string): Candidate[] {
  const sourceFile = workspace.program.getSourceFile(fileName);
  if (sourceFile === undefined) {
    throw new Error(`${fileName}: not part of the program`);
  }
  const file = relativePath(workspace.root, fileName);
  const candidates: Candidate[] = [];
  for (const declaration of sourceFile.statements) {
    if (!ts.isClassDeclaration(declaration)) {
      continue;
    }
    const decorator = componentDecorator(declaration);
    if (decorator === undefined) {
      continue;
    }
    if (declaration.name === undefined) {
      fail(workspace, declaration, "@Component class has no name");
    }
    const name = declaration.name.text;
    const metadata = readMetadata(workspace, decorator);
    candidates.push({ id: `${file}#${name}`, name, file, declaration, metadata });
  }
  return candidates;
}

function componentDecorator(declaration: ts.ClassDeclaration): ts.CallExpression | undefined {
  for (const decorator of ts.getDecorators(declaration) ?? []) {
    const call = decorator.expression;
    if (!ts.isCallExpression(call)) {
      continue;
    }
    const callee = call.expression;
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
    if (name === "Component") {
      return call;
    }
  }
  return undefined;
}

function readMetadata(workspace: Workspace, decorator: ts.CallExpression): Map<string, ts.Expression> {
  const [argument] = decorator.arguments;
  if (argument === undefined || !ts.isObjectLiteralExpression(argument)) {
    fail(workspace, decorator, "@Component metadata must be an object literal");
  }
  const metadata = new Map<string, ts.Expression>();
  for (const property of argument.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      metadata.set(property.name.text, property.name);
    } else if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
      metadata.set(property.name.text, property.initializer);
    } else {
      fail(workspace, property, "@Component metadata entries must be `key: value` or shorthand properties");
    }
  }
  return metadata;
}

function readComponent(context: Context, candidate: Candidate): Component {
  const { workspace } = context;
  const { metadata } = candidate;
  const selector = metadata.get("selector");
  return {
    id: candidate.id,
    name: candidate.name,
    file: candidate.file,
    ...assignProject(workspace.projects, candidate.file),
    selector: selector === undefined ? null : stringLiteral(workspace, selector, "selector"),
    standalone: readStandalone(workspace, metadata.get("standalone")),
    ...readChangeDetection(workspace, metadata.get("changeDetection")),
    template: readTemplate(workspace, candidate),
    heritage: readHeritage(context, candidate.declaration),
  };
}

function readStandalone(workspace: Workspace, expression: ts.Expression | undefined): boolean {
  if (expression === undefined) {
    return workspace.angularMajor >= 19;
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  fail(workspace, expression, "standalone must be true or false");
}

function readChangeDetection(
  workspace: Workspace,
  expression: ts.Expression | undefined,
): Pick<Component, "changeDetection" | "changeDetectionExplicit"> {
  if (expression === undefined) {
    return { changeDetection: workspace.angularMajor >= 22 ? "onpush" : "eager", changeDetectionExplicit: false };
  }
  const strategy = ts.isPropertyAccessExpression(expression) ? STRATEGIES.get(expression.name.text) : undefined;
  if (strategy === undefined) {
    fail(workspace, expression, `unsupported changeDetection value \`${expression.getText()}\``);
  }
  return { changeDetection: strategy, changeDetectionExplicit: true };
}

function readTemplate(workspace: Workspace, candidate: Candidate): ComponentTemplate {
  const inline = candidate.metadata.get("template");
  const url = candidate.metadata.get("templateUrl");
  if (inline !== undefined && url !== undefined) {
    fail(workspace, inline, "@Component has both template and templateUrl");
  }
  if (inline !== undefined) {
    return { source: stringLiteral(workspace, inline, "template"), file: candidate.file, line: lineOf(inline) };
  }
  if (url === undefined) {
    fail(workspace, candidate.declaration, "@Component has neither template nor templateUrl");
  }
  const templateFile = path.resolve(path.dirname(url.getSourceFile().fileName), stringLiteral(workspace, url, "templateUrl"));
  if (!existsSync(templateFile)) {
    fail(workspace, url, `templateUrl file not found: ${relativePath(workspace.root, templateFile)}`);
  }
  return { source: readFileSync(templateFile, "utf8"), file: relativePath(workspace.root, templateFile), line: 1 };
}

function readHeritage(context: Context, declaration: ts.ClassDeclaration): Heritage {
  const heritage: Heritage = { extends: null, implements: [] };
  for (const clause of declaration.heritageClauses ?? []) {
    for (const type of clause.types) {
      const id = resolveComponentId(context, type.expression);
      if (id === undefined) {
        continue;
      }
      if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
        heritage.extends = id;
      } else {
        heritage.implements.push(id);
      }
    }
  }
  return heritage;
}

function resolveComponentId(context: Context, expression: ts.Expression): string | undefined {
  let symbol = context.checker.getSymbolAtLocation(expression);
  if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = context.checker.getAliasedSymbol(symbol);
  }
  for (const declaration of symbol?.declarations ?? []) {
    const id = context.ids.get(declaration);
    if (id !== undefined) {
      return id;
    }
  }
  return undefined;
}

function stringLiteral(workspace: Workspace, expression: ts.Expression, property: string): string {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  fail(workspace, expression, `${property} must be a string literal`);
}

export function lineOf(node: ts.Node): number {
  const sourceFile = node.getSourceFile();
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function fail(workspace: Workspace, node: ts.Node, message: string): never {
  throw new Error(`${relativePath(workspace.root, node.getSourceFile().fileName)}:${lineOf(node)}: ${message}`);
}
