// Drive-listing logic for the in-viewer "add model from Drive" picker.
// Deliberately duplicated from drive.ts/naming.ts rather than imported —
// drive.ts is otherwise only used by catalog.ts, and sharing it here would
// re-link this page's bundle to catalog's the same way icons.ts and
// drive-config.ts once did (see the notes on that elsewhere in this file).

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

export interface ParsedModelName {
  jobNumber: string;
  zone: string;
  drawingNumber: string;
  description: string;
  filename: string;
}

const PREFIX_PATTERN = /^(\d{3,6})-([A-Z]+)-([A-Z0-9]+)-(\d+)/;

export function parseModelFilename(filename: string): ParsedModelName | null {
  const base = filename.replace(/\.(ifc|frag)$/i, "");
  const match = base.match(PREFIX_PATTERN);
  if (!match) return null;
  const [, jobNumber, , zone, drawingNumber] = match;
  let rest = base.slice(match[0].length);
  const bracketRev = rest.match(/\[([A-Za-z0-9]+)\]/);
  const underscoreRev = rest.match(/^_+([A-Za-z0-9])_+/);
  if (bracketRev) {
    rest = rest.slice(0, bracketRev.index) + rest.slice(bracketRev.index! + bracketRev[0].length);
  } else if (underscoreRev) {
    rest = rest.slice(underscoreRev[0].length);
  }
  const description = rest
    .replace(/^[-_\s]+|[-_\s]+$/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { jobNumber, zone, drawingNumber, description, filename };
}

export interface PickerEntry {
  file: DriveFile;
  parsed: ParsedModelName;
  projectName: string;
}

export interface PickerGroups {
  entries: PickerEntry[];
  scriptUrl: string;
}

type ProjectsMap = Record<string, string | { name: string; status?: string }>;

let projectsCache: Promise<ProjectsMap> | null = null;
function loadProjectsMap(): Promise<ProjectsMap> {
  if (!projectsCache) {
    projectsCache = fetch(`${import.meta.env.BASE_URL}projects.json`)
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}));
  }
  return projectsCache;
}

interface DriveConfig {
  scriptUrl: string;
  rootFolderId: string;
}
let driveConfigCache: Promise<DriveConfig> | null = null;
function loadDriveConfig(): Promise<DriveConfig> {
  if (!driveConfigCache) {
    driveConfigCache = fetch(`${import.meta.env.BASE_URL}drive-config.json`).then((r) => r.json());
  }
  return driveConfigCache;
}

// The catalog's manual corrections (project names, per-model field
// overrides) — same catalog-overrides.json file the catalog page reads
// and writes, duplicated here for the same reason as the rest of this
// module (see the file-level comment). Consulted so an edited project
// name shows up consistently in the viewer too, not just the catalog.
type CatalogOverrides = {
  projects?: ProjectsMap;
  models?: Record<string, unknown>;
};
let overridesCache: Promise<CatalogOverrides> | null = null;
function loadOverridesMap(): Promise<CatalogOverrides> {
  if (!overridesCache) {
    overridesCache = loadDriveConfig()
      .then((config) => {
        if (!config.scriptUrl || !config.rootFolderId) return {};
        return fetch(`${config.scriptUrl}?action=getOverrides&folderId=${encodeURIComponent(config.rootFolderId)}`)
          .then((r) => r.json())
          .then((d) => (d.success ? (d.overrides as CatalogOverrides) ?? {} : {}));
      })
      .catch(() => ({}));
  }
  return overridesCache;
}

function resolveProjectName(projects: ProjectsMap, overrides: CatalogOverrides, jobNumber: string): string {
  const overrideEntry = overrides.projects?.[jobNumber];
  const overrideName = typeof overrideEntry === "string" ? overrideEntry : overrideEntry?.name;
  if (overrideName) return overrideName;
  const entry = projects[jobNumber];
  const name = typeof entry === "string" ? entry : entry?.name;
  return name ?? `Job ${jobNumber}`;
}

// The known project name for a job number, or null if nothing's actually
// been set for it yet (as opposed to the "Job <number>" fallback used for
// *display* — this is used to decide whether to pre-fill the Save dialog's
// project name field, where a fabricated fallback would be actively
// misleading to pre-fill and then silently save back as if it were real).
export async function getKnownProjectName(jobNumber: string): Promise<string | null> {
  const [projects, overrides] = await Promise.all([loadProjectsMap(), loadOverridesMap()]);
  const overrideEntry = overrides.projects?.[jobNumber];
  const overrideName = typeof overrideEntry === "string" ? overrideEntry : overrideEntry?.name;
  if (overrideName) return overrideName;
  const jsonEntry = projects[jobNumber];
  const jsonName = typeof jsonEntry === "string" ? jsonEntry : jsonEntry?.name;
  return jsonName ?? null;
}

// Saves a project name correction the same way the catalog's edit popup
// does — into catalog-overrides.json via the Apps Script backend, so it's
// visible to everyone browsing the catalog, not just this browser.
export async function saveProjectNameOverride(jobNumber: string, name: string): Promise<void> {
  const config = await loadDriveConfig();
  if (!config.scriptUrl || !config.rootFolderId) {
    throw new Error("Google Drive isn't configured — see README.md \"Google Drive setup\".");
  }
  const overrides = await loadOverridesMap();
  const projects = { ...(overrides.projects ?? {}) };
  const existing = projects[jobNumber];
  const existingStatus = typeof existing === "object" ? existing.status : undefined;
  projects[jobNumber] = { name, status: existingStatus };
  const updated: CatalogOverrides = { ...overrides, projects };

  const res = await fetch(config.scriptUrl, {
    method: "POST",
    // text/plain avoids a CORS preflight — see the comment in
    // apps-script/Code.gs for the full story.
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "saveOverrides", folderId: config.rootFolderId, overrides: updated }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Unknown error saving the project name");
  overridesCache = Promise.resolve(updated); // keep the cache in sync
}

// Fetches the same drive-config.json / project catalog the main catalog
// page uses, and returns a flat, parsed, project-labelled list ready to
// group and render.
export async function fetchDriveModels(): Promise<PickerGroups> {
  const config = await loadDriveConfig();
  if (!config.scriptUrl || config.scriptUrl.startsWith("REPLACE_") || !config.rootFolderId) {
    throw new Error("Google Drive isn't configured yet — see README.md \"Google Drive setup\".");
  }

  const [projects, overrides] = await Promise.all([loadProjectsMap(), loadOverridesMap()]);

  const url = `${config.scriptUrl}?action=list&folderId=${encodeURIComponent(config.rootFolderId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Backend error ${res.status}: ${res.statusText}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Unknown error listing files");

  const entries: PickerEntry[] = [];
  for (const file of data.files as DriveFile[]) {
    const parsed = parseModelFilename(file.name);
    if (!parsed) continue;
    entries.push({ file, parsed, projectName: resolveProjectName(projects, overrides, parsed.jobNumber) });
  }
  return { entries, scriptUrl: config.scriptUrl };
}

// Builds a "Job <number> — <Project> — Zone <zone>" style label for
// display in place of a raw filename, e.g. in the viewer header and the
// spatial tree's model group headers. Falls back to the filename itself
// if it doesn't match the naming convention (a locally-uploaded file with
// an arbitrary name, for instance).
export async function formatModelLabel(filename: string): Promise<string> {
  const parsed = parseModelFilename(filename);
  if (!parsed) return filename;
  const [projects, overrides] = await Promise.all([loadProjectsMap(), loadOverridesMap()]);
  const projectName = resolveProjectName(projects, overrides, parsed.jobNumber);
  return `Job ${parsed.jobNumber} — ${projectName} — Zone ${parsed.zone}`;
}

export async function downloadDriveModel(scriptUrl: string, fileId: string): Promise<{ name: string; bytes: Uint8Array }> {
  const url = `${scriptUrl}?action=download&fileId=${encodeURIComponent(fileId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Backend error (${res.status})`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Unknown error downloading file");
  const binary = atob(data.contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { name: data.name, bytes };
}
