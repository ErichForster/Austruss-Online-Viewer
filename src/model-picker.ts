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

function resolveProjectName(projects: ProjectsMap, jobNumber: string): string {
  const entry = projects[jobNumber];
  const name = typeof entry === "string" ? entry : entry?.name;
  return name ?? `Job ${jobNumber}`;
}

// Fetches the same drive-config.json / project catalog the main catalog
// page uses, and returns a flat, parsed, project-labelled list ready to
// group and render.
export async function fetchDriveModels(): Promise<PickerGroups> {
  const config = await fetch(`${import.meta.env.BASE_URL}drive-config.json`).then((r) => r.json());
  if (!config.scriptUrl || config.scriptUrl.startsWith("REPLACE_") || !config.rootFolderId) {
    throw new Error("Google Drive isn't configured yet — see README.md \"Google Drive setup\".");
  }

  const projects = await loadProjectsMap();

  const url = `${config.scriptUrl}?action=list&folderId=${encodeURIComponent(config.rootFolderId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Backend error ${res.status}: ${res.statusText}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Unknown error listing files");

  const entries: PickerEntry[] = [];
  for (const file of data.files as DriveFile[]) {
    const parsed = parseModelFilename(file.name);
    if (!parsed) continue;
    entries.push({ file, parsed, projectName: resolveProjectName(projects, parsed.jobNumber) });
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
  const projects = await loadProjectsMap();
  const projectName = resolveProjectName(projects, parsed.jobNumber);
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
