const report = JSON.parse(document.getElementById("report-data").textContent);
const { components } = report;
const byId = new Map(components.map((component) => [component.id, component]));

const POPOVER_LIMIT = 50;
const STATE_LABELS = { eager: "Eager", onpush: "OnPush" };
const STATE_ORDER = { eager: 0, onpush: 1 };

const $ = (selector) => document.querySelector(selector);
const listView = $("#list-view");
const detailView = $("#detail-view");
const tbody = $("#rows");
const filters = {
  query: $("#query"),
  project: $("#project"),
  state: $("#state"),
  ready: $("#ready"),
};

/** Filter values set by the summary boxes; "all" resets every filter. */
const PRESETS = {
  all: { query: "", project: "", state: "", ready: "" },
  onpush: { state: "onpush", ready: "" },
  eager: { state: "eager", ready: "" },
  ready: { state: "", ready: "ready" },
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function detailHref(id) {
  return `#/c/${encodeURIComponent(id)}`;
}

function stateBadge(component) {
  return `<span class="badge ${component.changeDetection}">${STATE_LABELS[component.changeDetection]}</span>`;
}

function componentLink(component) {
  return `<a href="${detailHref(component.id)}" title="${escapeHtml(component.file)}">${escapeHtml(component.name)}</a>`;
}

function byStateThenName(a, b) {
  return STATE_ORDER[a.changeDetection] - STATE_ORDER[b.changeDetection] || compareValues(a.name, b.name) || compareValues(a.id, b.id);
}

function compareValues(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function distinctComponents(ids) {
  return [...new Set(ids)].map((id) => byId.get(id)).sort(byStateThenName);
}

/** Neighbour components, eager first; edges to one component with several kinds count once. */
const neighbours = new Map(
  components.map((component) => [
    component.id,
    {
      dependents: distinctComponents(component.dependents.map(({ from }) => from)),
      dependencies: distinctComponents(component.dependencies.map(({ to }) => to)),
    },
  ]),
);

const searchText = new Map(
  components.map((component) => [
    component.id,
    `${component.name}\n${component.selector ?? ""}\n${component.file}`.toLowerCase(),
  ]),
);

function renderHeader() {
  const { meta } = report;
  document.title = `${meta.workspace} - OnPush migration`;
  $("#workspace").textContent = meta.workspace;
  const commit = meta.gitCommit === null
    ? "not a git repository"
    : `commit <code title="${escapeHtml(meta.gitCommit)}">${escapeHtml(meta.gitCommit.slice(0, 10))}</code>`;
  $("#meta").innerHTML = [
    `Angular ${escapeHtml(meta.angularVersion)}`,
    commit,
    `generated ${escapeHtml(new Date(meta.generatedAt).toLocaleString())}`,
  ].join(" &middot; ");
}

function renderSummary() {
  const { total, eager, onpush, ready, perWave, cycles } = report.meta.counts;
  const percent = total === 0 ? 0 : Math.round((onpush / total) * 100);
  const statContent = (label, value, note) =>
    `<span class="stat-value">${value}</span><span class="stat-label">${label}</span>${note}`;
  const stat = (label, value) => `<div class="stat">${statContent(label, value, "")}</div>`;
  const presetStat = (preset, label, value, note = "") =>
    `<button type="button" class="stat" data-preset="${preset}">${statContent(label, value, note)}</button>`;
  const waves = Object.entries(perWave).sort(([a], [b]) => Number(a) - Number(b));
  const largestWave = Math.max(1, ...waves.map(([, count]) => count));
  const waveRows = waves
    .map(
      ([wave, count]) =>
        `<div class="wave-row"><span>Wave ${wave}</span><span class="wave-bar"><span style="width:${(count / largestWave) * 100}%"></span></span><span class="num">${count}</span></div>`,
    )
    .join("");
  $("#summary").innerHTML = `
    <div class="stats">
      ${presetStat("all", "components", total)}
      ${presetStat("onpush", "OnPush", `${percent}%`, `<span class="meter" title="${onpush} of ${total} OnPush"><span style="width:${percent}%"></span></span>`)}
      ${presetStat("eager", "eager", eager)}
      ${presetStat("ready", "ready now", ready)}
      ${stat("cycle groups", cycles)}
    </div>
    <div class="waves">
      <h2>Eager components per migration wave</h2>
      ${waveRows || '<p class="muted">No eager components left.</p>'}
    </div>`;
}

function countCell(component, list) {
  const count = neighbours.get(component.id)[list].length;
  const content = count === 0
    ? '<span class="muted">0</span>'
    : `<button type="button" class="count" data-list="${list}" aria-haspopup="true">${count}</button>`;
  return `<td class="num">${content}</td>`;
}

function rowHtml(component) {
  return `<tr data-id="${escapeHtml(component.id)}">
    <td class="name">${componentLink(component)}<span class="sub">${escapeHtml(component.project)}</span></td>
    <td>${stateBadge(component)}</td>
    <td>${component.ready ? '<span class="badge ready">ready</span>' : ""}</td>
    <td class="num">${component.wave ?? ""}</td>
    ${countCell(component, "dependents")}
    <td class="num">${component.transitiveDependents}</td>
    ${countCell(component, "dependencies")}
    <td class="num">${component.transitiveDependencies}</td>
    <td class="num">${component.warnings.length || ""}</td>
  </tr>`;
}

const rows = (() => {
  const template = document.createElement("template");
  template.innerHTML = components.map(rowHtml).join("");
  return new Map([...template.content.children].map((row) => [row.dataset.id, row]));
})();

/** `value` may return null for "not applicable", which sorts last in both directions. */
const SORTS = {
  name: { value: (c) => c.name, firstDirection: 1 },
  state: { value: (c) => STATE_ORDER[c.changeDetection], firstDirection: 1 },
  ready: { value: (c) => (c.ready ? 1 : 0), firstDirection: -1 },
  wave: { value: (c) => c.wave, firstDirection: 1 },
  dependents: { value: (c) => neighbours.get(c.id).dependents.length, firstDirection: -1 },
  transitiveDependents: { value: (c) => c.transitiveDependents, firstDirection: -1 },
  dependencies: { value: (c) => neighbours.get(c.id).dependencies.length, firstDirection: -1 },
  transitiveDependencies: { value: (c) => c.transitiveDependencies, firstDirection: -1 },
  warnings: { value: (c) => c.warnings.length, firstDirection: -1 },
};

const sort = { key: "ready", direction: -1 };

function comparator({ key, direction }) {
  const { value } = SORTS[key];
  return (a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va !== vb) {
      if (va === null) return 1;
      if (vb === null) return -1;
      return compareValues(va, vb) * direction;
    }
    // Among equals, the components that unblock the most others come first.
    return b.transitiveDependents - a.transitiveDependents || compareValues(a.name, b.name) || compareValues(a.id, b.id);
  };
}

// Already-migrated components are neither ready nor blocked, so "not ready" means eager and blocked.
function matchesReadiness(component) {
  switch (filters.ready.value) {
    case "ready":
      return component.ready;
    case "not-ready":
      return component.changeDetection === "eager" && !component.ready;
    default:
      return true;
  }
}

function matchesFilters(component) {
  const query = filters.query.value.trim().toLowerCase();
  return (
    (filters.state.value === "" || component.changeDetection === filters.state.value) &&
    (filters.project.value === "" || component.project === filters.project.value) &&
    matchesReadiness(component) &&
    (query === "" || searchText.get(component.id).includes(query))
  );
}

function renderRows() {
  hidePopover();
  const shown = components.filter(matchesFilters).sort(comparator(sort));
  tbody.replaceChildren(...shown.map((component) => rows.get(component.id)));
  $("#match-count").textContent = `${shown.length} of ${components.length} components`;
  $("#empty").hidden = shown.length > 0;
  for (const button of document.querySelectorAll("thead [data-sort]")) {
    const th = button.parentElement;
    if (button.dataset.sort === sort.key) {
      th.setAttribute("aria-sort", sort.direction === 1 ? "ascending" : "descending");
    } else {
      th.removeAttribute("aria-sort");
    }
  }
  for (const box of document.querySelectorAll("[data-preset]")) {
    const preset = Object.entries(PRESETS[box.dataset.preset]);
    box.setAttribute("aria-pressed", String(preset.every(([filter, value]) => filters[filter].value === value)));
  }
}

function renderProjectOptions() {
  const counts = new Map();
  for (const { project } of components) {
    counts.set(project, (counts.get(project) ?? 0) + 1);
  }
  const options = [...counts].sort(([a], [b]) => compareValues(a, b)).map(([project, count]) => {
    const option = document.createElement("option");
    option.value = project;
    option.textContent = `${project} (${count})`;
    return option;
  });
  filters.project.append(...options);
}

const popover = document.createElement("div");
popover.className = "popover";
popover.hidden = true;
let popoverAnchor = null;
let hideTimer;

function showPopover(button) {
  clearTimeout(hideTimer);
  if (popoverAnchor === button && !popover.hidden) return;
  const component = byId.get(button.closest("tr").dataset.id);
  const list = button.dataset.list;
  const related = neighbours.get(component.id)[list];
  const items = related
    .slice(0, POPOVER_LIMIT)
    .map((other) => `<li>${stateBadge(other)} ${componentLink(other)} <span class="muted">${escapeHtml(other.project)}</span></li>`)
    .join("");
  const more = related.length > POPOVER_LIMIT
    ? `<a class="more" href="${detailHref(component.id)}">+${related.length - POPOVER_LIMIT} more in the details</a>`
    : "";
  const title = `${list === "dependents" ? "Used by" : "Uses"} ${related.length} ${related.length === 1 ? "component" : "components"}`;
  popover.innerHTML = `<div class="popover-title">${title}</div><ul>${items}</ul>${more}`;
  popoverAnchor = button;
  // Inside the cell so that Tab moves from the count into the list.
  button.after(popover);
  popover.hidden = false;
  placePopover(button);
}

function placePopover(button) {
  const anchor = button.getBoundingClientRect();
  const margin = 8;
  const { offsetWidth: width, offsetHeight: height } = popover;
  const left = Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin));
  const fitsBelow = anchor.bottom + height + margin <= window.innerHeight;
  popover.style.left = `${left}px`;
  popover.style.top = `${fitsBelow ? anchor.bottom + 4 : Math.max(margin, anchor.top - height - 4)}px`;
}

function hidePopover() {
  clearTimeout(hideTimer);
  popover.hidden = true;
  popoverAnchor = null;
}

function scheduleHidePopover() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hidePopover, 200);
}

function onPopoverTarget(event, handler) {
  const button = event.target.closest(".count");
  if (button !== null) {
    handler(button);
  } else if (event.target.closest(".popover") !== null) {
    clearTimeout(hideTimer);
  }
}

function attachListListeners() {
  $("#filters").addEventListener("input", renderRows);
  $("#summary").addEventListener("click", (event) => {
    const preset = event.target.closest("[data-preset]")?.dataset.preset;
    if (preset === undefined) return;
    for (const [filter, value] of Object.entries(PRESETS[preset])) {
      filters[filter].value = value;
    }
    renderRows();
  });
  $("thead").addEventListener("click", (event) => {
    const key = event.target.closest("[data-sort]")?.dataset.sort;
    if (key === undefined) return;
    sort.direction = sort.key === key ? -sort.direction : SORTS[key].firstDirection;
    sort.key = key;
    renderRows();
  });
  tbody.addEventListener("mouseover", (event) => onPopoverTarget(event, showPopover));
  tbody.addEventListener("focusin", (event) => onPopoverTarget(event, showPopover));
  tbody.addEventListener("click", (event) => onPopoverTarget(event, showPopover));
  tbody.addEventListener("mouseout", (event) => {
    if (event.target.closest(".count, .popover") !== null) scheduleHidePopover();
  });
  tbody.addEventListener("focusout", scheduleHidePopover);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && popoverAnchor !== null) {
      // Focus first: focusing the anchor while the popover is hidden would show it again.
      popoverAnchor.focus();
      hidePopover();
    }
  });
  const followAnchor = () => {
    if (popoverAnchor !== null) placePopover(popoverAnchor);
  };
  window.addEventListener("scroll", followAnchor, { passive: true });
  window.addEventListener("resize", followAnchor);
}

function edgeList(edges, otherId, emptyText) {
  if (edges.length === 0) return `<p class="muted">${emptyText}</p>`;
  const items = edges
    .map((edge) => ({ edge, other: byId.get(otherId(edge)) }))
    .sort((a, b) => byStateThenName(a.other, b.other) || compareValues(a.edge.kind, b.edge.kind))
    .map(({ edge, other }) => {
      const ambiguous = edge.ambiguous
        ? ' <span class="tag ambiguous" title="The template element also matches other components\' selectors">ambiguous</span>'
        : "";
      return `<li>${stateBadge(other)} ${componentLink(other)} <span class="tag">${edge.kind}</span>${ambiguous}<span class="sub">${escapeHtml(other.project)}</span></li>`;
    })
    .join("");
  return `<ul class="edges">${items}</ul>`;
}

function readiness(component) {
  if (component.changeDetection === "onpush") return "already OnPush";
  if (component.ready) {
    return component.cycleId === null
      ? "yes, all dependencies are OnPush"
      : "yes, together with its cycle group: all dependencies outside the group are OnPush";
  }
  const blockers = component.dependencies
    .map(({ to }) => byId.get(to))
    .filter((other) => other.changeDetection === "eager" && (component.cycleId === null || other.cycleId !== component.cycleId));
  const count = new Set(blockers).size;
  return count === 0 ? "no" : `no, waiting for ${count} eager ${count === 1 ? "dependency" : "dependencies"}`;
}

function detailHtml(component) {
  const fact = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
  const code = (text) => `<code>${escapeHtml(text)}</code>`;
  const { dependents, dependencies } = neighbours.get(component.id);
  const cycle = component.cycleId === null
    ? ""
    : `<h3>Cycle group ${component.cycleId}</h3><p class="muted">Members migrate together.</p><ul class="edges">${report.cycles[component.cycleId]
        .map((id) => byId.get(id))
        .map((member) => `<li>${stateBadge(member)} ${componentLink(member)}</li>`)
        .join("")}</ul>`;
  const warnings = component.warnings.length === 0
    ? '<p class="muted">None.</p>'
    : `<table class="warnings"><thead><tr><th>Kind</th><th>Message</th><th>Location</th></tr></thead><tbody>${component.warnings
        .map((w) => `<tr><td><span class="tag">${escapeHtml(w.kind)}</span></td><td>${escapeHtml(w.message)}</td><td>${code(`${w.file}:${w.line}`)}</td></tr>`)
        .join("")}</tbody></table>`;
  const unmatched = component.unmatchedElements.length === 0
    ? ""
    : `<h3>Unmatched elements</h3><p class="muted">Custom elements in the template that match no component selector.</p><p>${component.unmatchedElements.map(code).join(" ")}</p>`;
  const explicit = component.changeDetectionExplicit ? "explicit" : "implicit default";
  return `
    <a class="back" href="#/">&larr; All components</a>
    <h2 class="detail-title">${escapeHtml(component.name)} ${stateBadge(component)}${component.ready ? ' <span class="badge ready">ready</span>' : ""}</h2>
    <dl class="facts">
      ${fact("Change detection", `${STATE_LABELS[component.changeDetection]} (${explicit})`)}
      ${fact("Ready to migrate", readiness(component))}
      ${fact("Wave", component.wave ?? "-")}
      ${fact("Project", `${escapeHtml(component.project)}${component.projectAssigned ? "" : ' <span class="muted">(not in angular.json)</span>'}`)}
      ${fact("File", code(component.file))}
      ${fact("Selector", component.selector === null ? '<span class="muted">none</span>' : code(component.selector))}
      ${fact("Template", code(`${component.template.file}:${component.template.line}`))}
      ${fact("Standalone", component.standalone ? "yes" : "no")}
      ${fact("Dependents", `${dependents.length} direct, ${component.transitiveDependents} transitive`)}
      ${fact("Dependencies", `${dependencies.length} direct, ${component.transitiveDependencies} transitive`)}
    </dl>
    ${cycle}
    <h3>Warnings (${component.warnings.length})</h3>
    ${warnings}
    ${unmatched}
    <div class="columns">
      <div><h3>Dependencies (${dependencies.length})</h3>${edgeList(component.dependencies, (edge) => edge.to, "Uses no other components.")}</div>
      <div><h3>Dependents (${dependents.length})</h3>${edgeList(component.dependents, (edge) => edge.from, "Not used by other components.")}</div>
    </div>`;
}

let listScrollY = 0;

function route() {
  hidePopover();
  const match = /^#\/c\/(.+)$/.exec(location.hash);
  if (match === null) {
    detailView.hidden = true;
    listView.hidden = false;
    window.scrollTo(0, listScrollY);
    return;
  }
  if (!listView.hidden) listScrollY = window.scrollY;
  const id = decodeURIComponent(match[1]);
  const component = byId.get(id);
  detailView.innerHTML = component === undefined
    ? `<a class="back" href="#/">&larr; All components</a><p>No component with id ${escapeHtml(id)} in this report.</p>`
    : detailHtml(component);
  listView.hidden = true;
  detailView.hidden = false;
  window.scrollTo(0, 0);
}

history.scrollRestoration = "manual";
renderHeader();
renderSummary();
renderProjectOptions();
renderRows();
attachListListeners();
window.addEventListener("hashchange", route);
route();
