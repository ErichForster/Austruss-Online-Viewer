export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
}

interface DriveConfig {
  scriptUrl: string;
  rootFolderId: string;
}

let configPromise: Promise<DriveConfig> | null = null;

// Config lives in public/drive-config.json (fetched at runtime, not
// bundled) so it can be edited without a rebuild — see README.md
// "Google Drive setup".
export function loadDriveConfig(): Promise<DriveConfig> {
  if (!configPromise) {
    configPromise = fetch(`${import.meta.env.BASE_URL}drive-config.json`).then((res) => {
      if (!res.ok) throw new Error(`Couldn't load drive-config.json (${res.status})`);
      return res.json();
    });
  }
  return configPromise;
}

export function isDriveConfigured(config: DriveConfig): boolean {
  return !config.scriptUrl.startsWith("REPLACE_") && !config.rootFolderId.startsWith("REPLACE_");
}

// Lists every .ifc/.frag file under the configured root folder, walking
// subfolders — handled server-side by the Apps Script backend's "list"
// action (apps-script/Code.gs), which runs under the deploying account's
// own Drive access rather than needing a public API key.
export async function listIfcFiles(): Promise<DriveFile[]> {
  const config = await loadDriveConfig();
  const url = `${config.scriptUrl}?action=list&folderId=${encodeURIComponent(config.rootFolderId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Backend error ${res.status}: ${res.statusText}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Unknown error listing files");
  return data.files as DriveFile[];
}

export interface ModelOverride {
  description?: string;
  zone?: string;
  drawingNumber?: string;
  revision?: string;
}

export interface CatalogOverrides {
  // string is the older/simpler shape (name only, from before project
  // status could be set here) — still read for backward compatibility,
  // but the app always writes the object shape going forward.
  projects?: Record<string, string | { name?: string; status?: "active" | "complete" }>;
  models?: Record<string, ModelOverride>;
}

// Manual corrections made via the catalog's edit buttons — project name
// overrides by job number, and per-model field overrides by filename —
// stored as a small JSON file in the same Drive folder as the models
// (catalog-overrides.json), so a fix is visible to everyone browsing the
// catalog, not just saved in one person's browser.
export async function getCatalogOverrides(): Promise<CatalogOverrides> {
  const config = await loadDriveConfig();
  const url = `${config.scriptUrl}?action=getOverrides&folderId=${encodeURIComponent(config.rootFolderId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Backend error ${res.status}: ${res.statusText}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Unknown error loading overrides");
  return (data.overrides as CatalogOverrides) ?? {};
}

export async function saveCatalogOverrides(overrides: CatalogOverrides): Promise<void> {
  const config = await loadDriveConfig();
  const res = await fetch(config.scriptUrl, {
    method: "POST",
    // text/plain avoids a CORS preflight — see the comment in
    // apps-script/Code.gs for the full story.
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "saveOverrides", folderId: config.rootFolderId, overrides }),
  });
  if (!res.ok) throw new Error(`Backend error ${res.status}: ${res.statusText}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Unknown error saving overrides");
}
