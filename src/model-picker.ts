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

// Fetches the same drive-config.json / project catalog the main catalog
// page uses, and returns a flat, parsed, project-labelled list ready to
// group and render.
export async function fetchDriveModels(): Promise<PickerGroups> {
  const config = await fetch(`${import.meta.env.BASE_URL}drive-config.json`).then((r) => r.json());
  if (!config.scriptUrl || config.scriptUrl.startsWith("REPLACE_") || !config.rootFolderId) {
    throw new Error("Google Drive isn't configured yet — see README.md \"Google Drive setup\".");
  }

  let projects: Record<string, string> = {};
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}projects.json`);
    if (res.ok) projects = await res.json();
  } catch {
    // Optional — falls back to "Job <number>" labels.
  }

  const url = `${config.scriptUrl}?action=list&folderId=${encodeURIComponent(config.rootFolderId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Backend error ${res.status}: ${res.statusText}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Unknown error listing files");

  const entries: PickerEntry[] = [];
  for (const file of data.files as DriveFile[]) {
    const parsed = parseModelFilename(file.name);
    if (!parsed) continue;
    entries.push({ file, parsed, projectName: projects[parsed.jobNumber] ?? `Job ${parsed.jobNumber}` });
  }
  return { entries, scriptUrl: config.scriptUrl };
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
