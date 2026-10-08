import {
  CssSelector,
  SelectorMatcher,
  TmplAstRecursiveVisitor,
  createCssSelectorFromNode,
  isNgContainer,
  splitNsName,
  tmplAstVisitAll,
  type TmplAstElement,
} from "@angular/compiler";
import { compare } from "./sort.js";
import { parseComponentTemplate } from "./template.js";
import type { Component, ComponentEdges, ComponentTemplate, Edge, EdgeKind } from "./types.js";

/** Computes the outgoing edges and unmatched elements of every component, keyed by component id. */
export function computeEdges(components: Component[]): Map<string, ComponentEdges> {
  const matcher = createMatcher(components);
  return new Map(components.map((component) => [component.id, componentEdges(component, matcher)]));
}

function createMatcher(components: Component[]): SelectorMatcher<string> {
  const matcher = new SelectorMatcher<string>();
  for (const { id, file, selector } of components) {
    if (selector === null) {
      continue;
    }
    let selectors: CssSelector[];
    try {
      selectors = CssSelector.parse(selector);
    } catch (error) {
      throw new Error(`${file}: invalid selector "${selector}": ${(error as Error).message}`, { cause: error });
    }
    matcher.addSelectables(selectors, id);
  }
  return matcher;
}

function componentEdges(component: Component, matcher: SelectorMatcher<string>): ComponentEdges {
  const edges = new Map<string, Edge>();
  const addEdge = (to: string, kind: EdgeKind, ambiguous: boolean) => {
    if (to === component.id) {
      return;
    }
    const key = `${kind}:${to}`;
    edges.set(key, { to, kind, ambiguous: ambiguous || (edges.get(key)?.ambiguous ?? false) });
  };
  const unmatchedElements = new Set<string>();
  for (const element of templateElements(component.template)) {
    // Angular rejects components on <ng-container> (and on <ng-template>, which is not an element node).
    if (isNgContainer(element.name)) {
      continue;
    }
    const matches: string[] = [];
    matcher.match(createCssSelectorFromNode(element), (_, id) => matches.push(id));
    for (const id of matches) {
      addEdge(id, "template", matches.length > 1);
    }
    const tagName = splitNsName(element.name)[1];
    if (matches.length === 0 && tagName.includes("-")) {
      unmatchedElements.add(tagName);
    }
  }
  if (component.heritage.extends !== null) {
    addEdge(component.heritage.extends, "extends", false);
  }
  for (const id of component.heritage.implements) {
    addEdge(id, "implements", false);
  }
  return {
    edges: [...edges.values()].sort((a, b) => compare(a.to, b.to) || compare(a.kind, b.kind)),
    unmatchedElements: [...unmatchedElements].sort(),
  };
}

function templateElements(template: ComponentTemplate): TmplAstElement[] {
  const collector = new ElementCollector();
  tmplAstVisitAll(collector, parseComponentTemplate(template));
  return collector.elements;
}

class ElementCollector extends TmplAstRecursiveVisitor {
  readonly elements: TmplAstElement[] = [];

  override visitElement(element: TmplAstElement): void {
    this.elements.push(element);
    super.visitElement(element);
  }
}
