import "./catalog.css";
import {
  listIfcFiles,
  loadDriveConfig,
  isDriveConfigured,
  getCatalogOverrides,
  saveCatalogOverrides,
  type DriveFile,
  type CatalogOverrides,
} from "./drive";

// See the comment on the --vh custom property in style.css.
function setViewportHeightVar() {
  document.documentElement.style.setProperty("--vh", `${window.innerHeight * 0.01}px`);
}
setViewportHeightVar();
window.addEventListener("resize", setViewportHeightVar);
window.addEventListener("orientationchange", () => setTimeout(setViewportHeightVar, 100));

import { parseModelFilename, type ParsedModelName } from "./naming";

// Duplicated from icons.ts rather than imported — see the note further
// down about why main.ts and catalog.ts don't share modules.
const BEAM_ICON = `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 34V14h6v9h20v-9h6v20h-6v-9H14v9z"/></svg>`;

// Duplicated from icons.ts rather than imported — icons.ts is otherwise
// only used by main.ts, and importing it here would link this page's
// chunk to the viewer's, the same bundling issue fixed for drive-config.ts.
const SUN_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8"/></svg>`;
const MOON_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z"/></svg>`;
const CHEVRON_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`;
const PENCIL_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

// Theme: read + apply before first paint to avoid a flash of the wrong theme.
const THEME_KEY = "setout-theme";
type Theme = "dark" | "light";
function getStoredTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
}
let currentTheme = getStoredTheme();
document.documentElement.setAttribute("data-theme", currentTheme);

// External catalog mode (?external=1&job=<number>) — a restricted view
// scoped to one project, for sharing alongside an external viewer link.
// Same "mode flag on the same page" approach as the viewer — see the CSS
// comment on .external-mode in app.css (this page's copy is in
// catalog.css) for why.
const startupParams = new URLSearchParams(location.search);
const isExternalMode = startupParams.get("external") === "1";
const externalJob = startupParams.get("job");
if (isExternalMode) document.documentElement.classList.add("external-mode");

function withExternalParams(url: URL): URL {
  if (isExternalMode) {
    url.searchParams.set("external", "1");
    if (externalJob) url.searchParams.set("job", externalJob);
  }
  return url;
}

const app = document.getElementById("app")!;

app.innerHTML = `
  <div class="catalog-shell">
    <header class="catalog-topbar">
      <div class="wordmark"><img class="brand-mark" src="${import.meta.env.BASE_URL}brand/austruss-icon.png" alt="Austruss" /><span class="wordmark-text">Austruss Online Viewer</span></div>
      <a class="nav-link external-hide" href="${import.meta.env.BASE_URL}index.html" title="Open the viewer">${BEAM_ICON}<span class="nav-link-text">Open viewer</span></a>
      <input class="catalog-search" id="search" type="text" placeholder="Search job, project, zone…" />
      <label class="show-completed-toggle external-hide" id="show-completed-wrap">
        <input type="checkbox" id="show-completed" />
        Show completed
      </label>
      <button class="collapse-toggle-btn" id="expand-all-btn" title="Expand every project group">Expand all</button>
      <button class="collapse-toggle-btn" id="collapse-all-btn" title="Collapse every project group">Collapse all</button>
      <span class="catalog-count" id="count"></span>
      <button class="theme-toggle" id="theme-toggle" title="Toggle light/dark theme"></button>
    </header>
    <main class="catalog-body" id="body">
      <p class="catalog-state">Loading model catalog…</p>
    </main>
    <div class="selection-bar" id="selection-bar" hidden>
      <span id="selection-count"></span>
      <button class="upload-btn" id="selection-open">Open together →</button>
      <button class="tool-btn" id="selection-clear">Clear</button>
    </div>
    <div class="edit-popover" id="edit-popover" hidden>
      <p class="edit-popover-hint" id="edit-popover-hint"></p>
      <label class="edit-field-label" for="edit-project-name">Project name <span class="edit-field-note">(applies to the whole job)</span></label>
      <input type="text" id="edit-project-name" class="edit-field-input" />
      <label class="edit-field-label">Project status <span class="edit-field-note">(applies to the whole job)</span></label>
      <div class="edit-status-row">
        <label class="edit-status-option"><input type="radio" name="edit-status" id="edit-status-active" value="active" /> Active</label>
        <label class="edit-status-option"><input type="radio" name="edit-status" id="edit-status-complete" value="complete" /> Complete</label>
      </div>
      <div class="edit-field-row">
        <div>
          <label class="edit-field-label" for="edit-zone">Zone</label>
          <input type="text" id="edit-zone" class="edit-field-input" />
        </div>
        <div>
          <label class="edit-field-label" for="edit-drawing">Drawing #</label>
          <input type="text" id="edit-drawing" class="edit-field-input" />
        </div>
        <div>
          <label class="edit-field-label" for="edit-revision">Revision</label>
          <input type="text" id="edit-revision" class="edit-field-input" />
        </div>
      </div>
      <label class="edit-field-label" for="edit-description">Description</label>
      <input type="text" id="edit-description" class="edit-field-input" />
      <div class="edit-popover-actions">
        <button class="tool-btn" id="edit-reset">Reset to filename</button>
        <button class="tool-btn" id="edit-cancel">Cancel</button>
        <button class="upload-btn" id="edit-save">Save</button>
      </div>
    </div>
  </div>
`;

const themeToggleBtn = document.getElementById("theme-toggle") as HTMLButtonElement;
function renderThemeIcon() {
  themeToggleBtn.innerHTML = currentTheme === "dark" ? SUN_ICON : MOON_ICON;
  themeToggleBtn.title = currentTheme === "dark" ? "Switch to light theme" : "Switch to dark theme";
}
renderThemeIcon();
themeToggleBtn.addEventListener("click", () => {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, currentTheme);
  document.documentElement.setAttribute("data-theme", currentTheme);
  renderThemeIcon();
});

const bodyEl = document.getElementById("body")!;
const searchEl = document.getElementById("search") as HTMLInputElement;
const countEl = document.getElementById("count")!;
const showCompletedEl = document.getElementById("show-completed") as HTMLInputElement;

type ProjectStatus = "active" | "complete";

interface Entry {
  parsed: ParsedModelName;
  file: DriveFile;
  projectName: string;
  jobStatus: ProjectStatus;
}

let allEntries: Entry[] = [];
// The manual corrections themselves — kept around (not just folded into
// allEntries) so the edit form can be pre-filled with the current
// override values, and so saving only has to send this small object
// rather than reconstructing it from rendered entries.
let currentOverrides: CatalogOverrides = {};
// Persists which project groups are expanded across re-renders (e.g.
// while typing a search) — otherwise every filter change would silently
// re-expand or re-collapse everything, undoing whatever the person just
// clicked. Tracking "expanded" (rather than "collapsed") means new
// projects — the first time they're seen, e.g. after a search — start
// collapsed by default without needing to pre-populate anything.
const expandedJobs = new Set<string>();
// Models checked for opening together — keyed by Drive file ID so it
// survives re-renders (e.g. while typing a search) the same way
// expandedJobs does.
const selectedIds = new Map<string, Entry>();

function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function render(entries: Entry[]) {
  const showCompleted = showCompletedEl.checked;
  const searching = searchEl.value.trim().length > 0;
  // Completed projects are hidden from the default browse view but still
  // fully searchable — a non-empty search always includes them regardless
  // of the "Show completed" checkbox.
  const visible = entries.filter((e) => e.jobStatus === "active" || showCompleted || searching);

  countEl.textContent = `${visible.length} model${visible.length === 1 ? "" : "s"}`;

  if (!visible.length) {
    bodyEl.innerHTML = `<p class="catalog-state">No models match.</p>`;
    return;
  }

  // Group: project name → job number → zone
  const byProject = new Map<string, Map<string, { status: ProjectStatus; zones: Map<string, Entry[]> }>>();
  for (const entry of visible) {
    const { jobNumber, zone } = entry.parsed;
    if (!byProject.has(entry.projectName)) byProject.set(entry.projectName, new Map());
    const byJob = byProject.get(entry.projectName)!;
    if (!byJob.has(jobNumber)) byJob.set(jobNumber, { status: entry.jobStatus, zones: new Map() });
    const jobEntry = byJob.get(jobNumber)!;
    if (!jobEntry.zones.has(zone)) jobEntry.zones.set(zone, []);
    jobEntry.zones.get(zone)!.push(entry);
  }

  const sortedProjects = [...byProject.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  bodyEl.innerHTML = "";
  for (const [projectName, byJob] of sortedProjects) {
    for (const [jobNumber, { status, zones }] of [...byJob.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const group = document.createElement("section");
      group.className = "project-group";
      const collapsed = !expandedJobs.has(jobNumber);

      const header = document.createElement("div");
      header.className = "project-header";
      header.innerHTML = `
        <span class="project-caret${collapsed ? "" : " open"}">${CHEVRON_ICON}</span>
        <div class="project-header-text">
          <h2 class="project-title">${escapeHtml(projectName)}${status === "complete" ? '<span class="project-status-pill">Complete</span>' : ""}</h2>
          <div class="project-job">Job ${escapeHtml(jobNumber)}</div>
        </div>
      `;
      group.appendChild(header);

      const content = document.createElement("div");
      content.className = "project-content";
      content.style.display = collapsed ? "none" : "block";

      for (const [zone, zoneEntries] of [...zones.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const zoneEl = document.createElement("div");
        zoneEl.className = "zone-group";
        zoneEl.innerHTML = `<div class="zone-head"><span class="zone-badge">ZONE</span>${escapeHtml(zone)}</div>`;

        for (const entry of zoneEntries.sort((a, b) => a.parsed.drawingNumber.localeCompare(b.parsed.drawingNumber))) {
          const row = document.createElement("div");
          row.className = "model-row";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.className = "model-select";
          checkbox.title = "Select for opening together";
          checkbox.checked = selectedIds.has(entry.file.id);
          checkbox.addEventListener("change", () => {
            if (checkbox.checked) selectedIds.set(entry.file.id, entry);
            else selectedIds.delete(entry.file.id);
            updateSelectionBar();
          });
          row.appendChild(checkbox);

          const link = document.createElement("a");
          link.className = "model-row-link";
          const linkUrl = withExternalParams(
            new URL(`${import.meta.env.BASE_URL}index.html`, location.origin),
          );
          linkUrl.searchParams.set("fileId", entry.file.id);
          linkUrl.searchParams.set("name", entry.file.name);
          link.href = linkUrl.toString();
          link.innerHTML = `
            <span class="model-drawing">${escapeHtml(entry.parsed.drawingNumber)}</span>
            <span class="model-desc">${escapeHtml(entry.parsed.description || entry.file.name)}</span>
            ${entry.parsed.revision ? `<span class="model-rev">Rev ${escapeHtml(entry.parsed.revision)}</span>` : ""}
            <span class="model-open">Open →</span>
          `;
          row.appendChild(link);

          const editBtn = document.createElement("button");
          editBtn.className = "model-edit-btn external-hide";
          editBtn.title = "Edit project name and details";
          editBtn.innerHTML = PENCIL_ICON;
          editBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            openEditPopover(entry, editBtn);
          });
          row.appendChild(editBtn);

          zoneEl.appendChild(row);
        }
        content.appendChild(zoneEl);
      }
      group.appendChild(content);

      header.addEventListener("click", () => {
        const nowCollapsed = content.style.display !== "none";
        content.style.display = nowCollapsed ? "none" : "block";
        header.querySelector(".project-caret")!.classList.toggle("open", !nowCollapsed);
        if (nowCollapsed) expandedJobs.delete(jobNumber);
        else expandedJobs.add(jobNumber);
      });

      bodyEl.appendChild(group);
    }
  }
}

const selectionBar = document.getElementById("selection-bar")!;
const selectionCountEl = document.getElementById("selection-count")!;
const selectionOpenBtn = document.getElementById("selection-open") as HTMLButtonElement;
const selectionClearBtn = document.getElementById("selection-clear") as HTMLButtonElement;

function updateSelectionBar() {
  const n = selectedIds.size;
  selectionBar.hidden = n === 0;
  selectionCountEl.textContent = `${n} model${n === 1 ? "" : "s"} selected`;
}
selectionOpenBtn.addEventListener("click", () => {
  const url = new URL(`${location.origin}${import.meta.env.BASE_URL}index.html`);
  for (const entry of selectedIds.values()) {
    url.searchParams.append("fileId", entry.file.id);
    url.searchParams.append("name", entry.file.name);
  }
  location.href = url.toString();
});
selectionClearBtn.addEventListener("click", () => {
  selectedIds.clear();
  updateSelectionBar();
  applyFilter(); // re-render (respecting the current search) to uncheck every visible checkbox
});

// --- Edit popover: corrects a model's project name / zone / description /
// drawing number / revision when the naming convention imported something
// wrong. Saved to catalog-overrides.json in the Drive folder (via the
// Apps Script backend) so the fix is visible to everyone browsing the
// catalog, not just kept in this browser.
const editPopover = document.getElementById("edit-popover")!;
const editHint = document.getElementById("edit-popover-hint")!;
const editProjectName = document.getElementById("edit-project-name") as HTMLInputElement;
const editStatusActive = document.getElementById("edit-status-active") as HTMLInputElement;
const editStatusComplete = document.getElementById("edit-status-complete") as HTMLInputElement;
const editZone = document.getElementById("edit-zone") as HTMLInputElement;
const editDrawing = document.getElementById("edit-drawing") as HTMLInputElement;
const editRevision = document.getElementById("edit-revision") as HTMLInputElement;
const editDescription = document.getElementById("edit-description") as HTMLInputElement;
const editResetBtn = document.getElementById("edit-reset") as HTMLButtonElement;
const editCancelBtn = document.getElementById("edit-cancel") as HTMLButtonElement;
const editSaveBtn = document.getElementById("edit-save") as HTMLButtonElement;

let editingEntry: Entry | null = null;

function positionEditPopover(anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect();
  const width = editPopover.offsetWidth || 300;
  let left = rect.right - width;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  let top = rect.bottom + 6;
  const height = editPopover.offsetHeight || 320;
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
  editPopover.style.left = `${left}px`;
  editPopover.style.top = `${top}px`;
}

function openEditPopover(entry: Entry, anchor: HTMLElement) {
  editingEntry = entry;
  editHint.textContent = `Editing ${entry.file.name}`;
  editProjectName.value = entry.projectName;
  editStatusActive.checked = entry.jobStatus === "active";
  editStatusComplete.checked = entry.jobStatus === "complete";
  editZone.value = entry.parsed.zone;
  editDrawing.value = entry.parsed.drawingNumber;
  editRevision.value = entry.parsed.revision ?? "";
  editDescription.value = entry.parsed.description;
  editPopover.hidden = false;
  positionEditPopover(anchor);
}
function closeEditPopover() {
  editPopover.hidden = true;
  editingEntry = null;
}
editPopover.addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", () => closeEditPopover());
editCancelBtn.addEventListener("click", closeEditPopover);

editResetBtn.addEventListener("click", () => {
  if (!editingEntry) return;
  const original = parseModelFilename(editingEntry.file.name);
  if (!original) return;
  editZone.value = original.zone;
  editDrawing.value = original.drawingNumber;
  editRevision.value = original.revision ?? "";
  editDescription.value = original.description;
});

editSaveBtn.addEventListener("click", async () => {
  if (!editingEntry) return;
  const jobNumber = editingEntry.parsed.jobNumber;
  const filename = editingEntry.file.name;

  const projects = { ...(currentOverrides.projects ?? {}) };
  const trimmedName = editProjectName.value.trim();
  const status: ProjectStatus = editStatusComplete.checked ? "complete" : "active";
  if (trimmedName || status === "complete") {
    projects[jobNumber] = { name: trimmedName || undefined, status };
  } else {
    delete projects[jobNumber];
  }

  const models = { ...(currentOverrides.models ?? {}) };
  models[filename] = {
    zone: editZone.value.trim(),
    drawingNumber: editDrawing.value.trim(),
    revision: editRevision.value.trim() || undefined,
    description: editDescription.value.trim(),
  };

  const updated: CatalogOverrides = { projects, models };
  editSaveBtn.disabled = true;
  editSaveBtn.textContent = "Saving…";
  try {
    await saveCatalogOverrides(updated);
    currentOverrides = updated;
    allEntries = buildEntries();
    closeEditPopover();
    applyFilter();
  } catch (err) {
    showEditError(err instanceof Error ? err.message : "Unknown error");
  } finally {
    editSaveBtn.disabled = false;
    editSaveBtn.textContent = "Save";
  }
});

function showEditError(message: string) {
  editHint.textContent = `Couldn't save: ${message}`;
  editHint.classList.add("edit-popover-error");
  setTimeout(() => editHint.classList.remove("edit-popover-error"), 4000);
}

function applyFilter() {
  const q = searchEl.value.trim().toLowerCase();
  if (!q) {
    render(allEntries);
    return;
  }
  const filtered = allEntries.filter((e) => {
    const haystack = `${e.projectName} ${e.parsed.jobNumber} ${e.parsed.zone} ${e.parsed.description} ${e.file.name}`.toLowerCase();
    return haystack.includes(q);
  });
  render(filtered);
}

searchEl.addEventListener("input", applyFilter);
showCompletedEl.addEventListener("change", applyFilter);

const expandAllBtn = document.getElementById("expand-all-btn") as HTMLButtonElement;
const collapseAllBtn = document.getElementById("collapse-all-btn") as HTMLButtonElement;
expandAllBtn.addEventListener("click", () => {
  for (const entry of allEntries) expandedJobs.add(entry.parsed.jobNumber);
  applyFilter();
});
collapseAllBtn.addEventListener("click", () => {
  expandedJobs.clear();
  applyFilter();
});

type ProjectsMap = Record<string, string | { name: string; status?: ProjectStatus }>;
let allFiles: DriveFile[] = [];
let projectsMap: ProjectsMap = {};

// Combines the raw file listing + projects.json + the editable overrides
// into the rendered entry list. Pulled out of init() so an edit-save can
// rebuild the list from what's already in memory instead of a full
// re-fetch from Drive.
function buildEntries(): Entry[] {
  let entries = allFiles
    .map((file) => {
      const parsed = parseModelFilename(file.name);
      if (!parsed) return null;
      const modelOverride = currentOverrides.models?.[file.name];
      const effectiveParsed: ParsedModelName = modelOverride ? { ...parsed, ...modelOverride } : parsed;

      const overrideEntry = currentOverrides.projects?.[parsed.jobNumber];
      const overrideName = typeof overrideEntry === "string" ? overrideEntry : overrideEntry?.name;
      const overrideStatus = typeof overrideEntry === "object" ? overrideEntry?.status : undefined;

      const jsonEntry = projectsMap[parsed.jobNumber];
      const jsonName = typeof jsonEntry === "string" ? jsonEntry : jsonEntry?.name;
      const jsonStatus = typeof jsonEntry === "object" ? jsonEntry?.status : undefined;

      const projectName = overrideName ?? jsonName ?? `Job ${parsed.jobNumber}`;
      const jobStatus: ProjectStatus = overrideStatus ?? jsonStatus ?? "active";
      return { parsed: effectiveParsed, file, projectName, jobStatus };
    })
    .filter((e): e is Entry => e !== null);

  if (isExternalMode && externalJob) {
    entries = entries.filter((e) => e.parsed.jobNumber === externalJob);
  }
  return entries;
}

async function init() {
  const config = await loadDriveConfig().catch(() => null);
  if (!config || !isDriveConfigured(config)) {
    bodyEl.innerHTML = `<div class="catalog-state error">The Drive backend isn't configured yet.

Edit public/drive-config.json with your Apps Script deployment URL and your Drive folder's ID — see README.md "Google Drive setup" for the exact steps.</div>`;
    return;
  }

  // projects.json entries can be either a plain string (legacy — just a
  // name, treated as active) or {name, status}, so existing simple entries
  // keep working without editing every line to adopt the status field.
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}projects.json`);
    if (res.ok) projectsMap = await res.json();
  } catch {
    // Manifest is optional — falls back to "Job <number>" labels below.
  }

  try {
    currentOverrides = await getCatalogOverrides().catch(() => ({}));
    allFiles = await listIfcFiles();
    allEntries = buildEntries();

    if (!allEntries.length) {
      bodyEl.innerHTML = isExternalMode
        ? `<p class="catalog-state">No other models found for this project.</p>`
        : `<p class="catalog-state">No .ifc or .frag files found in the configured Drive folder (or none match the naming convention).</p>`;
      return;
    }
    render(allEntries);
  } catch (err) {
    bodyEl.innerHTML = `<div class="catalog-state error">Couldn't load the catalog: ${escapeHtml(err instanceof Error ? err.message : String(err))}

Check that the Apps Script deployment in public/drive-config.json is live (its access setting must be "Anyone"), and that the folder ID is correct.</div>`;
  }
}

init();
