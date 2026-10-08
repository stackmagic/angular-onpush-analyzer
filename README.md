# onpush-analyzer

Static analysis of an Angular workspace to plan a migration to
`ChangeDetectionStrategy.OnPush`. It finds every component, reads its change
detection strategy, builds the dependency graph between components (template
usage, `extends`, `implements`), and produces a report that shows which eager
components can be migrated now, which have to wait, and where migration is
likely to break behavior.

## Prerequisites

Node `^22.22.3 || ^24.15.0 || >=26.0.0` (the range Angular 22 supports), npm and
git (the analyzed commit is recorded in the report).

## Usage

    npm ci
    npm run report -- /path/to/angular/workspace

The workspace is only read. Output goes to `./report/` (change it with
`--out <dir>`):

- `report.json`: all data (components, edges, readiness, waves, warnings)
- `index.html`: self-contained report built from that data

Open `report/index.html` in a browser. To share it, serve the `report/` folder
with any static web server.

## Terms

- ready: an eager component that depends on no other eager component outside its
  own cycle, so it can be switched to OnPush right now.
- wave: the order of migration. Wave 0 is the ready components; any other eager
  component is one wave after the latest wave among its eager dependencies.
  OnPush components have no wave. Components in a dependency cycle share a wave.

## Warnings

Per-component hints that a component may misbehave once it is OnPush. They are
heuristics: expect false positives and misses, and review each by hand.

- `async-assignment`: a field is assigned after `await` or inside a
  `subscribe`/`then`/`setTimeout`/`setInterval` callback, and the template
  renders that field (directly or through a getter or method it reads or
  calls). Suppressed for the whole component if `markForCheck` or
  `detectChanges` is called anywhere in the class.
- `input-mutation`: an input's value is mutated in place (for example `push`,
  `sort`, or assignment to a property).
- `service-state-in-template`: the template reads state held by an injected
  service.

## Development

`npm test`, `npm run lint` and `npm run e2e` work directly. The browser tests
need Chromium once: `npx playwright install chromium`.

Alternatively, the Makefile runs everything in docker, so nothing is installed
on the host:

    make test      # unit tests (vitest)
    make e2e       # browser tests on reports from the built CLI (playwright)
    make lint      # eslint and tsc --noEmit
    make report TARGET=/abs/path/to/workspace   # workspace mounted read-only
    make testbed   # clone bitwarden/clients at a pinned commit into testbed/clients

`make testbed-report` runs `make report` on that checkout. `make help` lists all
targets.
