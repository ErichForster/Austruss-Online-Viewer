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
      <div class="wordmark"><img class="brand-mark" src="${import.meta.env.BASE_URL}brand/austruss-icon.png" alt="Austruss" />Austruss Online Viewer</div>
      <a class="nav-link" href="${import.meta.env.BASE_URL}index.html" title="Open the viewer">${BEAM_ICON}Open viewer</a>
      <input class="catalog-search" id="search" type="text" placeholder="Search job, project, zone…" />
      <span class="catalog-count" id="count"></span>
      <button class="theme-toggle" id="theme-toggle" title="Toggle light/dark theme"></button>
    </header>
    <main class="catalog-body" id="body">
      <p class="catalog-state">Loading model catalog…</p>
    </main>
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

interface Entry {
  parsed: ParsedModelName;
  file: DriveFile;
  projectName: string;
}

let allEntries: Entry[] = [];

function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function render(entries: Entry[]) {
  countEl.textContent = `${entries.length} model${entries.length === 1 ? "" : "s"}`;

  if (!entries.length) {
    bodyEl.innerHTML = `<p class="catalog-state">No models match.</p>`;
    return;
  }

  // Group: project name → job number → zone
  const byProject = new Map<string, Map<string, Map<string, Entry[]>>>();
  for (const entry of entries) {
    const { jobNumber, zone } = entry.parsed;
    if (!byProject.has(entry.projectName)) byProject.set(entry.projectName, new Map());
    const byJob = byProject.get(entry.projectName)!;
    if (!byJob.has(jobNumber)) byJob.set(jobNumber, new Map());
    const byZone = byJob.get(jobNumber)!;
    if (!byZone.has(zone)) byZone.set(zone, []);
    byZone.get(zone)!.push(entry);
  }

  const sortedProjects = [...byProject.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  bodyEl.innerHTML = "";
  for (const [projectName, byJob] of sortedProjects) {
    for (const [jobNumber, byZone] of [...byJob.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const group = document.createElement("section");
      group.className = "project-group";
      group.innerHTML = `
        <h2 class="project-title">${escapeHtml(projectName)}</h2>
        <div class="project-job">Job ${escapeHtml(jobNumber)}</div>
      `;

      for (const [zone, zoneEntries] of [...byZone.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const zoneEl = document.createElement("div");
        zoneEl.className = "zone-group";
        zoneEl.innerHTML = `<div class="zone-head"><span class="zone-badge">ZONE</span>${escapeHtml(zone)}</div>`;

        for (const entry of zoneEntries.sort((a, b) => a.parsed.drawingNumber.localeCompare(b.parsed.drawingNumber))) {
          const row = document.createElement("a");
          row.className = "model-row";
          row.href = `${import.meta.env.BASE_URL}index.html?fileId=${encodeURIComponent(entry.file.id)}&name=${encodeURIComponent(entry.file.name)}`;
          row.innerHTML = `
            <span class="model-drawing">${escapeHtml(entry.parsed.drawingNumber)}</span>
            <span class="model-desc">${escapeHtml(entry.parsed.description || entry.file.name)}</span>
            ${entry.parsed.revision ? `<span class="model-rev">Rev ${escapeHtml(entry.parsed.revision)}</span>` : ""}
            <span class="model-open">Open →</span>
          `;
          zoneEl.appendChild(row);
        }
        group.appendChild(zoneEl);
      }
      bodyEl.appendChild(group);
    }
  }
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

async function init() {
  const config = await loadDriveConfig().catch(() => null);
  if (!config || !isDriveConfigured(config)) {
    bodyEl.innerHTML = `<div class="catalog-state error">Google Drive isn't configured yet.

Edit public/drive-config.json with a restricted Drive API key and your public folder's ID — see README.md "Google Drive setup" for the exact steps.</div>`;
    return;
  }

  let projects: Record<string, string> = {};
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
        const projectName = projects[parsed.jobNumber] ?? `Job ${parsed.jobNumber}`;
        return { parsed, file, projectName };
      })
      .filter((e): e is Entry => e !== null);

    if (!allEntries.length) {
      bodyEl.innerHTML = `<p class="catalog-state">No .ifc files found in the configured Drive folder (or none match the naming convention).</p>`;
      return;
    }
    render(allEntries);
  } catch (err) {
    bodyEl.innerHTML = `<div class="catalog-state error">Couldn't load the catalog: ${escapeHtml(err instanceof Error ? err.message : String(err))}

Check that the Drive folder is shared as "Anyone with the link", and that the API key in src/drive-config.ts is valid and has the Drive API enabled.</div>`;
  }
}

init();
