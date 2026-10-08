SHELL := bash
IMAGE := onpush-analyzer-dev
PLAYWRIGHT_IMAGE := mcr.microsoft.com/playwright:v$(shell sed -n 's/.*"@playwright\/test": "\(.*\)".*/\1/p' package.json)-noble
TESTBED_SHA := 0f48721568cc12861e3161b28f5e511dd1c7f9cf
RUN := docker run --rm -u $$(id -u):$$(id -g) -e HOME=/tmp -e NPM_CONFIG_UPDATE_NOTIFIER=false -v $(CURDIR):/app -w /app

.DEFAULT_GOAL := help
.PHONY: help image build test e2e lint report testbed testbed-report clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-z0-9-]+:.*## / {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

image: ## Build the docker image all tooling runs in
	docker build -q -t $(IMAGE) .

node_modules: package-lock.json | image
	$(RUN) $(IMAGE) npm ci
	@touch node_modules

build: node_modules ## Install dependencies and compile to dist/
	$(RUN) $(IMAGE) npm run build

test: node_modules ## Run the vitest suite
	$(RUN) $(IMAGE) npm test

e2e: build ## Run the browser tests on reports from the built CLI
	$(RUN) $(PLAYWRIGHT_IMAGE) npm run e2e

lint: node_modules ## Run eslint and tsc --noEmit
	$(RUN) $(IMAGE) npm run lint

report: node_modules ## Analyze TARGET=/abs/path (mounted read-only), write ./report/
	@case "$(TARGET)" in /*) test -d "$(TARGET)" ;; *) false ;; esac || { echo "TARGET must be an existing absolute directory, e.g. make report TARGET=/abs/path/to/workspace" >&2; exit 1; }
	@set -o pipefail; $(RUN) -v $(TARGET):/target/$(notdir $(abspath $(TARGET))):ro $(IMAGE) npm run --silent report -- /target/$(notdir $(abspath $(TARGET))) | sed 's|^\( *\)/app/|\1$(CURDIR)/|; s|file:///app/|file://$(CURDIR)/|' # show host paths, not container paths

testbed: ## Clone bitwarden/clients at the pinned commit into testbed/clients
	@[ -d testbed/clients/.git ] || git init -q testbed/clients
	@git -C testbed/clients rev-parse --verify -q HEAD >/dev/null || { \
		git -C testbed/clients fetch -q --depth 1 https://github.com/bitwarden/clients.git $(TESTBED_SHA) && \
		git -C testbed/clients checkout -q FETCH_HEAD; }
	@current=$$(git -C testbed/clients rev-parse HEAD); \
		[ "$$current" = "$(TESTBED_SHA)" ] || { echo "testbed/clients is at $$current, expected $(TESTBED_SHA); remove it and rerun" >&2; exit 1; }

testbed-report: testbed ## Run report on the testbed checkout
	@$(MAKE) --no-print-directory report TARGET=$(CURDIR)/testbed/clients

clean: ## Remove node_modules, dist, report and test-results
	rm -rf node_modules dist report test-results
