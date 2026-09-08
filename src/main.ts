import "./style.css";
import "./app.css";
import * as WEBIFC from "web-ifc";
import { toDataURL as qrToDataURL } from "qrcode";
import { icon } from "./icons";
import { IfcViewer, type Theme } from "./viewer";
import { SpatialTree } from "./tree";
import type { TreeNodeNames } from "./tree";
import { renderProperties } from "./properties";
import type { ItemData, SpatialTreeItem } from "@thatopen/fragments";

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
  return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
}
let currentTheme = getStoredTheme();
document.documentElement.setAttribute("data-theme", currentTheme);

// External viewer mode (?external=1) — a restricted view for sharing with
// people outside Austruss. See the CSS comment on .external-mode for why
// this is a mode flag on this same page rather than a genuinely separate
// one. ?job=<number> scopes the "browse other models" link to just that
// project's catalog instead of the full company one.
const startupParams = new URLSearchParams(location.search);
const isExternalMode = startupParams.get("external") === "1";
if (isExternalMode) document.documentElement.classList.add("external-mode");
const externalJob = startupParams.get("job");

// Locations don't transfer to an external viewer's browser on their own
// (they live in this device's local storage) — the only way to hand one
// over is embedding it in the link itself. No in-app link generator for
// this yet (by request) — see README for the ?locations= format to build
// one by hand.
interface ExternalLocation {
  name: string;
  point: { x: number; y: number; z: number };
  cameraPosition?: { x: number; y: number; z: number };
}
let externalLocations: ExternalLocation[] = [];
if (isExternalMode) {
  const raw = startupParams.get("locations");
  if (raw) {
    try {
      externalLocations = JSON.parse(raw);
    } catch {
      // Malformed — ignore rather than break the page over it.
    }
  }
}

interface HomeView {
  point: { x: number; y: number; z: number };
  cameraPosition: { x: number; y: number; z: number };
}
let externalHome: HomeView | null = null;
if (isExternalMode) {
  const raw = startupParams.get("home");
  if (raw) {
    try {
      externalHome = JSON.parse(raw);
    } catch {
      // Malformed — ignore rather than break the page over it.
    }
  }
}

const app = document.getElementById("app")!;

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      ${
        isExternalMode
          ? `<div class="wordmark"><img class="brand-mark" src="${import.meta.env.BASE_URL}brand/austruss-icon.png" alt="Austruss" /><span class="wordmark-text">Austruss Online Viewer</span></div>`
          : `<a class="wordmark" href="${import.meta.env.BASE_URL}index.html" title="Back to a blank viewer"><img class="brand-mark" src="${import.meta.env.BASE_URL}brand/austruss-icon.png" alt="Austruss" /><span class="wordmark-text">Austruss Online Viewer</span></a>`
      }
      <a class="nav-link" href="${isExternalMode ? `${import.meta.env.BASE_URL}catalog.html?external=1&job=${encodeURIComponent(externalJob ?? "")}` : `${import.meta.env.BASE_URL}catalog.html`}" title="${isExternalMode ? "View other models in this project" : "Browse saved models"}">${icon.showAll}<span class="nav-link-text">${isExternalMode ? "Other zones" : "Browse models"}</span></a>
      <span class="filename" id="filename"></span>
      <div class="toolbar">
        <button class="tool-btn" id="btn-fit" title="Fit view" disabled>${icon.fit}Fit</button>
        <button class="tool-btn" id="btn-home" title="Go to the home view" disabled>${icon.home}Home</button>
        <button class="tool-btn desktop-only external-hide" id="btn-set-home" title="Save the current view as the home view for this model" disabled>${icon.homeFilled}Set home</button>
        <div class="tool-sep"></div>
        <button class="tool-btn" id="btn-isolate" title="Isolate selection" disabled>${icon.isolate}Isolate</button>
        <button class="tool-btn" id="btn-hide" title="Hide the selected element only, leaving everything else visible" disabled>${icon.hide}Hide</button>
        <button class="tool-btn" id="btn-show-all" title="Show all" disabled>${icon.showAll}Show all</button>
        <div class="tool-sep desktop-only"></div>
        <button class="tool-btn desktop-only external-hide" id="btn-pivot" title="Click a point on the model to set it as the orbit center" disabled>${icon.pivot}Set pivot</button>
        <div class="bg-picker-wrap desktop-only">
          <button class="tool-btn" id="btn-locations" title="Save and recall named pivot points" disabled>${icon.mapPin}Locations</button>
          <div class="bg-picker locations-picker" id="locations-picker" hidden>
            <div class="save-picker-body">
              <label class="save-picker-label external-hide" for="location-name-input">Save current pivot as</label>
              <div class="locations-save-row external-hide">
                <input type="text" id="location-name-input" class="save-filename-input" placeholder="e.g. Stair core" />
                <button class="upload-btn" id="location-save-btn">Save</button>
              </div>
              <div class="locations-list" id="locations-list"></div>
            </div>
          </div>
        </div>
        <div class="bg-picker-wrap desktop-only external-hide">
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
        <label class="upload-btn desktop-only external-hide" for="file-input">${icon.upload}Open IFC</label>
        <input type="file" id="add-model-input" accept=".ifc,.frag" style="display:none" />
        <button class="tool-btn desktop-only external-hide" id="btn-save-local" title="Download the converted .frag file to your computer — for testing, without needing Drive configured" disabled>${icon.localSave}Save locally</button>
        <div class="bg-picker-wrap desktop-only external-hide">
          <button class="tool-btn" id="btn-save" title="Save to the shared Drive folder — saves every loaded model separately if more than one is open" disabled>${icon.cloudSave}Save to Drive</button>
          <div class="bg-picker save-picker" id="save-picker" hidden>
            <div class="save-picker-body">
              <label class="save-picker-label" for="save-filename">File name</label>
              <input type="text" id="save-filename" class="save-filename-input" />
              <label class="save-picker-label" for="save-project-name">Project name</label>
              <input type="text" id="save-project-name" class="save-filename-input" placeholder="e.g. Lennox Head" />
              <div class="save-naming-fields" id="save-naming-fields" hidden>
                <p class="save-naming-hint">That name doesn't match the required format (Job-Product-Zone-Drawing) — the catalog won't be able to find it. Fill these in and hit Save again:</p>
                <div class="save-naming-row">
                  <div>
                    <label class="save-naming-label" for="save-job">Job #</label>
                    <input type="text" id="save-job" class="save-naming-input" />
                  </div>
                  <div>
                    <label class="save-naming-label" for="save-product">Product</label>
                    <input type="text" id="save-product" class="save-naming-input save-naming-input-upper" value="LGS" />
                  </div>
                  <div>
                    <label class="save-naming-label" for="save-zone">Zone</label>
                    <input type="text" id="save-zone" class="save-naming-input save-naming-input-upper" />
                  </div>
                  <div>
                    <label class="save-naming-label" for="save-drawing">Drawing #</label>
                    <input type="text" id="save-drawing" class="save-naming-input" />
                  </div>
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
        <button class="tool-btn external-hide" id="btn-share" title="Get an external, restricted link to this model" disabled>${icon.share}Share</button>
        <button class="theme-toggle" id="theme-toggle" title="Toggle light/dark theme"></button>
      </div>
    </header>
    <div class="body" id="body">
      <aside class="panel panel-left" id="panel-tree">
        <div class="panel-head">
          <span class="panel-title">Model tree</span>
          <div class="tree-head-actions" hidden title="Multi-model loading is temporarily disabled — see the notes on the open bug">
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
        <div class="tree-search-wrap">
          <input type="text" id="tree-search-input" class="tree-search-input" placeholder="Search by name…" />
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
  <div class="modal-overlay" id="share-modal" hidden>
    <div class="modal-panel share-modal-panel">
      <div class="modal-head">
        <span class="modal-title">Share externally</span>
        <button class="modal-close" id="share-close" title="Close">${icon.close}</button>
      </div>
      <div class="modal-body" id="share-body">
        <p class="share-hint">This link is restricted to viewing (no save/edit tools) and, if a job number is known, scoped to this project. See "Sharing with people outside Austruss" in the README — this app is public, so this is curation, not real access control.</p>
        <div class="share-row">
          <input type="text" id="share-link-input" class="share-link-input" readonly />
          <button class="upload-btn" id="share-copy-link">${icon.copy}Copy link</button>
        </div>
        <div class="share-qr-wrap">
          <img id="share-qr-img" class="share-qr-img" alt="QR code for the share link" />
          <button class="tool-btn" id="share-copy-qr">${icon.copy}Copy QR image</button>
        </div>
      </div>
    </div>
  </div>
  <div class="save-overlay" id="save-overlay" hidden>
    <div class="save-overlay-card">
      <div class="save-overlay-spinner" id="save-overlay-spinner"></div>
      <div class="save-overlay-check" id="save-overlay-check" hidden>${icon.check}</div>
      <p class="save-overlay-message" id="save-overlay-message">Saving…</p>
      <img class="save-overlay-qr" id="save-overlay-qr" alt="QR code for the share link" hidden />
      <button class="tool-btn" id="save-overlay-cancel">Cancel</button>
      <button class="upload-btn" id="save-overlay-close" hidden>Close</button>
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
const treeSearchInput = $<HTMLInputElement>("tree-search-input");
const propsRoot = $("props-root");
const selectionPin = $("selection-pin");
const selectionPinName = $("selection-pin-name");
const selectionPinFrame = $("selection-pin-frame");
const btnFit = $<HTMLButtonElement>("btn-fit");
const btnHome = $<HTMLButtonElement>("btn-home");
const btnSetHome = $<HTMLButtonElement>("btn-set-home");
const btnIsolate = $<HTMLButtonElement>("btn-isolate");
const btnHide = $<HTMLButtonElement>("btn-hide");
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
const saveProjectNameInput = $<HTMLInputElement>("save-project-name");
const saveNamingFields = $("save-naming-fields");
const saveJobInput = $<HTMLInputElement>("save-job");
const saveProductInput = $<HTMLInputElement>("save-product");
const saveZoneInput = $<HTMLInputElement>("save-zone");
const saveDrawingInput = $<HTMLInputElement>("save-drawing");
const saveResultEl = $("save-result");
const saveCancelBtn = $<HTMLButtonElement>("save-cancel");
const saveConfirmBtn = $<HTMLButtonElement>("save-confirm");
const btnShare = $<HTMLButtonElement>("btn-share");
const shareModal = $("share-modal");
const shareClose = $<HTMLButtonElement>("share-close");
const shareLinkInput = $<HTMLInputElement>("share-link-input");
const shareCopyLinkBtn = $<HTMLButtonElement>("share-copy-link");
const shareQrImg = $<HTMLImageElement>("share-qr-img");
const shareCopyQrBtn = $<HTMLButtonElement>("share-copy-qr");

// --- Blocking save overlay: covers the whole page during a Drive save so
// it's unmistakable the site isn't clickable, since people were hitting
// Save multiple times in a row without one. ---
const saveOverlay = $("save-overlay");
const saveOverlaySpinner = $("save-overlay-spinner");
const saveOverlayCheck = $("save-overlay-check");
const saveOverlayMessage = $("save-overlay-message");
const saveOverlayQr = $<HTMLImageElement>("save-overlay-qr");
const saveOverlayCancelBtn = $<HTMLButtonElement>("save-overlay-cancel");
const saveOverlayCloseBtn = $<HTMLButtonElement>("save-overlay-close");
let activeSaveController: AbortController | null = null;

function showSaveOverlaySaving(message: string, controller: AbortController) {
  activeSaveController = controller;
  saveOverlayMessage.textContent = message;
  saveOverlaySpinner.hidden = false;
  saveOverlayCheck.hidden = true;
  saveOverlayQr.hidden = true;
  saveOverlayCancelBtn.hidden = false;
  saveOverlayCloseBtn.hidden = true;
  saveOverlay.hidden = false;
}
function showSaveOverlayDone(html: string, qrDataUrl?: string) {
  activeSaveController = null;
  saveOverlayMessage.innerHTML = html;
  saveOverlaySpinner.hidden = true;
  saveOverlayCheck.hidden = false;
  if (qrDataUrl) {
    saveOverlayQr.src = qrDataUrl;
    saveOverlayQr.hidden = false;
  } else {
    saveOverlayQr.hidden = true;
  }
  saveOverlayCancelBtn.hidden = true;
  saveOverlayCloseBtn.hidden = false;
}
function hideSaveOverlay() {
  activeSaveController = null;
  saveOverlay.hidden = true;
}
saveOverlayCancelBtn.addEventListener("click", () => {
  // Aborts the network request if it's already in flight. The export/
  // encode work that happens before the request is sent isn't
  // interruptible mid-step, but the upload itself never proceeds once
  // aborted, which is what actually matters here.
  activeSaveController?.abort();
  hideSaveOverlay();
});
saveOverlayCloseBtn.addEventListener("click", hideSaveOverlay);
const themeToggleBtn = $<HTMLButtonElement>("theme-toggle");
const toggleTree = $("toggle-tree");
const toggleProps = $("toggle-props");

// On mobile the side panels are full-screen overlays rather than grid
// columns (see the ≤768px rules in app.css), so they should start hidden
// rather than open over the viewport the moment the page loads.
const isMobileLayout = window.matchMedia("(max-width: 768px), (max-height: 500px)").matches;
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

async function updateFilenameDisplay() {
  if (loadedModels.size === 0) {
    filenameEl.textContent = "";
  } else if (loadedModels.size === 1) {
    const { formatModelLabel } = await import("./model-picker");
    filenameEl.textContent = await formatModelLabel([...loadedModels.values()][0]);
  } else {
    filenameEl.textContent = `${loadedModels.size} models`;
  }
}

// Share (external link) only makes sense for a model that's actually on
// Drive — a locally-uploaded file that's never been saved has no stable
// fileId an external viewer could fetch.
function updateShareButtonState() {
  btnShare.disabled = !currentModelId || !modelDriveFileIds.has(currentModelId);
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
      updateShareButtonState();
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
      btnSetHome.disabled = true;
      btnHome.disabled = true;
      dropzone.style.display = "flex";
      renderProperties(propsRoot, null);
      hidePin();
      setLocationLabels([]);
    }
  },
);
tree.clear();
renderProperties(propsRoot, null);
treeSearchInput.addEventListener("input", () => {
  tree.applySearch(treeSearchInput.value);
});

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

// Batch-fetches display labels for the whole spatial tree in two calls
// rather than one per row (a large model can easily have many thousands
// of tree nodes) — a lightweight Name-only fetch for everything, and a
// heavier one with property sets for assembly-level nodes specifically,
// since FrameName lives in a pset and assemblies are far less numerous
// than individual members.
async function fetchTreeNames(
  model: Awaited<ReturnType<typeof viewer.loadIfc>>,
  structure: SpatialTreeItem,
): Promise<TreeNodeNames> {
  const allIds: number[] = [];
  const assemblyIds: number[] = [];
  const walk = (node: SpatialTreeItem) => {
    if (node.localId !== null) {
      allIds.push(node.localId);
      if (node.category === "IFCELEMENTASSEMBLY") assemblyIds.push(node.localId);
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(structure);

  const names = new Map<number, string>();
  const frameNames = new Map<number, string>();

  if (allIds.length) {
    const nameData = await model.getItemsData(allIds, { attributes: ["Name"], attributesDefault: false });
    allIds.forEach((id, i) => {
      const name = (nameData[i]?.Name as { value?: unknown } | undefined)?.value;
      if (typeof name === "string" && name) names.set(id, name);
    });
  }

  if (assemblyIds.length) {
    const assemblyData = await model.getItemsData(assemblyIds, {
      attributesDefault: false,
      relations: { IsDefinedBy: { attributes: true, relations: true } },
    });
    assemblyIds.forEach((id, i) => {
      const data = assemblyData[i];
      if (!data) return;
      const frameName = findPropertyValue(data, "FrameName");
      if (frameName) frameNames.set(id, frameName);
    });
  }

  return { names, frameNames };
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

// --- Location name labels: small floating tags above each blue location
// marker, using the same screen-projection approach as the selection pin
// above, just for several points at once instead of one. ---
interface LocationLabelState {
  point: { x: number; y: number; z: number };
  el: HTMLDivElement;
}
let locationLabels: LocationLabelState[] = [];
let locationLabelLoopActive = false;

function updateLocationLabelPositions() {
  if (!locationLabels.length) {
    locationLabelLoopActive = false;
    return;
  }
  for (const label of locationLabels) {
    const pos = viewer.worldToScreen(label.point);
    if (pos) {
      label.el.style.display = "block";
      label.el.style.left = `${pos.left}px`;
      label.el.style.top = `${pos.top}px`;
    } else {
      label.el.style.display = "none";
    }
  }
  requestAnimationFrame(updateLocationLabelPositions);
}

function setLocationLabels(locations: { name: string; point: { x: number; y: number; z: number } }[]) {
  for (const label of locationLabels) label.el.remove();
  locationLabels = locations.map((loc) => {
    const el = document.createElement("div");
    el.className = "location-label";
    el.textContent = loc.name;
    el.style.display = "none";
    viewportWrap.appendChild(el);
    return { point: loc.point, el };
  });
  if (locationLabels.length && !locationLabelLoopActive) {
    locationLabelLoopActive = true;
    updateLocationLabelPositions();
  }
}

viewer.onSelect = async (info) => {
  currentSelection = info;
  btnIsolate.disabled = !info;
  btnHide.disabled = !info;
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
    updateShareButtonState();
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
    updateShareButtonState();
    btnSave.disabled = true;
    btnSaveLocal.disabled = true;
    tree.clear();
    renderProperties(propsRoot, null);
    hidePin();
    setLocationLabels([]);
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
    // If a home view has been set for this model (or passed via the
    // external link), open straight to that instead of the generic
    // fit-to-model framing.
    const home = isExternalMode ? externalHome : getHomeView(model.modelId);
    if (home) {
      await withTimeout(viewer.goToView(home.point, home.cameraPosition, false), 15000, "goToView");
    } else {
      await withTimeout(viewer.fitView(false), 15000, "fitView");
    }
    console.log(`[handleFile] view ready (${((performance.now() - tFit) / 1000).toFixed(1)}s)`);

    stopLoading();
    btnFit.disabled = false;
    btnShowAll.disabled = false;
    btnPivot.disabled = false;
    btnLocations.disabled = false;
    btnAddModelTree.disabled = false;
    btnBackground.disabled = false;
    btnSetHome.disabled = false;

    loadedModels.set(model.modelId, file.name);
    updateFilenameDisplay();
    currentModelId = model.modelId;
    currentFileName = file.name;
    updateShareButtonState();
    updateHomeButtonState();
    // Show this model's own saved locations right away rather than
    // whatever was left over from a previously loaded model, or nothing
    // at all until the Locations popover happens to get opened.
    const initialLocations = getLocations(model.modelId);
    viewer.setLocationMarkers(initialLocations.map((l) => l.point));
    setLocationLabels(initialLocations);
    btnSaveLocal.disabled = false;
    const config = await getDriveConfig().catch(() => null);
    btnSave.disabled = !config || !isConfigured(config.scriptUrl);

    const tStruct = performance.now();
    const structure = await withTimeout(model.getSpatialStructure(), 15000, "getSpatialStructure");
    console.log(
      `[handleFile] getSpatialStructure() done (${((performance.now() - tStruct) / 1000).toFixed(1)}s)`,
    );
    const tTree = performance.now();
    const { formatModelLabel } = await import("./model-picker");
    const treeNames = await withTimeout(fetchTreeNames(model, structure), 15000, "fetchTreeNames").catch((err) => {
      // Tree still renders fine with the old category-based labels if
      // this fails or a very large model makes it too slow — not worth
      // failing the whole load over a labelling nicety.
      console.error("[handleFile] fetchTreeNames failed, falling back to category labels", err);
      return undefined;
    });
    tree.addModel(model.modelId, await formatModelLabel(file.name), structure, treeNames);
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
    updateShareButtonState();
    setLocationLabels([]);
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
      // Recorded before handleFile() — see the matching comment in
      // loadFromQueryParams for why the order matters here.
      modelDriveFileIds.set(m.name, m.fileId);
      await handleFile(new File([new Uint8Array(bytes)], m.name), "add");
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
    // Recorded before handleFile() — see the matching comment in
    // loadFromQueryParams for why the order matters here.
    modelDriveFileIds.set(name, fileId);
    await handleFile(new File([new Uint8Array(bytes)], name), "add");
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

// --- Share externally modal ---
function closeShareModal() {
  shareModal.hidden = true;
}
shareClose.addEventListener("click", closeShareModal);
shareModal.addEventListener("click", (e) => {
  if (e.target === shareModal) closeShareModal();
});

// Builds the app's own restricted external-viewer link for a Drive-saved
// model (fileId/name/job), rather than Drive's own file URL — shared by
// the Share button and the post-save success screen, which both need to
// point people at the locked-down viewer, not a raw Drive page.
async function buildExternalLink(fileId: string, name: string): Promise<string> {
  const { parseModelFilename } = await import("./model-picker");
  const parsed = parseModelFilename(name);
  const url = new URL(`${import.meta.env.BASE_URL}index.html`, location.origin);
  url.searchParams.set("external", "1");
  url.searchParams.set("fileId", fileId);
  url.searchParams.set("name", name);
  if (parsed) url.searchParams.set("job", parsed.jobNumber);
  // name is the modelId a Home view would be keyed under — include it
  // automatically if one's been set, since there's no reason someone
  // would set a home view and NOT want it carried into the link they're
  // about to share (unlike Locations, which stay opt-in/manual, since
  // sharing all of them isn't necessarily wanted).
  const home = getHomeView(name);
  if (home) url.searchParams.set("home", JSON.stringify(home));
  return url.toString();
}

btnShare.addEventListener("click", async () => {
  if (!currentModelId) return;
  const fileId = modelDriveFileIds.get(currentModelId);
  const name = loadedModels.get(currentModelId);
  if (!fileId || !name) return;

  const linkText = await buildExternalLink(fileId, name);
  shareLinkInput.value = linkText;
  shareQrImg.src = await qrToDataURL(linkText, { width: 400, margin: 1 });
  shareModal.hidden = false;
});

shareCopyLinkBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareLinkInput.value);
    const original = shareCopyLinkBtn.innerHTML;
    shareCopyLinkBtn.textContent = "Copied!";
    setTimeout(() => (shareCopyLinkBtn.innerHTML = original), 1500);
  } catch {
    shareLinkInput.select();
    showError("Couldn't copy automatically — the link is selected, try Ctrl/Cmd+C.");
  }
});

shareCopyQrBtn.addEventListener("click", async () => {
  try {
    const res = await fetch(shareQrImg.src);
    const blob = await res.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    const original = shareCopyQrBtn.innerHTML;
    shareCopyQrBtn.textContent = "Copied!";
    setTimeout(() => (shareCopyQrBtn.innerHTML = original), 1500);
  } catch (err) {
    showError(
      err instanceof Error
        ? `Couldn't copy the QR image: ${err.message} — right-click it and choose "Copy image" instead.`
        : "Couldn't copy the QR image — right-click it and choose \"Copy image\" instead.",
    );
  }
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
  hidePin();
});
btnIsolate.addEventListener("click", () => {
  if (!currentSelection) return;
  viewer.isolate(currentSelection.modelId, [currentSelection.localId]);
});
btnHide.addEventListener("click", () => {
  if (!currentSelection) return;
  viewer.hide(currentSelection.modelId, [currentSelection.localId]);
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

// --- Home view: a single dedicated view per model (distinct from the
// named Locations list below) — "Set Home" captures the current view in
// one click, no naming required; "Home" recalls it. Available in
// external mode too (recall only — Set Home stays internal, since
// external mode can't persist anything), sourced from a ?home= URL
// param there instead of localStorage.
function homeKey(modelId: string): string {
  return `setout-home:${modelId}`;
}
function getHomeView(modelId: string): HomeView | null {
  try {
    const raw = localStorage.getItem(homeKey(modelId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function setHomeView(modelId: string, home: HomeView) {
  try {
    localStorage.setItem(homeKey(modelId), JSON.stringify(home));
  } catch {
    // Storage quota etc. — not worth interrupting the person over.
  }
}
function updateHomeButtonState() {
  if (isExternalMode) {
    btnHome.disabled = !externalHome;
    return;
  }
  btnHome.disabled = !currentModelId || !getHomeView(currentModelId);
}
// A save that renames the file (very common on a model's first save,
// since a freshly-imported filename rarely matches the naming
// convention) would otherwise orphan any Home view or Locations already
// set up before saving — they're keyed by the pre-rename name, so a
// future reopen (which uses the new, saved name as its modelId) would
// never find them. Copying that data across at save time means setting
// up Home/Locations before the very first save just works, rather than
// needing to reopen the file and redo it under the new name.
function migrateLocationAndHomeData(oldModelId: string, newModelId: string) {
  if (oldModelId === newModelId) return;
  try {
    const oldLocations = localStorage.getItem(locationsKey(oldModelId));
    if (oldLocations) localStorage.setItem(locationsKey(newModelId), oldLocations);
    const oldHome = localStorage.getItem(homeKey(oldModelId));
    if (oldHome) localStorage.setItem(homeKey(newModelId), oldHome);
  } catch {
    // Storage quota etc. — not worth interrupting the save over.
  }
}
btnSetHome.addEventListener("click", () => {
  if (!currentModelId) return;
  setHomeView(currentModelId, {
    point: viewer.getCurrentPivot(),
    cameraPosition: viewer.getCurrentCameraPosition(),
  });
  updateHomeButtonState();
});
btnHome.addEventListener("click", () => {
  if (isExternalMode) {
    if (externalHome) viewer.goToView(externalHome.point, externalHome.cameraPosition);
    return;
  }
  if (!currentModelId) return;
  const home = getHomeView(currentModelId);
  if (home) viewer.goToView(home.point, home.cameraPosition);
});

// --- Locations: named views (pivot + camera position), saved per model
// in localStorage. Capturing the camera position alongside the pivot
// (rather than just the pivot alone) means recalling one restores the
// whole framing, not just where the camera happens to orbit around.
interface SavedLocation {
  name: string;
  point: { x: number; y: number; z: number };
  cameraPosition?: { x: number; y: number; z: number };
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
  viewer.setLocationMarkers(locations.map((l) => l.point));
  setLocationLabels(locations);
}
// Older saved locations (from before cameraPosition existed) only have a
// pivot point — recall falls back to the pivot-only jump for those rather
// than restoring a fabricated camera position.
function goToSavedLocation(loc: SavedLocation) {
  if (loc.cameraPosition) viewer.goToView(loc.point, loc.cameraPosition);
  else viewer.goToPivot(loc.point);
}
function renderLocationsList() {
  locationsList.innerHTML = "";
  // External mode shows the locations embedded in the link (no delete —
  // nothing to edit here) instead of this device's local storage, which
  // an external viewer's browser wouldn't have anyway.
  if (isExternalMode) {
    viewer.setLocationMarkers(externalLocations.map((l) => l.point));
    setLocationLabels(externalLocations);
    if (!externalLocations.length) {
      locationsList.innerHTML = `<div class="locations-empty">No locations were included with this link.</div>`;
      return;
    }
    for (const loc of externalLocations) {
      const row = document.createElement("div");
      row.className = "location-row";
      row.innerHTML = `<span class="location-row-name">${loc.name.replace(/</g, "&lt;")}</span>`;
      row.addEventListener("click", () => {
        goToSavedLocation(loc);
        locationsPicker.hidden = true;
      });
      locationsList.appendChild(row);
    }
    return;
  }

  if (!currentModelId) return;
  const locations = getLocations(currentModelId);
  viewer.setLocationMarkers(locations.map((l) => l.point));
  setLocationLabels(locations);
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
      goToSavedLocation(loc);
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
  const cameraPosition = viewer.getCurrentCameraPosition();
  setLocations(currentModelId, [...getLocations(currentModelId), { name, point, cameraPosition }]);
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
btnSave.addEventListener("click", async (e) => {
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
  if (!savePicker.hidden) {
    saveFilenameInput.focus();
    // Pre-fill the project name if one's already known — left blank
    // rather than showing a "Job <number>" fallback, since that's a
    // display convenience, not a real name, and pre-filling it would
    // silently save the fallback as if it were the actual answer.
    saveProjectNameInput.value = "";
    const { parseModelFilename, getKnownProjectName } = await import("./model-picker");
    const parsed = parseModelFilename(saveFilenameInput.value);
    if (parsed) {
      const known = await getKnownProjectName(parsed.jobNumber);
      if (known) saveProjectNameInput.value = known;
    }
  }
});
savePicker.addEventListener("click", (e) => e.stopPropagation());
saveCancelBtn.addEventListener("click", () => {
  savePicker.hidden = true;
});
saveConfirmBtn.addEventListener("click", async () => {
  const { parseModelFilename } = await import("./model-picker");
  const typed = saveFilenameInput.value.trim();
  const projectName = saveProjectNameInput.value.trim();

  // Required regardless of whether the filename itself already matches
  // the naming convention — project name isn't derivable from the
  // filename at all, so even a perfectly-formed name would otherwise
  // leave a brand-new job number showing as "Job <number>" until someone
  // notices and fixes it later via the catalog.
  if (!projectName) {
    showError("Project name is required — the catalog can't show a job under just its number.");
    saveProjectNameInput.focus();
    return;
  }

  if (!saveNamingFields.hidden) {
    // Second click: the naming fields are already showing, meaning the
    // typed name failed the check once already — build a compliant name
    // from the fields instead of re-checking the (still non-matching)
    // typed text.
    const job = saveJobInput.value.trim();
    const product = saveProductInput.value.trim().toUpperCase();
    const zone = saveZoneInput.value.trim().toUpperCase();
    const drawing = saveDrawingInput.value.trim();
    if (!job || !product || !zone || !drawing) {
      showError("Fill in all four fields — Job, Product, Zone, and Drawing # are all required.");
      return;
    }
    // Match the exact shape the catalog's own parser requires, and say
    // specifically which field is the problem rather than a generic
    // failure — the previous version built the name from whatever was
    // typed with no check at all, so a field like "House" (mixed case)
    // silently produced a name that still wouldn't parse, uploading fine
    // but staying invisible in the catalog.
    if (!/^\d{3,6}$/.test(job)) {
      showError("Job # should be 3–6 digits, with no letters or symbols.");
      saveJobInput.focus();
      return;
    }
    if (!/^[A-Z]+$/.test(product)) {
      showError("Product should be letters only, with no digits or symbols.");
      saveProductInput.focus();
      return;
    }
    if (!/^[A-Z0-9]+$/.test(zone)) {
      showError("Zone should be letters and/or numbers only, with no spaces or symbols.");
      saveZoneInput.focus();
      return;
    }
    if (!/^\d+$/.test(drawing)) {
      showError("Drawing # should be digits only, with no letters or symbols.");
      saveDrawingInput.focus();
      return;
    }
    const description = typed.replace(/\.(ifc|frag)$/i, "").replace(/[^a-zA-Z0-9]+/g, "_");
    const finalName = `${job}-${product}-${zone}-${drawing}_${description}.frag`;
    // Belt-and-braces: re-check the name this actually builds against the
    // real parser, rather than trusting the field-level checks above are
    // exhaustive. Saving should never happen without this passing.
    if (!parseModelFilename(finalName)) {
      showError("That still doesn't produce a valid name — double check each field above.");
      return;
    }
    saveFilenameInput.value = finalName;
    saveNamingFields.hidden = true;
    saveToDrive(finalName, projectName);
    return;
  }

  if (!parseModelFilename(typed)) {
    saveNamingFields.hidden = false;
    saveJobInput.focus();
    return;
  }

  saveResultEl.hidden = true;
  saveToDrive(typed, projectName);
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
async function saveModelToDrive(modelId: string, filename: string, signal?: AbortSignal): Promise<string> {
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
    signal,
  });
  const result = await res.json();
  if (!result.success) throw new Error(result.error || "Unknown error");
  loadedModels.set(modelId, filename);
  modelDriveFileIds.set(modelId, result.fileId as string);
  return result.webViewLink as string;
}

async function saveToDrive(filename: string, projectName?: string) {
  if (!currentModelId) return;
  migrateLocationAndHomeData(currentModelId, filename);
  savePicker.hidden = true;
  const controller = new AbortController();
  showSaveOverlaySaving(`Saving ${filename} to Drive…`, controller);
  try {
    await saveModelToDrive(currentModelId, filename, controller.signal);
    if (projectName) {
      const { parseModelFilename, saveProjectNameOverride } = await import("./model-picker");
      const parsed = parseModelFilename(filename);
      if (parsed) {
        try {
          await saveProjectNameOverride(parsed.jobNumber, projectName);
        } catch (err) {
          // The model itself saved fine — a failure here shouldn't look
          // like the whole save failed, just flag it separately.
          showError(
            err instanceof Error
              ? `Model saved, but couldn't save the project name: ${err.message}`
              : "Model saved, but couldn't save the project name.",
          );
        }
      }
    }
    currentFileName = filename;
    updateFilenameDisplay();
    updateShareButtonState();
    const fileId = modelDriveFileIds.get(currentModelId);
    if (fileId) {
      const externalLink = await buildExternalLink(fileId, filename);
      const qrDataUrl = await qrToDataURL(externalLink, { width: 400, margin: 1 });
      showSaveOverlayDone(
        `Saved <strong>${filename.replace(/</g, "&lt;")}</strong>.<br><a href="${externalLink}" target="_blank" rel="noopener">Open share link ↗</a>`,
        qrDataUrl,
      );
    } else {
      // Shouldn't normally happen — a successful save always yields a
      // fileId — but showing the plain success message beats a crash if
      // it somehow doesn't.
      showSaveOverlayDone(`Saved <strong>${filename.replace(/</g, "&lt;")}</strong>.`);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return; // cancelled — overlay's already closed, no error to show
    }
    hideSaveOverlay();
    showError(err instanceof Error ? `Couldn't save to Drive: ${err.message}` : "Couldn't save to Drive.");
  }
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
      // Recorded before handleFile() runs — handleFile() checks this map
      // internally (to enable the Share button) as part of its own
      // success path, so setting it after would be one step too late for
      // that check to see it.
      modelDriveFileIds.set(loadedName, fileId);
      await handleFile(new File([new Uint8Array(bytes)], loadedName), mode);
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

