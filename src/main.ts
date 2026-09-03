import "./style.css";
import "./app.css";
import * as WEBIFC from "web-ifc";
import { icon } from "./icons";
import { IfcViewer, type Theme } from "./viewer";
import { SpatialTree } from "./tree";
import { renderProperties } from "./properties";

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`"${label}" took longer than ${ms / 1000}s — timed out`)), ms),
    ),
  ]);
}

// Theme: read + apply before first paint to avoid a flash of the wrong
// theme.
const THEME_KEY = "setout-theme";
function getStoredTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}
let currentTheme = getStoredTheme();
document.documentElement.setAttribute("data-theme", currentTheme);

const app = document.getElementById("app")!;

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="wordmark"><img class="brand-mark" src="${import.meta.env.BASE_URL}brand/austruss-icon.png" alt="Austruss" />Austruss Online Viewer</div>
      <span class="filename" id="filename"></span>
      <div class="toolbar">
        <button class="tool-btn" id="btn-fit" title="Fit view" disabled>${icon.fit}Fit</button>
        <div class="tool-sep"></div>
        <button class="tool-btn" id="btn-isolate" title="Isolate selection" disabled>${icon.isolate}Isolate</button>
        <button class="tool-btn" id="btn-show-all" title="Show all" disabled>${icon.showAll}Show all</button>
        <div class="tool-sep"></div>
        <button class="tool-btn" id="btn-pivot" title="Click a point on the model to set it as the orbit center" disabled>${icon.pivot}Set pivot</button>
        <div class="bg-picker-wrap">
          <button class="tool-btn" id="btn-background" title="Change viewport background" disabled>${icon.background}Background</button>
          <div class="bg-picker" id="bg-picker" hidden>
            <button class="bg-swatch" data-bg="theme" title="Match theme"><span class="bg-swatch-half bg-swatch-dark"></span><span class="bg-swatch-half bg-swatch-light"></span></button>
            <button class="bg-swatch" data-bg="#0e0101" style="background:#0e0101" title="Austruss dark"></button>
            <button class="bg-swatch" data-bg="#f7f5f3" style="background:#f7f5f3" title="Austruss light"></button>
            <button class="bg-swatch" data-bg="#ffffff" style="background:#ffffff" title="White"></button>
            <button class="bg-swatch" data-bg="#000000" style="background:#000000" title="Black"></button>
            <label class="bg-swatch bg-swatch-custom" title="Custom color">
              <input type="color" id="bg-custom" value="#0e0101" />
            </label>
          </div>
        </div>
        <div class="tool-sep"></div>
        <label class="upload-btn" for="file-input">${icon.upload}Open IFC</label>
        <button class="tool-btn" id="btn-save-local" title="Download the converted .frag file to your computer — for testing, without needing Drive configured" disabled>${icon.localSave}Save locally</button>
        <div class="bg-picker-wrap">
          <button class="tool-btn" id="btn-save" title="Save the current model to the shared Drive folder" disabled>${icon.cloudSave}Save to Drive</button>
          <div class="bg-picker save-picker" id="save-picker" hidden>
            <div class="save-picker-body">
              <label class="save-picker-label">File name</label>
              <input type="text" id="save-filename" class="save-filename-input" />
              <div class="save-picker-actions">
                <button class="tool-btn" id="save-cancel">Cancel</button>
                <button class="upload-btn" id="save-confirm">${icon.cloudSave}Save</button>
              </div>
            </div>
          </div>
        </div>
        <button class="theme-toggle" id="theme-toggle" title="Toggle light/dark theme"></button>
      </div>
    </header>
    <div class="body" id="body">
      <aside class="panel panel-left" id="panel-tree">
        <div class="panel-head">
          <span class="panel-title">Model tree</span>
        </div>
        <div class="panel-body" id="tree-root"></div>
      </aside>
      <div class="viewport-wrap" id="viewport-wrap">
        <button class="gutter-toggle left" id="toggle-tree" title="Toggle model tree">${icon.panelLeft}</button>
        <button class="gutter-toggle right" id="toggle-props" title="Toggle properties">${icon.panelRight}</button>
        <div id="viewer-canvas"></div>
        <div class="dropzone" id="dropzone">
          <svg class="dropzone-mark" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 34V14h6v9h20v-9h6v20h-6v-9H14v9z"/>
          </svg>
          <h1>Drop a model to view it</h1>
          <p>Parsing happens entirely in your browser — nothing is uploaded anywhere. Works with IFC2x3, IFC4, and previously-saved .frag files (which load much faster, since there's no IFC parsing to redo).</p>
          <span class="hint">.ifc / .frag</span>
          <label class="dropzone-option" id="skip-hardware-label">
            <input type="checkbox" id="skip-hardware" />
            Skip small hardware (screws, bolts, discrete accessories) — faster load on large models
          </label>
          <label class="dropzone-option" id="skip-proxy-label">
            <input type="checkbox" id="skip-proxy" />
            Skip mesh-based proxy elements (IfcBuildingElementProxy) — test only, may hide real elements
          </label>
          <input type="file" id="file-input" accept=".ifc,.frag" />
        </div>
      </div>
      <aside class="panel panel-right" id="panel-props">
        <div class="panel-head">
          <span class="panel-title">Properties</span>
        </div>
        <div class="panel-body" id="props-root"></div>
      </aside>
    </div>
  </div>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const filenameEl = $("filename");
const bodyEl = $("body");
const dropzone = $("dropzone");
const fileInput = $<HTMLInputElement>("file-input");
const viewportWrap = $("viewport-wrap");
const treeRoot = $("tree-root");
const propsRoot = $("props-root");
const btnFit = $<HTMLButtonElement>("btn-fit");
const btnIsolate = $<HTMLButtonElement>("btn-isolate");
const btnShowAll = $<HTMLButtonElement>("btn-show-all");
const btnPivot = $<HTMLButtonElement>("btn-pivot");
const btnBackground = $<HTMLButtonElement>("btn-background");
const bgPicker = $("bg-picker");
const bgCustomInput = $<HTMLInputElement>("bg-custom");
const btnSave = $<HTMLButtonElement>("btn-save");
const btnSaveLocal = $<HTMLButtonElement>("btn-save-local");
const savePicker = $("save-picker");
const saveFilenameInput = $<HTMLInputElement>("save-filename");
const saveCancelBtn = $<HTMLButtonElement>("save-cancel");
const saveConfirmBtn = $<HTMLButtonElement>("save-confirm");
const themeToggleBtn = $<HTMLButtonElement>("theme-toggle");
const toggleTree = $("toggle-tree");
const toggleProps = $("toggle-props");

let treeCollapsed = false;
let propsCollapsed = false;
function applyPanelState() {
  bodyEl.classList.toggle("tree-collapsed", treeCollapsed);
  bodyEl.classList.toggle("props-collapsed", propsCollapsed);
}
toggleTree.addEventListener("click", () => {
  treeCollapsed = !treeCollapsed;
  applyPanelState();
});
toggleProps.addEventListener("click", () => {
  propsCollapsed = !propsCollapsed;
  applyPanelState();
});

const viewerContainer = $<HTMLDivElement>("viewer-canvas");
const viewer = new IfcViewer(viewerContainer);

const tree = new SpatialTree(treeRoot, async (modelId, localId) => {
  await viewer.selectByLocalId(modelId, localId);
});
tree.clear();
renderProperties(propsRoot, null);

let currentSelection: { modelId: string; localId: number } | null = null;
let currentModelId: string | null = null;
let currentFileName = "";

viewer.onSelect = async (info) => {
  currentSelection = info;
  btnIsolate.disabled = !info;
  if (!info) {
    renderProperties(propsRoot, null);
    return;
  }
  tree.select(`${info.modelId}:${info.localId}`);
  const data = await viewer.getItemData(info.modelId, info.localId);
  renderProperties(propsRoot, data);
};

const STAGE_LABELS: Record<string, string> = {
  geometries: "Reading geometry",
  attributes: "Reading attributes",
  relations: "Reading relations",
  conversion: "Converting to fragments",
  decompressing: "Decompressing",
  parsing: "Parsing",
  generating: "Building 3D meshes",
  done: "Done",
};

let loadingStrip: HTMLElement | null = null;

function startLoading(label: string) {
  stopLoading();
  loadingStrip = document.createElement("div");
  loadingStrip.className = "loading-strip";
  loadingStrip.innerHTML = `
    <span class="spinner"></span>
    <div class="loading-text">
      <span class="loading-stage">${escapeHtml(label)}</span>
      <div class="loading-bar-track"><div class="loading-bar-fill" style="width:0%"></div></div>
    </div>
    <span class="loading-pct">0%</span>
  `;
  viewportWrap.appendChild(loadingStrip);
}

function updateLoading(progress: number, data: { process: string; state: string; entitiesProcessed?: number }) {
  if (!loadingStrip) return;
  if (data.process === "conversion" && data.state === "finish") {
    // web-ifc's progress ends here, but the Fragments worker still has to
    // build the actual 3D meshes from the parsed data — a step that reports
    // no progress of its own, especially heavy for high element-count
    // models. Switch to an indeterminate state rather than sitting at 100%.
    goIndeterminate("Building 3D meshes — this can take a while for large models");
    return;
  }
  const pct = Math.round(progress * 100);
  const stage = STAGE_LABELS[data.process] ?? data.process;
  const count = data.entitiesProcessed ? ` — ${data.entitiesProcessed.toLocaleString()} elements` : "";
  loadingStrip.querySelector(".loading-stage")!.textContent = `${stage}${count}`;
  const fill = loadingStrip.querySelector<HTMLElement>(".loading-bar-fill")!;
  fill.classList.remove("indeterminate");
  fill.style.width = `${pct}%`;
  loadingStrip.querySelector(".loading-pct")!.textContent = `${pct}%`;
}

function goIndeterminate(label: string) {
  if (!loadingStrip) return;
  loadingStrip.querySelector(".loading-stage")!.textContent = label;
  loadingStrip.querySelector<HTMLElement>(".loading-bar-fill")!.classList.add("indeterminate");
  loadingStrip.querySelector(".loading-pct")!.textContent = "";
}

function stopLoading() {
  loadingStrip?.remove();
  loadingStrip = null;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showError(message: string) {
  const existing = viewportWrap.querySelector(".toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  viewportWrap.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

async function handleFile(file: File) {
  const lowerName = file.name.toLowerCase();
  const isFrag = lowerName.endsWith(".frag");
  if (!lowerName.endsWith(".ifc") && !isFrag) {
    showError("That doesn't look like an .ifc or .frag file.");
    return;
  }
  const skipHardware = $<HTMLInputElement>("skip-hardware").checked;
  const skipProxy = $<HTMLInputElement>("skip-proxy").checked;
  dropzone.style.display = "none";
  startLoading(isFrag ? `Loading ${file.name}…` : `Parsing ${file.name}…`);
  filenameEl.textContent = file.name;

  // Opening a new file replaces whatever's currently loaded rather than
  // adding a second model into the same scene — the tree, properties
  // panel, and isolate/show-all all assume a single active model.
  if (currentModelId) {
    await viewer.clearModels();
    currentModelId = null;
    currentSelection = null;
    btnSave.disabled = true;
    btnSaveLocal.disabled = true;
    tree.clear();
    renderProperties(propsRoot, null);
  }

  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    let model: Awaited<ReturnType<typeof viewer.loadIfc>>;

    if (isFrag) {
      model = await viewer.loadFragments(buffer, file.name, (event) => {
        updateLoading(event.progress, {
          process: event.stage,
          state: event.progress >= 1 ? "finish" : "inProgress",
        });
      });
    } else {
      const excludeCategories: number[] = [];
      if (skipHardware) {
        excludeCategories.push(
          WEBIFC.IFCMECHANICALFASTENER,
          WEBIFC.IFCFASTENER,
          WEBIFC.IFCDISCRETEACCESSORY,
        );
      }
      if (skipProxy) {
        excludeCategories.push(WEBIFC.IFCBUILDINGELEMENTPROXY);
      }
      model = await viewer.loadIfc(buffer, file.name, {
        onProgress: (progress, data) => updateLoading(progress, data),
        excludeCategories: excludeCategories.length ? excludeCategories : undefined,
      });
    }
    console.log("[handleFile] model loaded, starting fitView()");
    const tFit = performance.now();
    await withTimeout(viewer.fitView(false), 15000, "fitView");
    console.log(`[handleFile] fitView() done (${((performance.now() - tFit) / 1000).toFixed(1)}s)`);

    stopLoading();
    btnFit.disabled = false;
    btnShowAll.disabled = false;
    btnPivot.disabled = false;
    btnBackground.disabled = false;

    currentModelId = model.modelId;
    currentFileName = file.name;
    btnSaveLocal.disabled = false;
    const config = await getDriveConfig().catch(() => null);
    btnSave.disabled = !config || !isConfigured(config.scriptUrl);

    const tStruct = performance.now();
    const structure = await withTimeout(model.getSpatialStructure(), 15000, "getSpatialStructure");
    console.log(
      `[handleFile] getSpatialStructure() done (${((performance.now() - tStruct) / 1000).toFixed(1)}s)`,
    );
    const tTree = performance.now();
    tree.render(model.modelId, structure);
    console.log(`[handleFile] tree.render() done (${((performance.now() - tTree) / 1000).toFixed(1)}s)`);
  } catch (err) {
    console.error(err);
    stopLoading();
    dropzone.style.display = "flex";
    filenameEl.textContent = "";
    showError(
      err instanceof Error
        ? `Couldn't load that IFC: ${err.message}`
        : "Couldn't load that IFC file.",
    );
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
  fileInput.value = "";
});

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag-over");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
});
dropzone.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("label")) return;
  fileInput.click();
});

btnFit.addEventListener("click", () => viewer.fitView());
btnShowAll.addEventListener("click", () => {
  viewer.showAll();
  currentSelection = null;
});
btnIsolate.addEventListener("click", () => {
  if (!currentSelection) return;
  viewer.isolate(currentSelection.modelId, [currentSelection.localId]);
});

// --- Set pivot: arm on click, consume the next canvas click, then disarm ---
let pivotArmed = false;
btnPivot.addEventListener("click", () => {
  pivotArmed = !pivotArmed;
  btnPivot.classList.toggle("active", pivotArmed);
  viewerContainer.style.cursor = pivotArmed ? "crosshair" : "";
});
viewerContainer.addEventListener("click", () => {
  if (!pivotArmed) return;
  viewer.setPivotFromClick();
  pivotArmed = false;
  btnPivot.classList.remove("active");
  viewerContainer.style.cursor = "";
});

// --- Background picker popover ---
btnBackground.addEventListener("click", (e) => {
  e.stopPropagation();
  savePicker.hidden = true;
  bgPicker.hidden = !bgPicker.hidden;
});
bgPicker.addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", () => {
  bgPicker.hidden = true;
  savePicker.hidden = true;
});
for (const swatch of bgPicker.querySelectorAll<HTMLButtonElement>(".bg-swatch[data-bg]")) {
  swatch.addEventListener("click", () => {
    const value = swatch.dataset.bg!;
    viewer.setBackground(value === "theme" ? null : value);
    bgPicker.hidden = true;
  });
}
bgCustomInput.addEventListener("input", () => {
  viewer.setBackground(bgCustomInput.value);
});
bgCustomInput.addEventListener("click", (e) => e.stopPropagation());

// --- Save locally (browser download) — for testing without Drive set up ---
btnSaveLocal.addEventListener("click", async () => {
  if (!currentModelId) return;
  const filename = currentFileName.replace(/\.(ifc|frag)$/i, "") + ".frag";
  try {
    const exported = await viewer.exportModelBuffer(currentModelId);
    const blob = new Blob([new Uint8Array(exported)], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showError(err instanceof Error ? `Couldn't export: ${err.message}` : "Couldn't export the model.");
  }
});

// --- Save to Drive popover ---
btnSave.addEventListener("click", (e) => {
  e.stopPropagation();
  bgPicker.hidden = true;
  // Save exports the loaded model back to the compact .frag format (see
  // saveToDrive) rather than re-uploading the original .ifc bytes — pre-
  // fill the matching filename so the naming convention still parses.
  saveFilenameInput.value = currentFileName.replace(/\.(ifc|frag)$/i, "") + ".frag";
  savePicker.hidden = !savePicker.hidden;
  if (!savePicker.hidden) saveFilenameInput.focus();
});
savePicker.addEventListener("click", (e) => e.stopPropagation());
saveCancelBtn.addEventListener("click", () => {
  savePicker.hidden = true;
});
saveConfirmBtn.addEventListener("click", () => {
  savePicker.hidden = true;
  saveToDrive(saveFilenameInput.value.trim());
});
saveFilenameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveConfirmBtn.click();
  if (e.key === "Escape") savePicker.hidden = true;
});

function arrayBufferToBase64(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([new Uint8Array(bytes)]));
  });
}

async function saveToDrive(filename: string) {
  if (!currentModelId) return;
  if (!filename.toLowerCase().endsWith(".frag")) {
    showError("File name must end in .frag");
    return;
  }

  const config = await getDriveConfig().catch(() => null);
  if (!config || !isConfigured(config.scriptUrl) || !isConfigured(config.rootFolderId)) {
    showError("Save isn't configured yet — see README.md \"Enabling save\".");
    return;
  }

  startLoading(`Exporting ${filename}…`);
  try {
    // Exports the compact, converted Fragments buffer rather than
    // re-uploading the original .ifc — same model, a fraction of the size,
    // and loads back in without needing to re-parse IFC at all next time.
    const exported = await viewer.exportModelBuffer(currentModelId);

    // ~50MB is the practical ceiling for an Apps Script Web App POST body,
    // and base64 inflates the payload by roughly a third. Checking the
    // exported size (not the original file's) since that's what's
    // actually being uploaded — usually much smaller than the source IFC.
    const estimatedPayloadMB = (exported.byteLength * 1.34) / (1024 * 1024);
    if (estimatedPayloadMB > 48) {
      stopLoading();
      showError(
        `Even the converted version is too large to save this way (~${estimatedPayloadMB.toFixed(0)}MB encoded, limit is around 50MB) — upload it to the Drive folder directly instead.`,
      );
      return;
    }

    startLoading(`Saving ${filename} to Drive…`);
    const contentBase64 = await arrayBufferToBase64(exported);
    const res = await fetch(config.scriptUrl, {
      method: "POST",
      // text/plain avoids a CORS preflight that Apps Script Web Apps can't
      // handle — see the comment in apps-script/Code.gs for the full story.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ filename, contentBase64, folderId: config.rootFolderId }),
    });
    const result = await res.json();
    stopLoading();
    if (!result.success) throw new Error(result.error || "Unknown error");
    currentFileName = filename;
    filenameEl.textContent = filename;
  } catch (err) {
    stopLoading();
    showError(err instanceof Error ? `Couldn't save to Drive: ${err.message}` : "Couldn't save to Drive.");
  }
}

// --- Light/dark theme toggle ---
function renderThemeIcon() {
  themeToggleBtn.innerHTML = currentTheme === "dark" ? icon.sun : icon.moon;
  themeToggleBtn.title = currentTheme === "dark" ? "Switch to light theme" : "Switch to dark theme";
}
renderThemeIcon();
themeToggleBtn.addEventListener("click", () => {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, currentTheme);
  document.documentElement.setAttribute("data-theme", currentTheme);
  viewer.applyTheme(currentTheme);
  renderThemeIcon();
});

interface DriveConfig {
  scriptUrl: string;
  rootFolderId: string;
}

let driveConfigPromise: Promise<DriveConfig> | null = null;
function getDriveConfig(): Promise<DriveConfig> {
  // Fetches the same public/drive-config.json that drive.ts reads for the
  // catalog page — not importing drive.ts itself keeps this page's JS
  // chunk independent of catalog's, so neither pulls in the other's bundle.
  if (!driveConfigPromise) {
    driveConfigPromise = fetch(`${import.meta.env.BASE_URL}drive-config.json`).then((r) => r.json());
  }
  return driveConfigPromise;
}
function isConfigured(value: string): boolean {
  return !!value && !value.startsWith("REPLACE_");
}

viewer.init(currentTheme).then(async () => {
  await loadFromQueryParams();
  const config = await getDriveConfig().catch(() => null);
  btnSaveLocal.disabled = !currentModelId;
  btnSave.disabled = !config || !isConfigured(config.scriptUrl) || !currentModelId;
}).catch((err) => {
  console.error(err);
  showError("The 3D viewer failed to start. Check the console for details.");
});

// Supports opening a model straight from the catalog page, e.g.
// index.html?fileId=<driveFileId>&name=<originalFilename>
async function loadFromQueryParams() {
  const params = new URLSearchParams(location.search);
  const fileId = params.get("fileId");
  const name = params.get("name") ?? "model.ifc";
  if (!fileId) return;

  const config = await getDriveConfig();
  dropzone.style.display = "none";
  startLoading(`Fetching ${name} from Drive…`);
  filenameEl.textContent = name;

  try {
    const url = `${config.scriptUrl}?action=download&fileId=${encodeURIComponent(fileId)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Backend error (${res.status})`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Unknown error downloading file");
    const bytes = base64ToBytes(data.contentBase64);
    await handleFile(new File([new Uint8Array(bytes)], data.name || name));
  } catch (err) {
    console.error(err);
    stopLoading();
    dropzone.style.display = "flex";
    filenameEl.textContent = "";
    showError(
      err instanceof Error ? `Couldn't load model from Drive: ${err.message}` : "Couldn't load model from Drive.",
    );
  }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

