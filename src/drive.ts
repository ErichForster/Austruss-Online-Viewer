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
