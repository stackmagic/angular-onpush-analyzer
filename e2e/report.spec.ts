import { test as base, expect, type Page } from "@playwright/test";
import { HOSTILE_DIR, HOSTILE_PROJECT, HOSTILE_SELECTOR, HOSTILE_WORKSPACE, reportUrl } from "./global-setup.js";

const REPORT_URLS = [reportUrl("v21"), reportUrl("hostile")];

/** Fails every test whose page runs injected code, loads anything else, reports errors or opens dialogs. */
const test = base.extend<{ guard: undefined }>({
  guard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") problems.push(`console error: ${message.text()}`);
      });
      page.on("request", (request) => {
        if (!REPORT_URLS.includes(request.url())) problems.push(`request: ${request.url()}`);
      });
      page.on("dialog", async (dialog) => {
        problems.push(`dialog: ${dialog.message()}`);
        await dialog.dismiss();
      });
      await use(undefined);
      expect(problems).toEqual([]);
      expect(await page.evaluate(() => (globalThis as { __x?: unknown }).__x)).toBeUndefined();
    },
    { auto: true },
  ],
});

const names = (page: Page) => page.locator("#rows .name a");
const fact = (page: Page, label: string) => page.locator(`.facts dt:text-is("${label}") + dd`);
const box = (page: Page, label: string) => page.locator("#summary button", { has: page.locator(`.stat-label:text-is("${label}")`) });
const routedId = (page: Page) => decodeURIComponent(new URL(page.url()).hash.replace(/^#\/c\//, ""));

test.describe("v21 report", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(reportUrl("v21"));
  });

  test("lists ready components first, those unblocking the most others on top", async ({ page }) => {
    await expect(names(page)).toHaveText([
      "ButtonComponent",
      "VaultItemComponent",
      "VaultListComponent",
      "BaseDialogComponent",
      "AdminComponent",
      "ShellComponent",
    ]);
    await expect(page.locator("th:has([data-sort=ready])")).toHaveAttribute("aria-sort", "descending");
  });

  test("filters by state, readiness and search text", async ({ page }) => {
    await page.selectOption("#state", "onpush");
    await expect(names(page)).toHaveText(["AdminComponent"]);
    await expect(page.locator("#match-count")).toHaveText("1 of 6 components");

    await page.selectOption("#state", "");
    await page.selectOption("#ready", "not-ready");
    await expect(names(page)).toHaveText(["ShellComponent"]);

    await page.selectOption("#state", "onpush");
    await expect(names(page)).toHaveText([]);
    await page.selectOption("#state", "");

    await page.selectOption("#ready", "ready");
    await page.fill("#query", "VAULT");
    await expect(names(page)).toHaveText(["VaultItemComponent", "VaultListComponent"]);
  });

  test("presets the state and ready filters from the summary boxes", async ({ page }) => {
    const pressed = page.locator("#summary [aria-pressed=true] .stat-label");
    await expect(pressed).toHaveText(["components"]);
    await expect(page.locator("#summary .stat:not(button)")).toHaveText(/cycle groups/);

    await page.selectOption("#project", "components");
    await page.fill("#query", "o");
    await expect(pressed).toHaveText([]);

    await box(page, "eager").click();
    await expect(page.locator("#state")).toHaveValue("eager");
    await expect(names(page)).toHaveText(["ButtonComponent", "BaseDialogComponent"]);
    await expect(pressed).toHaveText(["eager"]);

    await page.selectOption("#ready", "not-ready");
    await expect(names(page)).toHaveText([]);
    await box(page, "OnPush").click();
    await expect(page.locator("#ready")).toHaveValue("");
    await expect(pressed).toHaveText(["OnPush"]);

    await box(page, "ready now").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#state")).toHaveValue("");
    await expect(page.locator("#ready")).toHaveValue("ready");
    await expect(page.locator("#project")).toHaveValue("components");
    await expect(page.locator("#query")).toHaveValue("o");
    await expect(pressed).toHaveText(["ready now"]);

    await page.selectOption("#state", "onpush");
    await page.selectOption("#ready", "");
    await expect(pressed).toHaveText(["OnPush"]);

    await box(page, "components").click();
    for (const filter of ["#query", "#project", "#state", "#ready"]) {
      await expect(page.locator(filter)).toHaveValue("");
    }
    await expect(names(page)).toHaveCount(6);
    await expect(pressed).toHaveText(["components"]);
  });

  test("shows the dependents of a component in a popover", async ({ page }) => {
    await page.locator("#rows tr", { hasText: "ButtonComponent" }).locator("button.count[data-list=dependents]").hover();

    const popover = page.locator(".popover");
    await expect(popover.locator(".popover-title")).toHaveText("Used by 2 components");
    await expect(popover.locator("li a")).toHaveText(["ShellComponent", "AdminComponent"]);
  });

  test("shows the cycle group of a component in a cycle", async ({ page }) => {
    await page.getByRole("link", { name: "VaultListComponent", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Cycle group 0" })).toBeVisible();
    await expect(page.locator("h3:text-is('Cycle group 0') + p + ul a")).toHaveText(["VaultItemComponent", "VaultListComponent"]);
    await expect(fact(page, "Ready to migrate")).toHaveText(
      "yes, together with its cycle group: all dependencies outside the group are OnPush",
    );
  });
});

test.describe("report with markup and URL syntax in its data", () => {
  const buttonId = `libs/components/src/${HOSTILE_DIR}/button.component.ts#ButtonComponent`;

  test.beforeEach(async ({ page }) => {
    await page.goto(reportUrl("hostile"));
  });

  test("renders the data as text", async ({ page }) => {
    await expect(page.locator("#workspace")).toHaveText(HOSTILE_WORKSPACE);
    await page.selectOption("#project", HOSTILE_PROJECT);
    await expect(names(page)).toHaveText(["ButtonComponent", "BaseDialogComponent"]);
    await expect(page.locator("#rows .name .sub")).toHaveText([HOSTILE_PROJECT, HOSTILE_PROJECT]);
    await page.selectOption("#project", "");

    for (const count of await page.locator("button.count").all()) {
      await count.focus();
      await expect(page.locator(".popover li").first()).toBeVisible();
    }
  });

  test("routes to a component by its id and back", async ({ page }) => {
    await page.getByRole("link", { name: "ButtonComponent", exact: true }).click();
    await expect(page.locator(".detail-title")).toContainText("ButtonComponent");
    expect(routedId(page)).toBe(buttonId);
    await expect(fact(page, "File")).toHaveText(`libs/components/src/${HOSTILE_DIR}/button.component.ts`);
    await expect(fact(page, "Selector")).toHaveText(HOSTILE_SELECTOR);
    await expect(fact(page, "Project")).toHaveText(HOSTILE_PROJECT);

    await page.locator("#detail-view").getByRole("link", { name: "ShellComponent" }).click();
    await expect(page.locator(".detail-title")).toContainText("ShellComponent");

    await page.goBack();
    await expect(page.locator(".detail-title")).toContainText("ButtonComponent");
    expect(routedId(page)).toBe(buttonId);

    await page.goBack();
    await expect(page.locator("#list-view")).toBeVisible();
    await expect(page.locator("#detail-view")).toBeHidden();
  });
});
