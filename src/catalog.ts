import "./catalog.css";
import { listIfcFiles, loadDriveConfig, isDriveConfigured, type DriveFile } from "./drive";
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

// Theme: read + apply before first paint to avoid a flash of the wrong theme.
const THEME_KEY = "setout-theme";
type Theme = "dark" | "light";
function getStoredTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}
let currentTheme = getStoredTheme();
document.documentElement.setAttribute("data-theme", currentTheme);

const app = document.getElementById("app")!;

app.innerHTML = `
  <div class="catalog-shell">
    <header class="catalog-topbar">
      <div class="wordmark"><img class="brand-mark" src="${import.meta.env.BASE_URL}brand/austruss-icon.png" alt="Austruss" /><span class="wordmark-text">Austruss Online Viewer</span></div>
      <a class="nav-link" href="${import.meta.env.BASE_URL}index.html" title="Open the viewer">${BEAM_ICON}<span class="nav-link-text">Open viewer</span></a>
      <input class="catalog-search" id="search" type="text" placeholder="Search job, project, zone…" />
      <label class="show-completed-toggle" id="show-completed-wrap">
        <input type="checkbox" id="show-completed" />
        Show completed
      </label>
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
// Persists which project groups are collapsed across re-renders (e.g. while
// typing a search) — otherwise every filter change would silently re-expand
// everything, undoing whatever the person just collapsed.
const collapsedJobs = new Set<string>();
// Models checked for opening together — keyed by Drive file ID so it
// survives re-renders (e.g. while typing a search) the same way
// collapsedJobs does.
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
      const collapsed = collapsedJobs.has(jobNumber);

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
          link.href = `${import.meta.env.BASE_URL}index.html?fileId=${encodeURIComponent(entry.file.id)}&name=${encodeURIComponent(entry.file.name)}`;
          link.innerHTML = `
            <span class="model-drawing">${escapeHtml(entry.parsed.drawingNumber)}</span>
            <span class="model-desc">${escapeHtml(entry.parsed.description || entry.file.name)}</span>
            ${entry.parsed.revision ? `<span class="model-rev">Rev ${escapeHtml(entry.parsed.revision)}</span>` : ""}
            <span class="model-open">Open →</span>
          `;
          row.appendChild(link);
          zoneEl.appendChild(row);
        }
        content.appendChild(zoneEl);
      }
      group.appendChild(content);

      header.addEventListener("click", () => {
        const nowCollapsed = content.style.display !== "none";
        content.style.display = nowCollapsed ? "none" : "block";
        header.querySelector(".project-caret")!.classList.toggle("open", !nowCollapsed);
        if (nowCollapsed) collapsedJobs.add(jobNumber);
        else collapsedJobs.delete(jobNumber);
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
  let projects: Record<string, string | { name: string; status?: ProjectStatus }> = {};
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}projects.json`);
    if (res.ok) projects = await res.json();
  } catch {
    // Manifest is optional — falls back to "Job <number>" labels below.
  }

  try {
    const files = await listIfcFiles();
    allEntries = files
      .map((file) => {
        const parsed = parseModelFilename(file.name);
        if (!parsed) return null;
        const entry = projects[parsed.jobNumber];
        const projectName = (typeof entry === "string" ? entry : entry?.name) ?? `Job ${parsed.jobNumber}`;
        const jobStatus: ProjectStatus = (typeof entry === "object" && entry?.status === "complete") ? "complete" : "active";
        return { parsed, file, projectName, jobStatus };
      })
      .filter((e): e is Entry => e !== null);

    if (!allEntries.length) {
      bodyEl.innerHTML = `<p class="catalog-state">No .ifc or .frag files found in the configured Drive folder (or none match the naming convention).</p>`;
      return;
    }
    render(allEntries);
  } catch (err) {
    bodyEl.innerHTML = `<div class="catalog-state error">Couldn't load the catalog: ${escapeHtml(err instanceof Error ? err.message : String(err))}

Check that the Apps Script deployment in public/drive-config.json is live (its access setting must be "Anyone"), and that the folder ID is correct.</div>`;
  }
}

init();
