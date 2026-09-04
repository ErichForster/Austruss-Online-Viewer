import "./style.css";
import "./app.css";
import * as WEBIFC from "web-ifc";
import { icon } from "./icons";
import { IfcViewer, type Theme } from "./viewer";
import { SpatialTree } from "./tree";
import { renderProperties } from "./properties";
import type { ItemData } from "@thatopen/fragments";

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
      <div class="wordmark"><img class="brand-mark" src="${import.meta.env.BASE_URL}brand/austruss-icon.png" alt="Austruss" /><span class="wordmark-text">Austruss Online Viewer</span></div>
      <a class="nav-link" href="${import.meta.env.BASE_URL}catalog.html" title="Browse saved models">${icon.showAll}<span class="nav-link-text">Browse models</span></a>
      <span class="filename" id="filename"></span>
      <div class="toolbar">
        <button class="tool-btn" id="btn-fit" title="Fit view" disabled>${icon.fit}Fit</button>
        <div class="tool-sep"></div>
        <button class="tool-btn" id="btn-isolate" title="Isolate selection" disabled>${icon.isolate}Isolate</button>
        <button class="tool-btn" id="btn-show-all" title="Show all" disabled>${icon.showAll}Show all</button>
        <div class="tool-sep desktop-only"></div>
        <button class="tool-btn desktop-only" id="btn-pivot" title="Click a point on the model to set it as the orbit center" disabled>${icon.pivot}Set pivot</button>
        <div class="bg-picker-wrap desktop-only">
          <button class="tool-btn" id="btn-locations" title="Save and recall named pivot points" disabled>${icon.mapPin}Locations</button>
          <div class="bg-picker locations-picker" id="locations-picker" hidden>
            <div class="save-picker-body">
              <label class="save-picker-label" for="location-name-input">Save current pivot as</label>
              <div class="locations-save-row">
                <input type="text" id="location-name-input" class="save-filename-input" placeholder="e.g. Stair core" />
                <button class="upload-btn" id="location-save-btn">Save</button>
              </div>
              <div class="locations-list" id="locations-list"></div>
            </div>
          </div>
        </div>
        <div class="bg-picker-wrap desktop-only">
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
            <label class="bg-swatch bg-swatch-image" title="Upload a custom background image">
              ${icon.image}
              <input type="file" id="bg-image-input" accept="image/*" />
            </label>
          </div>
        </div>
        <div class="tool-sep"></div>
        <label class="upload-btn" for="file-input">${icon.upload}Open IFC</label>
        <input type="file" id="add-model-input" accept=".ifc,.frag" style="display:none" />
        <button class="tool-btn desktop-only" id="btn-save-local" title="Download the converted .frag file to your computer — for testing, without needing Drive configured" disabled>${icon.localSave}Save locally</button>
        <div class="bg-picker-wrap desktop-only">
          <button class="tool-btn" id="btn-save" title="Save to the shared Drive folder — saves every loaded model separately if more than one is open" disabled>${icon.cloudSave}Save to Drive</button>
          <div class="bg-picker save-picker" id="save-picker" hidden>
            <div class="save-picker-body">
              <label class="save-picker-label" for="save-filename">File name</label>
              <input type="text" id="save-filename" class="save-filename-input" />
              <div class="save-naming-fields" id="save-naming-fields" hidden>
                <p class="save-naming-hint">That name doesn't match the required format (Job-Product-Zone-Drawing) — the catalog won't be able to find it. Fill these in and hit Save again:</p>
                <div class="save-naming-row">
                  <input type="text" id="save-job" placeholder="Job #" class="save-naming-input" />
                  <input type="text" id="save-product" placeholder="Product" class="save-naming-input" value="LGS" />
                  <input type="text" id="save-zone" placeholder="Zone" class="save-naming-input" />
                  <input type="text" id="save-drawing" placeholder="Drawing #" class="save-naming-input" />
                </div>
              </div>
              <div class="save-picker-actions">
                <button class="tool-btn" id="save-cancel">Cancel</button>
                <button class="upload-btn" id="save-confirm">${icon.cloudSave}Save</button>
              </div>
              <div class="save-result" id="save-result" hidden></div>
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
          <div class="tree-head-actions">
            <div class="tree-add-wrap">
              <button class="panel-add-btn" id="btn-sessions" title="Save or recall a set of models">${icon.bookmark}</button>
              <div class="bg-picker save-picker sessions-picker" id="sessions-picker" hidden>
                <div class="save-picker-body">
                  <label class="save-picker-label" for="session-name-input">Save current models as</label>
                  <div class="locations-save-row">
                    <input type="text" id="session-name-input" class="save-filename-input" placeholder="e.g. Lennox Head — coordination" />
                    <button class="upload-btn" id="session-save-btn">Save</button>
                  </div>
                  <div class="locations-list" id="sessions-list"></div>
                </div>
              </div>
            </div>
            <div class="tree-add-wrap">
              <button class="panel-add-btn" id="btn-add-model-tree" title="Add another model" disabled>${icon.plus}</button>
              <div class="tree-add-menu" id="tree-add-menu" hidden>
                <label class="tree-add-menu-item" for="add-model-input">${icon.upload}Upload file</label>
                <button class="tree-add-menu-item" id="btn-browse-drive">${icon.mapPin}Browse Drive</button>
              </div>
            </div>
          </div>
          <button class="panel-close mobile-only" id="close-tree" title="Close">${icon.close}</button>
        </div>
        <div class="panel-body" id="tree-root"></div>
      </aside>
      <div class="viewport-wrap" id="viewport-wrap">
        <button class="gutter-toggle left" id="toggle-tree" title="Toggle model tree">${icon.panelLeft}</button>
        <button class="gutter-toggle right" id="toggle-props" title="Toggle properties">${icon.panelRight}</button>
        <div id="viewer-canvas"></div>
        <div class="selection-pin" id="selection-pin" hidden>
          <div class="selection-pin-dot"></div>
          <div class="selection-pin-card">
            <div class="selection-pin-name" id="selection-pin-name"></div>
            <div class="selection-pin-frame" id="selection-pin-frame"></div>
          </div>
        </div>
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
          <button class="panel-close mobile-only" id="close-props" title="Close">${icon.close}</button>
        </div>
        <div class="panel-body" id="props-root"></div>
      </aside>
    </div>
  </div>
  <div class="modal-overlay" id="drive-browse-modal" hidden>
    <div class="modal-panel">
      <div class="modal-head">
        <span class="modal-title">Add model from Drive</span>
        <button class="modal-close" id="drive-browse-close" title="Close">${icon.close}</button>
      </div>
      <input class="modal-search" id="drive-browse-search" type="text" placeholder="Search job, project, zone…" />
      <div class="modal-body" id="drive-browse-body">
        <p class="catalog-state">Loading…</p>
      </div>
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
const selectionPin = $("selection-pin");
const selectionPinName = $("selection-pin-name");
const selectionPinFrame = $("selection-pin-frame");
const btnFit = $<HTMLButtonElement>("btn-fit");
const btnIsolate = $<HTMLButtonElement>("btn-isolate");
const btnShowAll = $<HTMLButtonElement>("btn-show-all");
const btnPivot = $<HTMLButtonElement>("btn-pivot");
const btnLocations = $<HTMLButtonElement>("btn-locations");
const locationsPicker = $("locations-picker");
const locationNameInput = $<HTMLInputElement>("location-name-input");
const locationSaveBtn = $<HTMLButtonElement>("location-save-btn");
const locationsList = $("locations-list");
const btnBackground = $<HTMLButtonElement>("btn-background");
const bgPicker = $("bg-picker");
const bgCustomInput = $<HTMLInputElement>("bg-custom");
const bgImageInput = $<HTMLInputElement>("bg-image-input");
const btnSave = $<HTMLButtonElement>("btn-save");
const btnSaveLocal = $<HTMLButtonElement>("btn-save-local");
const savePicker = $("save-picker");
const saveFilenameInput = $<HTMLInputElement>("save-filename");
const saveNamingFields = $("save-naming-fields");
const saveJobInput = $<HTMLInputElement>("save-job");
const saveProductInput = $<HTMLInputElement>("save-product");
const saveZoneInput = $<HTMLInputElement>("save-zone");
const saveDrawingInput = $<HTMLInputElement>("save-drawing");
const saveResultEl = $("save-result");
const saveCancelBtn = $<HTMLButtonElement>("save-cancel");
const saveConfirmBtn = $<HTMLButtonElement>("save-confirm");
const themeToggleBtn = $<HTMLButtonElement>("theme-toggle");
const toggleTree = $("toggle-tree");
const toggleProps = $("toggle-props");

// On mobile the side panels are full-screen overlays rather than grid
// columns (see the ≤768px rules in app.css), so they should start hidden
// rather than open over the viewport the moment the page loads.
const isMobileLayout = window.matchMedia("(max-width: 768px)").matches;
let treeCollapsed = isMobileLayout;
let propsCollapsed = isMobileLayout;
function applyPanelState() {
  bodyEl.classList.toggle("tree-collapsed", treeCollapsed);
  bodyEl.classList.toggle("props-collapsed", propsCollapsed);
}
applyPanelState();
toggleTree.addEventListener("click", () => {
  treeCollapsed = !treeCollapsed;
  applyPanelState();
});
toggleProps.addEventListener("click", () => {
  propsCollapsed = !propsCollapsed;
  applyPanelState();
});

// Mobile-only close buttons inside each panel's header — needed because
// once a panel is a full-screen overlay, its own toggle button (which sits
// on the viewport edge) is covered by the overlay and can't be tapped
// again to close it.
$<HTMLButtonElement>("close-tree").addEventListener("click", () => {
  treeCollapsed = true;
  applyPanelState();
});
$<HTMLButtonElement>("close-props").addEventListener("click", () => {
  propsCollapsed = true;
  applyPanelState();
});

const viewerContainer = $<HTMLDivElement>("viewer-canvas");
const viewer = new IfcViewer(viewerContainer);

const loadedModels = new Map<string, string>(); // modelId -> filename
// Only populated for models loaded from Drive (catalog deep-link, "Browse
// Drive") — needed to save a session, since only Drive-sourced models can
// be reliably re-fetched later. A locally-uploaded file has no entry here.
const modelDriveFileIds = new Map<string, string>(); // modelId -> Drive fileId

function updateFilenameDisplay() {
  if (loadedModels.size === 0) filenameEl.textContent = "";
  else if (loadedModels.size === 1) filenameEl.textContent = [...loadedModels.values()][0];
  else filenameEl.textContent = `${loadedModels.size} models`;
}

const tree = new SpatialTree(
  treeRoot,
  async (modelId, localId) => {
    await viewer.selectByLocalId(modelId, localId);
  },
  async (modelId) => {
    await viewer.unloadModel(modelId);
    tree.removeModel(modelId);
    loadedModels.delete(modelId);
    modelDriveFileIds.delete(modelId);
    updateFilenameDisplay();
    if (currentModelId === modelId) {
      const remaining = [...loadedModels.keys()];
      currentModelId = remaining.length ? remaining[remaining.length - 1] : null;
      currentFileName = currentModelId ? loadedModels.get(currentModelId)! : "";
    }
    if (loadedModels.size === 0) {
      btnFit.disabled = true;
      btnShowAll.disabled = true;
      btnPivot.disabled = true;
      btnLocations.disabled = true;
      btnAddModelTree.disabled = true;
      btnBackground.disabled = true;
      btnSave.disabled = true;
      btnSaveLocal.disabled = true;
      dropzone.style.display = "flex";
      renderProperties(propsRoot, null);
      hidePin();
    }
  },
);
tree.clear();
renderProperties(propsRoot, null);

let currentSelection: { modelId: string; localId: number } | null = null;
let currentModelId: string | null = null;
let currentFileName = "";

// Searches every property set on an item for a property with the given
// name (case-insensitive) and returns its value as a string.
function findPropertyValue(data: ItemData, propName: string): string | null {
  const psets = (data.IsDefinedBy as ItemData[] | undefined) ?? [];
  for (const pset of psets) {
    const props = (pset.HasProperties as ItemData[] | undefined) ?? [];
    for (const prop of props) {
      const name = (prop.Name as { value?: unknown } | undefined)?.value;
      if (typeof name === "string" && name.toLowerCase() === propName.toLowerCase()) {
        const val =
          (prop.NominalValue as { value?: unknown } | undefined)?.value ??
          (prop.Value as { value?: unknown } | undefined)?.value;
        return val === undefined || val === null ? null : String(val);
      }
    }
  }
  return null;
}

let pinPoint: { x: number; y: number; z: number } | null = null;
let pinLoopActive = false;

function updatePinPosition() {
  if (!pinPoint) {
    pinLoopActive = false;
    return;
  }
  const pos = viewer.worldToScreen(pinPoint);
  if (pos) {
    selectionPin.hidden = false;
    selectionPin.style.left = `${pos.left}px`;
    selectionPin.style.top = `${pos.top}px`;
  } else {
    selectionPin.hidden = true;
  }
  requestAnimationFrame(updatePinPosition);
}

function showPin(point: { x: number; y: number; z: number }, name: string, frameName: string | null) {
  pinPoint = point;
  selectionPinName.textContent = name;
  selectionPinFrame.textContent = frameName ? `Frame: ${frameName}` : "";
  if (!pinLoopActive) {
    pinLoopActive = true;
    updatePinPosition();
  }
}

function hidePin() {
  pinPoint = null;
  selectionPin.hidden = true;
}

viewer.onSelect = async (info) => {
  currentSelection = info;
  btnIsolate.disabled = !info;
  if (!info) {
    renderProperties(propsRoot, null);
    hidePin();
    return;
  }
  // Selecting an element makes its model the "active" one for Save /
  // Locations, so those act on whatever's actually being worked with
  // rather than always whichever model was loaded most recently.
  if (loadedModels.has(info.modelId)) {
    currentModelId = info.modelId;
    currentFileName = loadedModels.get(info.modelId)!;
  }
  tree.select(`${info.modelId}:${info.localId}`);
  const data = await viewer.getItemData(info.modelId, info.localId);
  renderProperties(propsRoot, data);

  const center = await viewer.getItemCenter(info.modelId, info.localId);
  if (center && data) {
    const name = (data.Name as { value?: unknown } | undefined)?.value;
    showPin(center, name ? String(name) : "Unnamed element", findPropertyValue(data, "FrameName"));
  } else {
    hidePin();
  }
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

async function handleFile(file: File, mode: "replace" | "add" = "replace") {
  const lowerName = file.name.toLowerCase();
  const isFrag = lowerName.endsWith(".frag");
  if (!lowerName.endsWith(".ifc") && !isFrag) {
    showError("That doesn't look like an .ifc or .frag file.");
    return;
  }
  if (mode === "add" && loadedModels.has(file.name)) {
    showError(`"${file.name}" is already loaded.`);
    return;
  }
  const skipHardware = $<HTMLInputElement>("skip-hardware").checked;
  const skipProxy = $<HTMLInputElement>("skip-proxy").checked;
  dropzone.style.display = "none";
  startLoading(isFrag ? `Loading ${file.name}…` : `Parsing ${file.name}…`);

  // "replace" clears whatever's currently loaded first, so opening a file
  // the normal way still swaps in a single model as before. "add" (the
  // dedicated Add Model button) skips this, layering the new model in
  // alongside whatever's already there — for overlaying e.g. a services
  // model over a structural one.
  if (mode === "replace" && loadedModels.size > 0) {
    await viewer.clearModels();
    loadedModels.clear();
    modelDriveFileIds.clear();
    currentModelId = null;
    currentSelection = null;
    btnSave.disabled = true;
    btnSaveLocal.disabled = true;
    tree.clear();
    renderProperties(propsRoot, null);
    hidePin();
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
    btnLocations.disabled = false;
    btnAddModelTree.disabled = false;
    btnBackground.disabled = false;

    loadedModels.set(model.modelId, file.name);
    updateFilenameDisplay();
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
    tree.addModel(model.modelId, file.name, structure);
    console.log(`[handleFile] tree.addModel() done (${((performance.now() - tTree) / 1000).toFixed(1)}s)`);
  } catch (err) {
    console.error(err);
    stopLoading();
    if (loadedModels.size === 0) dropzone.style.display = "flex";
    updateFilenameDisplay();
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

const addModelInput = $<HTMLInputElement>("add-model-input");
addModelInput.addEventListener("change", () => {
  const file = addModelInput.files?.[0];
  if (file) handleFile(file, "add");
  addModelInput.value = "";
});

// --- Add-model menu (tree panel header) ---
const btnAddModelTree = $<HTMLButtonElement>("btn-add-model-tree");
const treeAddMenu = $("tree-add-menu");
const btnBrowseDrive = $<HTMLButtonElement>("btn-browse-drive");
// Positions a popover that's switched to position:fixed (see the CSS
// comment on .tree-add-menu / .sessions-picker) using the trigger button's
// actual screen position, since escaping the panel's overflow:hidden this
// way means it can no longer rely on CSS top/right relative to a
// (clipped) ancestor.
function positionFixedPopover(popover: HTMLElement, trigger: HTMLElement) {
  const rect = trigger.getBoundingClientRect();
  const width = popover.offsetWidth || 260;
  let left = rect.right - width;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  popover.style.top = `${rect.bottom + 6}px`;
  popover.style.left = `${left}px`;
}

btnAddModelTree.addEventListener("click", (e) => {
  e.stopPropagation();
  sessionsPicker.hidden = true;
  const willOpen = treeAddMenu.hidden;
  treeAddMenu.hidden = !treeAddMenu.hidden;
  if (willOpen) positionFixedPopover(treeAddMenu, btnAddModelTree);
});
treeAddMenu.addEventListener("click", (e) => {
  // The "Upload file" item is a <label for="add-model-input"> — let its
  // native click-to-open-file-dialog behavior happen, just close the menu.
  treeAddMenu.hidden = true;
  e.stopPropagation();
});
document.addEventListener("click", () => {
  treeAddMenu.hidden = true;
});

// --- Sessions: named sets of Drive-sourced models, saved in localStorage ---
interface SavedSession {
  name: string;
  models: { fileId: string; name: string }[];
}
const SESSIONS_KEY = "setout-sessions";
function getSessions(): SavedSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function setSessions(sessions: SavedSession[]) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // Storage quota etc. — not worth interrupting the person over.
  }
}

const btnSessions = $<HTMLButtonElement>("btn-sessions");
const sessionsPicker = $("sessions-picker");
const sessionNameInput = $<HTMLInputElement>("session-name-input");
const sessionSaveBtn = $<HTMLButtonElement>("session-save-btn");
const sessionsList = $("sessions-list");

function renderSessionsList() {
  sessionsList.innerHTML = "";
  const sessions = getSessions();
  if (!sessions.length) {
    sessionsList.innerHTML = `<div class="locations-empty">No saved sessions yet.</div>`;
    return;
  }
  for (const session of sessions) {
    const row = document.createElement("div");
    row.className = "location-row";
    row.innerHTML = `
      <span class="location-row-name">${session.name.replace(/</g, "&lt;")} <span class="grey-small">(${session.models.length})</span></span>
      <button class="location-row-delete" title="Delete">${icon.trash}</button>
    `;
    row.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".location-row-delete")) return;
      loadSession(session);
      sessionsPicker.hidden = true;
    });
    row.querySelector(".location-row-delete")!.addEventListener("click", (e) => {
      e.stopPropagation();
      setSessions(getSessions().filter((s) => s !== session));
      renderSessionsList();
    });
    sessionsList.appendChild(row);
  }
}

btnSessions.addEventListener("click", (e) => {
  e.stopPropagation();
  bgPicker.hidden = true;
  savePicker.hidden = true;
  locationsPicker.hidden = true;
  treeAddMenu.hidden = true;
  sessionsPicker.hidden = !sessionsPicker.hidden;
  if (!sessionsPicker.hidden) {
    renderSessionsList();
    positionFixedPopover(sessionsPicker, btnSessions);
  }
});
sessionsPicker.addEventListener("click", (e) => e.stopPropagation());

sessionSaveBtn.addEventListener("click", () => {
  const name = sessionNameInput.value.trim();
  if (!name) return;
  const models = [...loadedModels.keys()]
    .filter((modelId) => modelDriveFileIds.has(modelId))
    .map((modelId) => ({ fileId: modelDriveFileIds.get(modelId)!, name: loadedModels.get(modelId)! }));

  if (!models.length) {
    showError("None of the currently loaded models came from Drive — save them to Drive first, then they can be included in a session.");
    return;
  }
  const skipped = loadedModels.size - models.length;

  setSessions([...getSessions(), { name, models }]);
  sessionNameInput.value = "";
  renderSessionsList();
  if (skipped > 0) {
    showError(
      `Saved "${name}" with ${models.length} of ${loadedModels.size} loaded models — the other ${skipped} weren't loaded from Drive, so they can't be recalled later.`,
    );
  }
});
sessionNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sessionSaveBtn.click();
});

async function loadSession(session: SavedSession) {
  sessionsPicker.hidden = true;
  if (loadedModels.size > 0) {
    await viewer.clearModels();
    loadedModels.clear();
    modelDriveFileIds.clear();
    currentModelId = null;
    currentSelection = null;
    btnSave.disabled = true;
    btnSaveLocal.disabled = true;
    tree.clear();
    renderProperties(propsRoot, null);
    hidePin();
  }

  const { downloadDriveModel } = await import("./model-picker");
  const config = await getDriveConfig().catch(() => null);
  if (!config) {
    showError("Google Drive isn't configured — can't recall this session.");
    return;
  }

  let failures = 0;
  for (let i = 0; i < session.models.length; i++) {
    const m = session.models[i];
    dropzone.style.display = "none";
    startLoading(`Loading ${m.name}… (${i + 1}/${session.models.length})`);
    try {
      const { bytes } = await downloadDriveModel(config.scriptUrl, m.fileId);
      await handleFile(new File([new Uint8Array(bytes)], m.name), "add");
      modelDriveFileIds.set(m.name, m.fileId);
    } catch (err) {
      failures++;
      console.error(err);
    }
  }
  if (failures > 0) {
    showError(`Loaded ${session.models.length - failures} of ${session.models.length} models from "${session.name}" — the rest failed (check the console).`);
  }
}

// --- Add-from-Drive modal ---
const driveBrowseModal = $("drive-browse-modal");
const driveBrowseClose = $<HTMLButtonElement>("drive-browse-close");
const driveBrowseSearch = $<HTMLInputElement>("drive-browse-search");
const driveBrowseBody = $("drive-browse-body");
let driveBrowseEntries: import("./model-picker").PickerEntry[] = [];
let driveBrowseScriptUrl = "";

function closeDriveBrowse() {
  driveBrowseModal.hidden = true;
}
driveBrowseClose.addEventListener("click", closeDriveBrowse);
driveBrowseModal.addEventListener("click", (e) => {
  if (e.target === driveBrowseModal) closeDriveBrowse();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !driveBrowseModal.hidden) closeDriveBrowse();
});

function renderDriveBrowseList(filter: string) {
  const q = filter.trim().toLowerCase();
  const filtered = q
    ? driveBrowseEntries.filter((e) =>
        `${e.projectName} ${e.parsed.jobNumber} ${e.parsed.zone} ${e.parsed.description} ${e.file.name}`
          .toLowerCase()
          .includes(q),
      )
    : driveBrowseEntries;

  if (!filtered.length) {
    driveBrowseBody.innerHTML = `<p class="catalog-state">No models match.</p>`;
    return;
  }

  const byProject = new Map<string, typeof filtered>();
  for (const entry of filtered) {
    if (!byProject.has(entry.projectName)) byProject.set(entry.projectName, []);
    byProject.get(entry.projectName)!.push(entry);
  }

  driveBrowseBody.innerHTML = "";
  for (const [projectName, entries] of [...byProject.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const group = document.createElement("div");
    group.className = "drive-project-group";
    const jobNumber = entries[0].parsed.jobNumber;
    group.innerHTML = `
      <p class="drive-project-title">${projectName.replace(/</g, "&lt;")}</p>
      <p class="drive-project-job">Job ${jobNumber}</p>
    `;
    for (const entry of entries.sort((a, b) => a.file.name.localeCompare(b.file.name))) {
      const alreadyLoaded = loadedModels.has(entry.file.name);
      const row = document.createElement("div");
      row.className = `drive-model-row${alreadyLoaded ? " disabled" : ""}`;
      const ext = entry.file.name.toLowerCase().endsWith(".frag") ? "frag" : "ifc";
      row.innerHTML = `
        <span class="drive-model-zone">${entry.parsed.zone}</span>
        <span class="drive-model-desc">${(entry.parsed.description || entry.file.name).replace(/</g, "&lt;")}</span>
        <span class="drive-model-ext">${ext}</span>
      `;
      if (alreadyLoaded) {
        row.title = "Already loaded";
      } else {
        row.addEventListener("click", () => addModelFromDrive(entry.file.id, entry.file.name));
      }
      group.appendChild(row);
    }
    driveBrowseBody.appendChild(group);
  }
}

async function addModelFromDrive(fileId: string, name: string) {
  closeDriveBrowse();
  dropzone.style.display = "none";
  startLoading(`Fetching ${name} from Drive…`);
  try {
    const { downloadDriveModel } = await import("./model-picker");
    const { bytes } = await downloadDriveModel(driveBrowseScriptUrl, fileId);
    await handleFile(new File([new Uint8Array(bytes)], name), "add");
    modelDriveFileIds.set(name, fileId);
  } catch (err) {
    stopLoading();
    showError(err instanceof Error ? `Couldn't load model from Drive: ${err.message}` : "Couldn't load model from Drive.");
  }
}

btnBrowseDrive.addEventListener("click", async () => {
  treeAddMenu.hidden = true;
  driveBrowseModal.hidden = false;
  driveBrowseSearch.value = "";
  driveBrowseBody.innerHTML = `<p class="catalog-state">Loading…</p>`;
  try {
    const { fetchDriveModels } = await import("./model-picker");
    const result = await fetchDriveModels();
    driveBrowseEntries = result.entries;
    driveBrowseScriptUrl = result.scriptUrl;
    if (!driveBrowseEntries.length) {
      driveBrowseBody.innerHTML = `<p class="catalog-state">No models found in the configured Drive folder.</p>`;
      return;
    }
    renderDriveBrowseList("");
  } catch (err) {
    driveBrowseBody.innerHTML = `<div class="catalog-state error">${
      err instanceof Error ? err.message : "Couldn't load the Drive catalog."
    }</div>`;
  }
});
driveBrowseSearch.addEventListener("input", () => renderDriveBrowseList(driveBrowseSearch.value));

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
  hidePin();
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

// --- Locations: named pivot points, saved per model in localStorage ---
interface SavedLocation {
  name: string;
  point: { x: number; y: number; z: number };
}
function locationsKey(modelId: string): string {
  return `setout-locations:${modelId}`;
}
function getLocations(modelId: string): SavedLocation[] {
  try {
    const raw = localStorage.getItem(locationsKey(modelId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function setLocations(modelId: string, locations: SavedLocation[]) {
  try {
    localStorage.setItem(locationsKey(modelId), JSON.stringify(locations));
  } catch {
    // Storage quota etc. — not worth interrupting the person over.
  }
}
function renderLocationsList() {
  locationsList.innerHTML = "";
  if (!currentModelId) return;
  const locations = getLocations(currentModelId);
  if (!locations.length) {
    locationsList.innerHTML = `<div class="locations-empty">No saved locations for this model yet.</div>`;
    return;
  }
  for (const loc of locations) {
    const row = document.createElement("div");
    row.className = "location-row";
    row.innerHTML = `
      <span class="location-row-name">${loc.name.replace(/</g, "&lt;")}</span>
      <button class="location-row-delete" title="Delete">${icon.trash}</button>
    `;
    row.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".location-row-delete")) return;
      viewer.goToPivot(loc.point);
      locationsPicker.hidden = true;
    });
    row.querySelector(".location-row-delete")!.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!currentModelId) return;
      setLocations(currentModelId, getLocations(currentModelId).filter((l) => l !== loc));
      renderLocationsList();
    });
    locationsList.appendChild(row);
  }
}

btnLocations.addEventListener("click", (e) => {
  e.stopPropagation();
  bgPicker.hidden = true;
  savePicker.hidden = true;
  sessionsPicker.hidden = true;
  treeAddMenu.hidden = true;
  locationsPicker.hidden = !locationsPicker.hidden;
  if (!locationsPicker.hidden) renderLocationsList();
});
locationsPicker.addEventListener("click", (e) => e.stopPropagation());
locationSaveBtn.addEventListener("click", () => {
  const name = locationNameInput.value.trim();
  if (!name || !currentModelId) return;
  const point = viewer.getCurrentPivot();
  setLocations(currentModelId, [...getLocations(currentModelId), { name, point }]);
  locationNameInput.value = "";
  renderLocationsList();
});
locationNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") locationSaveBtn.click();
});

// --- Background picker popover ---
btnBackground.addEventListener("click", (e) => {
  e.stopPropagation();
  savePicker.hidden = true;
  locationsPicker.hidden = true;
  sessionsPicker.hidden = true;
  bgPicker.hidden = !bgPicker.hidden;
});
bgPicker.addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", () => {
  bgPicker.hidden = true;
  savePicker.hidden = true;
  locationsPicker.hidden = true;
  sessionsPicker.hidden = true;
});
const BG_IMAGE_KEY = "setout-bg-image";

for (const swatch of bgPicker.querySelectorAll<HTMLButtonElement>(".bg-swatch[data-bg]")) {
  swatch.addEventListener("click", () => {
    const value = swatch.dataset.bg!;
    viewer.setBackground(value === "theme" ? null : value);
    localStorage.removeItem(BG_IMAGE_KEY);
    bgPicker.hidden = true;
  });
}
bgCustomInput.addEventListener("input", () => {
  viewer.setBackground(bgCustomInput.value);
  localStorage.removeItem(BG_IMAGE_KEY);
});
bgCustomInput.addEventListener("click", (e) => e.stopPropagation());

bgImageInput.addEventListener("click", (e) => e.stopPropagation());
bgImageInput.addEventListener("change", async () => {
  const file = bgImageInput.files?.[0];
  bgImageInput.value = "";
  if (!file) return;
  bgPicker.hidden = true;

  try {
    await viewer.setBackgroundImage(file);
  } catch (err) {
    showError(err instanceof Error ? `Couldn't load that image: ${err.message}` : "Couldn't load that image.");
    return;
  }

  // Persisted as a data URL so it's restored on the next visit — capped at
  // a size that stays well clear of localStorage's ~5MB per-origin quota
  // (shared with the theme preference and any future saved settings).
  const MAX_SAVED_BYTES = 3 * 1024 * 1024;
  if (file.size > MAX_SAVED_BYTES) {
    showError(
      "Background applied, but it's too large to remember for next time (over 3MB) — it'll reset to the theme default on reload.",
    );
    return;
  }
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    localStorage.setItem(BG_IMAGE_KEY, dataUrl);
  } catch {
    // Storage quota errors etc. — the background is still applied for
    // this session, it just won't be remembered. Not worth interrupting
    // the person over.
  }
});

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
  locationsPicker.hidden = true;
  sessionsPicker.hidden = true;
  if (loadedModels.size > 1) {
    saveAllModelsToDrive();
    return;
  }
  // Save exports the loaded model back to the compact .frag format (see
  // saveToDrive) rather than re-uploading the original .ifc bytes — pre-
  // fill the matching filename so the naming convention still parses.
  saveFilenameInput.value = currentFileName.replace(/\.(ifc|frag)$/i, "") + ".frag";
  saveNamingFields.hidden = true;
  saveResultEl.hidden = true;
  savePicker.hidden = !savePicker.hidden;
  if (!savePicker.hidden) saveFilenameInput.focus();
});
savePicker.addEventListener("click", (e) => e.stopPropagation());
saveCancelBtn.addEventListener("click", () => {
  savePicker.hidden = true;
});
saveConfirmBtn.addEventListener("click", async () => {
  const { parseModelFilename } = await import("./model-picker");
  const typed = saveFilenameInput.value.trim();

  if (!saveNamingFields.hidden) {
    // Second click: the naming fields are already showing, meaning the
    // typed name failed the check once already — build a compliant name
    // from the fields instead of re-checking the (still non-matching)
    // typed text.
    const job = saveJobInput.value.trim();
    const product = saveProductInput.value.trim();
    const zone = saveZoneInput.value.trim();
    const drawing = saveDrawingInput.value.trim();
    if (!job || !product || !zone || !drawing) {
      showError("Fill in all four fields — Job, Product, Zone, and Drawing # are all required.");
      return;
    }
    const description = typed.replace(/\.(ifc|frag)$/i, "").replace(/[^a-zA-Z0-9]+/g, "_");
    const finalName = `${job}-${product}-${zone}-${drawing}_${description}.frag`;
    saveFilenameInput.value = finalName;
    saveNamingFields.hidden = true;
    saveToDrive(finalName);
    return;
  }

  if (!parseModelFilename(typed)) {
    saveNamingFields.hidden = false;
    saveJobInput.focus();
    return;
  }

  saveResultEl.hidden = true;
  saveToDrive(typed);
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

// Core save: exports one model's compact Fragments buffer and uploads it.
// Throws on failure — callers handle their own loading/error UI, since the
// single-model and save-all-models flows want different messaging.
async function saveModelToDrive(modelId: string, filename: string): Promise<string> {
  if (!filename.toLowerCase().endsWith(".frag")) {
    throw new Error("File name must end in .frag");
  }
  const config = await getDriveConfig().catch(() => null);
  if (!config || !isConfigured(config.scriptUrl) || !isConfigured(config.rootFolderId)) {
    throw new Error('Save isn\'t configured yet — see README.md "Enabling save".');
  }

  // Exports the compact, converted Fragments buffer rather than
  // re-uploading the original .ifc — same model, a fraction of the size,
  // and loads back in without needing to re-parse IFC at all next time.
  const exported = await viewer.exportModelBuffer(modelId);

  // ~50MB is the practical ceiling for an Apps Script Web App POST body,
  // and base64 inflates the payload by roughly a third. Checking the
  // exported size (not the original file's) since that's what's actually
  // being uploaded — usually much smaller than the source IFC.
  const estimatedPayloadMB = (exported.byteLength * 1.34) / (1024 * 1024);
  if (estimatedPayloadMB > 48) {
    throw new Error(
      `Even the converted version is too large to save this way (~${estimatedPayloadMB.toFixed(0)}MB encoded, limit is around 50MB) — upload it to the Drive folder directly instead.`,
    );
  }

  const contentBase64 = await arrayBufferToBase64(exported);
  const res = await fetch(config.scriptUrl, {
    method: "POST",
    // text/plain avoids a CORS preflight that Apps Script Web Apps can't
    // handle — see the comment in apps-script/Code.gs for the full story.
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ filename, contentBase64, folderId: config.rootFolderId }),
  });
  const result = await res.json();
  if (!result.success) throw new Error(result.error || "Unknown error");
  loadedModels.set(modelId, filename);
  return result.webViewLink as string;
}

async function saveToDrive(filename: string) {
  if (!currentModelId) return;
  startLoading(`Exporting ${filename}…`);
  try {
    const link = await saveModelToDrive(currentModelId, filename);
    stopLoading();
    currentFileName = filename;
    updateFilenameDisplay();
    showSaveResult(filename, link);
  } catch (err) {
    stopLoading();
    showError(err instanceof Error ? `Couldn't save to Drive: ${err.message}` : "Couldn't save to Drive.");
  }
}

function showSaveResult(filename: string, link: string) {
  saveResultEl.hidden = false;
  saveResultEl.innerHTML = `Saved <strong>${filename.replace(/</g, "&lt;")}</strong>. <a href="${link}" target="_blank" rel="noopener">Open share link ↗</a>`;
  savePicker.hidden = false; // keep the popover open so the link is visible
}

// Multiple models loaded — save each one under its own existing name
// (swapped to .frag) rather than the single-file rename flow, which
// doesn't make sense for more than one model at a time. Models whose name
// doesn't match the naming convention are skipped rather than guessed at
// — batch-saving isn't a good place to interactively prompt per model, so
// those get flagged for saving individually instead, where the popover
// can walk through the missing fields.
async function saveAllModelsToDrive() {
  const { parseModelFilename } = await import("./model-picker");
  const entries = [...loadedModels.entries()];
  let done = 0;
  const failures: string[] = [];
  const skipped: string[] = [];
  for (const [modelId, name] of entries) {
    const filename = name.replace(/\.(ifc|frag)$/i, "") + ".frag";
    if (!parseModelFilename(filename)) {
      skipped.push(filename);
      done++;
      continue;
    }
    startLoading(`Saving ${filename} to Drive… (${done + 1}/${entries.length})`);
    try {
      await saveModelToDrive(modelId, filename);
    } catch (err) {
      failures.push(`${filename}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
    done++;
  }
  stopLoading();
  updateFilenameDisplay();
  if (skipped.length) {
    showError(
      `Skipped ${skipped.length} model(s) that don't match the naming convention — save those individually instead: ${skipped.join(", ")}`,
    );
  } else if (failures.length) {
    showError(`Saved ${entries.length - skipped.length - failures.length}/${entries.length - skipped.length} models. Failed: ${failures.join("; ")}`);
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
  const savedBg = localStorage.getItem(BG_IMAGE_KEY);
  if (savedBg) {
    viewer.setBackgroundImage(savedBg).catch(() => localStorage.removeItem(BG_IMAGE_KEY));
  }
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
  const fileIds = params.getAll("fileId");
  const names = params.getAll("name");
  if (!fileIds.length) return;

  const config = await getDriveConfig();
  dropzone.style.display = "none";

  for (let i = 0; i < fileIds.length; i++) {
    const fileId = fileIds[i];
    const fallbackName = names[i] ?? "model.ifc";
    // First model replaces (the normal single-open case, or the first of
    // a multi-select "open together"); every one after that adds
    // alongside it, so a catalog multi-select opens as one overlay.
    const mode: "replace" | "add" = i === 0 ? "replace" : "add";

    startLoading(`Fetching ${fallbackName} from Drive… (${i + 1}/${fileIds.length})`);
    try {
      const url = `${config.scriptUrl}?action=download&fileId=${encodeURIComponent(fileId)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Backend error (${res.status})`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Unknown error downloading file");
      const bytes = base64ToBytes(data.contentBase64);
      const loadedName = data.name || fallbackName;
      await handleFile(new File([new Uint8Array(bytes)], loadedName), mode);
      modelDriveFileIds.set(loadedName, fileId);
    } catch (err) {
      console.error(err);
      stopLoading();
      showError(
        err instanceof Error
          ? `Couldn't load ${fallbackName} from Drive: ${err.message}`
          : `Couldn't load ${fallbackName} from Drive.`,
      );
      // Keep going with the rest of the selection rather than abandoning
      // the whole batch over one failed model.
    }
  }

  if (loadedModels.size === 0) {
    dropzone.style.display = "flex";
  }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

