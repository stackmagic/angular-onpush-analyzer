import {
  CombinedRecursiveAstVisitor,
  ImplicitReceiver,
  PropertyRead,
  SafePropertyRead,
  ThisReceiver,
  tmplAstVisitAll,
  type AST,
  type BindingPipe,
  type Call,
  type SafeCall,
} from "@angular/compiler";
import ts from "typescript";
import { lineOf, type ExtractedComponent } from "./components.js";
import { compare } from "./sort.js";
import { parseComponentTemplate } from "./template.js";
import type { ComponentTemplate, Warning, WarningKind } from "./types.js";

type FunctionNode =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.AccessorDeclaration
  | ts.ConstructorDeclaration;

interface MemberAccess {
  /** Name of the `this.<field>` the access starts from. */
  field: string;
  /** A property or element of the field's value is accessed, as in `this.field.x` or `this.field()[i]`. */
  nested: boolean;
  /** The field is called first, as in `this.field().x`. */
  viaCall: boolean;
}

interface Site {
  /** Sites with the same key are reported as one warning. */
  key: string;
  message: string;
  line: number;
}

const ASYNC_CALLBACK_CALLEES = new Set(["subscribe", "then", "setTimeout", "setInterval"]);
const CHANGE_DETECTOR_CALLS = new Set(["markForCheck", "detectChanges"]);
const MUTATING_METHODS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"]);
const SIGNAL_INPUT_FACTORIES = new Set(["input", "input.required", "model", "model.required"]);

/** Heuristic hints that a component may misbehave after switching to OnPush, sorted by line. */
export function computeWarnings({ component, declaration }: ExtractedComponent): Warning[] {
  const nodes = descendants(declaration);
  const reads = readTemplate(component.template, injectedFields(declaration));
  return [
    ...asyncAssignments(declaration, nodes, renderedFields(declaration, reads.componentMembers)),
    ...inputMutations(declaration, nodes),
    ...serviceStateInTemplate(component.template, reads),
  ].sort((a, b) => a.line - b.line || compare(a.kind, b.kind) || compare(a.message, b.message));
}

function asyncAssignments(declaration: ts.ClassDeclaration, nodes: ts.Node[], rendered: Set<string>): Warning[] {
  if (nodes.some((node) => ts.isCallExpression(node) && CHANGE_DETECTOR_CALLS.has(calleeName(node) ?? ""))) {
    return [];
  }
  const sites = nodes.flatMap((node): Site[] => {
    const target = assignmentTarget(node);
    const access = target && thisMemberAccess(target);
    if (access === undefined || access.viaCall || access.nested || !rendered.has(access.field)) {
      return [];
    }
    const construct = asyncConstruct(node, declaration);
    if (construct === undefined) {
      return [];
    }
    const message = `this.${access.field} assigned ${construct} without markForCheck`;
    return [{ key: message, message, line: lineOf(node) }];
  });
  return groupSites("async-assignment", sites);
}

/** Describes the innermost enclosing callback or post-await position that runs outside the triggering event. */
function asyncConstruct(node: ts.Node, declaration: ts.ClassDeclaration): string | undefined {
  for (let current = node.parent; current !== declaration; current = current.parent) {
    if (!isFunctionNode(current)) {
      continue;
    }
    const callee = callbackCallee(current);
    if (callee !== undefined) {
      return `inside ${callee}() callback`;
    }
    if (isAsync(current) && awaitsBefore(current, node.getEnd())) {
      return "after await";
    }
  }
  return undefined;
}

function callbackCallee(fn: FunctionNode): string | undefined {
  // Observer objects: subscribe({ next: (value) => ... }) and subscribe({ next(value) { ... } }).
  const argument = ts.isPropertyAssignment(fn.parent) ? fn.parent.parent : ts.isMethodDeclaration(fn) ? fn.parent : fn;
  const call = argument.parent;
  if (!ts.isCallExpression(call) || call.expression === argument) {
    return undefined;
  }
  const name = calleeName(call);
  return name !== undefined && ASYNC_CALLBACK_CALLEES.has(name) ? name : undefined;
}

function awaitsBefore(fn: FunctionNode, position: number): boolean {
  const visit = (node: ts.Node): boolean =>
    node.getStart() < position &&
    (ts.isAwaitExpression(node) || (!isFunctionNode(node) && ts.forEachChild(node, visit) === true));
  return fn.body !== undefined && ts.forEachChild(fn.body, visit) === true;
}

function inputMutations(declaration: ts.ClassDeclaration, nodes: ts.Node[]): Warning[] {
  const inputs = inputFields(declaration);
  const sites = nodes.flatMap((node): Site[] => {
    const access = mutatedAccess(node);
    // A signal input's value is reached through its call, a decorated input's directly.
    if (access === undefined || inputs.get(access.field) !== access.viaCall) {
      return [];
    }
    return [
      { key: access.field, message: `input ${access.field} mutated in place; assign a new value instead`, line: lineOf(node) },
    ];
  });
  return groupSites("input-mutation", sites);
}

/** The access whose value `node` mutates in place: `x.push(...)`, `x.prop = ...`, `x[i]++`. */
function mutatedAccess(node: ts.Node): MemberAccess | undefined {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && MUTATING_METHODS.has(node.expression.name.text)) {
    return thisMemberAccess(node.expression.expression);
  }
  const target = assignmentTarget(node);
  const access = target && thisMemberAccess(target);
  return access?.nested ? access : undefined;
}

/** Input field names mapped to whether they are signal inputs. */
function inputFields(declaration: ts.ClassDeclaration): Map<string, boolean> {
  const inputs = new Map<string, boolean>();
  for (const member of declaration.members) {
    if (!(ts.isPropertyDeclaration(member) || ts.isAccessor(member)) || !ts.isIdentifier(member.name)) {
      continue;
    }
    if (ts.getDecorators(member)?.some(({ expression }) => ts.isCallExpression(expression) && calleeText(expression) === "Input")) {
      inputs.set(member.name.text, false);
    }
    const initializer = ts.isPropertyDeclaration(member) ? member.initializer : undefined;
    if (initializer !== undefined && ts.isCallExpression(initializer) && SIGNAL_INPUT_FACTORIES.has(calleeText(initializer))) {
      inputs.set(member.name.text, true);
    }
  }
  return inputs;
}

/** Fields the template shows: read directly, or through a getter or method the template reads or calls. */
function renderedFields(declaration: ts.ClassDeclaration, templateMembers: Set<string>): Set<string> {
  const rendered = new Set(templateMembers);
  for (const member of declaration.members) {
    if ((ts.isGetAccessor(member) || ts.isMethodDeclaration(member)) && ts.isIdentifier(member.name) && templateMembers.has(member.name.text)) {
      for (const node of descendants(member)) {
        const field = thisPropertyName(node);
        if (field !== undefined) {
          rendered.add(field);
        }
      }
    }
  }
  return rendered;
}

function readTemplate(template: ComponentTemplate, injected: Set<string>): TemplateReads {
  const reads = new TemplateReads(injected);
  tmplAstVisitAll(reads, parseComponentTemplate(template));
  return reads;
}

function serviceStateInTemplate(template: ComponentTemplate, reads: TemplateReads): Warning[] {
  return groupSites(
    "service-state-in-template",
    reads.injectedMembers.map(({ field, member, offset }) => ({
      key: `${field}.${member}`,
      message: `template reads ${field}.${member} from an injected service; OnPush will not see its changes`,
      line: template.line + lineIndex(template.source, offset),
    })),
  );
}

/** Constructor parameter properties and fields initialized with `inject(...)`, except those injecting value tokens. */
function injectedFields(declaration: ts.ClassDeclaration): Set<string> {
  const fields = new Set<string>();
  for (const member of declaration.members) {
    if (ts.isConstructorDeclaration(member)) {
      for (const parameter of member.parameters) {
        if (
          ts.isParameterPropertyDeclaration(parameter, member) &&
          ts.isIdentifier(parameter.name) &&
          !isValueToken(injectDecoratorToken(parameter))
        ) {
          fields.add(parameter.name.text);
        }
      }
    } else if (
      ts.isPropertyDeclaration(member) &&
      ts.isIdentifier(member.name) &&
      member.initializer !== undefined &&
      ts.isCallExpression(member.initializer) &&
      calleeText(member.initializer) === "inject" &&
      !isValueToken(member.initializer.arguments[0])
    ) {
      fields.add(member.name.text);
    }
  }
  return fields;
}

function injectDecoratorToken(parameter: ts.ParameterDeclaration): ts.Expression | undefined {
  for (const { expression } of ts.getDecorators(parameter) ?? []) {
    if (ts.isCallExpression(expression) && calleeText(expression) === "Inject") {
      return expression.arguments[0];
    }
  }
  return undefined;
}

// Tokens named in constant case (DIALOG_DATA, WINDOW) conventionally provide values fixed at creation, not service state.
function isValueToken(token: ts.Expression | undefined): boolean {
  return token !== undefined && ts.isIdentifier(token) && /^[A-Z][A-Z\d_]*$/.test(token.text);
}

/** What the template's bindings (not its event handlers) read from the component. */
class TemplateReads extends CombinedRecursiveAstVisitor {
  /** Component members read or called, as `name` or `this.name`. */
  readonly componentMembers = new Set<string>();
  /** Members of injected fields read outside `async` pipes and not called. */
  readonly injectedMembers: { field: string; member: string; offset: number }[] = [];
  private insideAsyncPipe = false;

  constructor(private readonly injected: Set<string>) {
    super();
  }

  // An event marks the OnPush view for check anyway, so what its handler reads does not matter.
  override visitBoundEvent(): void {}

  override visitPipe(pipe: BindingPipe, context: unknown): void {
    const outer = this.insideAsyncPipe;
    this.insideAsyncPipe = outer || pipe.name === "async";
    super.visitPipe(pipe, context);
    this.insideAsyncPipe = outer;
  }

  override visitCall(call: Call | SafeCall, context: unknown): void {
    const { receiver } = call;
    if (receiver instanceof PropertyRead || receiver instanceof SafePropertyRead) {
      // A called member of an injected field is a method or a signal; we cannot tell them apart without types.
      this.recordComponentMember(receiver);
      this.visit(receiver.receiver);
    } else {
      this.visit(receiver);
    }
    this.visitAll(call.args, context);
  }

  override visitSafeCall(call: SafeCall, context: unknown): void {
    this.visitCall(call, context);
  }

  override visitPropertyRead(read: PropertyRead, context: unknown): void {
    this.recordRead(read);
    super.visitPropertyRead(read, context);
  }

  override visitSafePropertyRead(read: SafePropertyRead, context: unknown): void {
    this.recordRead(read);
    super.visitSafePropertyRead(read, context);
  }

  private recordRead(read: PropertyRead | SafePropertyRead): void {
    this.recordComponentMember(read);
    const field = read.receiver;
    if (
      !this.insideAsyncPipe &&
      field instanceof PropertyRead &&
      isComponentReceiver(field.receiver) &&
      this.injected.has(field.name)
    ) {
      this.injectedMembers.push({ field: field.name, member: read.name, offset: read.sourceSpan.start });
    }
  }

  private recordComponentMember(read: PropertyRead | SafePropertyRead): void {
    if (isComponentReceiver(read.receiver)) {
      this.componentMembers.add(read.name);
    }
  }
}

function isComponentReceiver(receiver: AST): boolean {
  return receiver instanceof ImplicitReceiver || receiver instanceof ThisReceiver;
}

function assignmentTarget(node: ts.Node): ts.Expression | undefined {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    return node.left;
  }
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return node.operand;
  }
  return undefined;
}

/** Resolves `this.field`, `this.field.a[b]` or `this.field().a` to the field it starts from. */
function thisMemberAccess(expression: ts.Expression, nested = false): MemberAccess | undefined {
  const node = skipWrappers(expression);
  const field = thisPropertyName(node);
  if (field !== undefined) {
    return { field, nested, viaCall: false };
  }
  if (ts.isCallExpression(node) && node.arguments.length === 0) {
    const signal = thisPropertyName(skipWrappers(node.expression));
    return signal === undefined ? undefined : { field: signal, nested, viaCall: true };
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return thisMemberAccess(node.expression, true);
  }
  return undefined;
}

function thisPropertyName(node: ts.Node): string | undefined {
  return ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword ? node.name.text : undefined;
}

function skipWrappers(expression: ts.Expression): ts.Expression {
  let node = expression;
  while (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node)) {
    node = node.expression;
  }
  return node;
}

function calleeName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  return ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
}

function calleeText(call: ts.CallExpression): string {
  return call.expression.getText();
}

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isAccessor(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function isAsync(fn: FunctionNode): boolean {
  return ts.getModifiers(fn)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
}

function descendants(root: ts.Node): ts.Node[] {
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    nodes.push(node);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
  return nodes;
}

/** One warning per key, at the first site's line, listing the other sites' lines. */
function groupSites(kind: WarningKind, sites: Site[]): Warning[] {
  const groups = new Map<string, { message: string; line: number; others: Set<number> }>();
  for (const { key, message, line } of [...sites].sort((a, b) => a.line - b.line)) {
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { message, line, others: new Set() });
    } else if (line !== group.line) {
      group.others.add(line);
    }
  }
  return [...groups.values()].map(({ message, line, others }) => ({
    kind,
    message: others.size === 0 ? message : `${message} (also lines ${[...others].join(", ")})`,
    line,
  }));
}

/** 0-based line of `offset` in `source`. */
function lineIndex(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length - 1;
}
