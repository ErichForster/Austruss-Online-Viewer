import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBCF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";

export type ViewerWorld = OBC.SimpleWorld<
  OBC.SimpleScene,
  OBC.OrthoPerspectiveCamera,
  OBC.SimpleRenderer
>;

export interface SelectionInfo {
  modelId: string;
  localId: number;
}

export type Theme = "dark" | "light";

// Background + grid colors per theme. Selection highlight stays constant
// across both (see setPivotFromClick / highlighter setup below) — it reads
// fine against either background, and Highlighter's style objects aren't
// guaranteed to propagate live color changes to already-applied materials.
const THEME_SCENE: Record<Theme, { background: string; grid: string }> = {
  dark: { background: "#0e0101", grid: "#2e1414" },
  light: { background: "#f7f5f3", grid: "#ddd5d0" },
};

export class IfcViewer {
  components: OBC.Components;
  world!: ViewerWorld;
  highlighter!: OBCF.Highlighter;

  private ifcLoader!: OBC.IfcLoader;
  private fragments!: OBC.FragmentsManager;
  private container: HTMLElement;
  private currentTheme: Theme = "dark";
  private explicitBackground: string | null = null;

  onSelect: ((info: SelectionInfo | null) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.components = new OBC.Components();
  }

  async init(theme: Theme = "dark") {
    this.currentTheme = theme;
    const worlds = this.components.get(OBC.Worlds);
    this.world = worlds.create<
      OBC.SimpleScene,
      OBC.OrthoPerspectiveCamera,
      OBC.SimpleRenderer
    >();

    this.world.scene = new OBC.SimpleScene(this.components);
    this.world.renderer = new OBC.SimpleRenderer(this.components, this.container);
    this.world.renderer.showLogo = false;
    this.world.camera = new OBC.OrthoPerspectiveCamera(this.components);

    this.components.init();

    const palette = THEME_SCENE[theme];
    this.world.scene.setup({
      backgroundColor: new THREE.Color(palette.background),
      ambientLight: { color: new THREE.Color("#dfe6ee"), intensity: 1.1 },
      directionalLight: {
        color: new THREE.Color("#ffffff"),
        intensity: 1.6,
        position: new THREE.Vector3(30, 40, 20),
      },
    });

    const grids = this.components.get(OBC.Grids);
    const grid = grids.create(this.world);
    grid.config.color = new THREE.Color(palette.grid);

    await this.world.camera.controls.setLookAt(38, 28, 38, 0, 0, 0);

    // --- IFC → Fragments loader ---
    this.ifcLoader = this.components.get(OBC.IfcLoader);
    await this.ifcLoader.setup({
      autoSetWasm: false,
      // Must respect Vite's base path (e.g. "/Austruss-Online-Viewer/" on
      // GitHub Pages), not just "/" — a hardcoded root path here works on
      // localhost (served at "/") but silently 404s once deployed to a
      // repo subpath, which is exactly why this needs BASE_URL rather than
      // a literal string.
      wasm: { path: `${import.meta.env.BASE_URL}vendor/web-ifc/`, absolute: true },
      // `webIfc` is a full replacement, not a merge — COORDINATE_TO_ORIGIN
      // must be included explicitly or the model loads at its real-world
      // survey coordinates, which for structural/civil exports can be far
      // enough from (0,0,0) that WebGL's floating-point precision can't
      // render it at all (looks like nothing loaded).
      webIfc: { COORDINATE_TO_ORIGIN: true, CIRCLE_SEGMENTS: 8 },
    });

    // --- Fragments manager (worker handles parsing off the main thread) ---
    this.fragments = this.components.get(OBC.FragmentsManager);
    const workerUrl = await OBC.FragmentsManager.getWorker();
    await this.fragments.init(workerUrl);

    this.world.camera.controls.addEventListener("rest", () => {
      this.fragments.core.update(true);
    });

    this.fragments.list.onItemSet.add(({ value: model }) => {
      model.useCamera(this.world.camera.three as THREE.PerspectiveCamera);
      this.world.scene.three.add(model.object);
      this.fragments.core.update(true);
    });

    // --- Selection ---
    this.highlighter = this.components.get(OBCF.Highlighter);
    this.highlighter.setup({
      world: this.world,
      selectMaterialDefinition: {
        color: new THREE.Color("#6fa8c9"),
        opacity: 1,
        transparent: false,
        renderedFaces: 0,
      },
    });
    this.highlighter.events.select.onHighlight.add((modelIdMap) => {
      const modelId = Object.keys(modelIdMap)[0];
      const localId = modelId ? [...modelIdMap[modelId]][0] : undefined;
      if (modelId && localId !== undefined) {
        this.onSelect?.({ modelId, localId });
      }
    });
    this.highlighter.events.select.onClear.add(() => this.onSelect?.(null));

    window.addEventListener("resize", () => this.world.renderer?.resize());
  }

  async loadIfc(
    buffer: Uint8Array,
    name: string,
    options?: {
      onProgress?: (progress: number, data: FRAGS.ProgressData) => void;
      // IFC type codes (from "web-ifc"'s exported constants, e.g.
      // WEBIFC.IFCMECHANICALFASTENER) to skip geometry generation for
      // entirely. Useful for cutting down fastener-heavy LGS exports —
      // see README for how to find the right codes for a given file.
      excludeCategories?: number[];
    },
  ): Promise<FRAGS.FragmentsModel> {
    const t0 = performance.now();
    const elapsed = () => `+${((performance.now() - t0) / 1000).toFixed(1)}s`;
    console.log(`[loadIfc] start — ${buffer.byteLength.toLocaleString()} bytes`);

    const model = await this.ifcLoader.load(buffer, false, name, {
      processData: {
        progressCallback: (progress, data) => {
          const count = data.entitiesProcessed
            ? ` (${data.entitiesProcessed.toLocaleString()} entities)`
            : "";
          console.log(
            `[loadIfc] ${elapsed()} — ${data.process}/${data.state} ${Math.round(progress * 100)}%${count}`,
          );
          options?.onProgress?.(progress, data);
        },
      },
      instanceCallback: options?.excludeCategories?.length
        ? (importer) => {
            for (const code of options.excludeCategories!) {
              importer.classes.elements.delete(code);
            }
          }
        : undefined,
    });
    // Everything from here on happens after web-ifc's own progress
    // reporting has finished — this is the part the loading bar currently
    // can't show any real progress for (the Fragments worker building
    // actual 3D meshes from the parsed data).
    console.log(`[loadIfc] ${elapsed()} — ifcLoader.load() resolved (mesh build done)`);

    this.world.scene.three.add(model.object);
    const t1 = performance.now();
    await this.fragments.core.update(true);
    console.log(
      `[loadIfc] ${elapsed()} — fragments.core.update() done (took ${((performance.now() - t1) / 1000).toFixed(1)}s on its own)`,
    );
    return model;
  }

  async fitView(animate = true) {
    const models = [...this.fragments.list.values()];
    if (!models.length) return;
    const box = new THREE.Box3();
    for (const model of models) box.union(model.box);
    if (box.isEmpty()) return;
    await this.world.camera.controls.fitToBox(box, animate, {
      paddingLeft: 0.1,
      paddingRight: 0.1,
      paddingTop: 0.1,
      paddingBottom: 0.1,
    });
    // Fragments streams visible geometry in based on the camera's current
    // view, normally triggered by the controls' "rest" event once a
    // transition settles. A non-animated fit has no transition to settle
    // from, so "rest" never fires — force the update explicitly so the
    // model actually draws for its new view instead of staying empty.
    await this.fragments.core.update(true);
  }

  // Removes every currently loaded model — used before loading a new file
  // so opening a second model replaces the first instead of layering both
  // in the same scene (the rest of the UI — tree, properties, isolate —
  // assumes one active model at a time).
  async clearModels() {
    const ids = [...this.fragments.list.keys()];
    for (const id of ids) {
      await this.fragments.core.disposeModel(id);
    }
    await this.fragments.core.update(true);
  }

  // Applies a theme's background + grid color. Skipped for background if
  // an explicit override is active (see setBackground) — theme switches
  // shouldn't clobber a background the user picked deliberately.
  applyTheme(theme: Theme) {
    this.currentTheme = theme;
    const palette = THEME_SCENE[theme];
    if (!this.explicitBackground) {
      this.world.scene.three.background = new THREE.Color(palette.background);
    }
    const grids = this.components.get(OBC.Grids);
    const grid = grids.list.get(this.world.uuid);
    if (grid) grid.config.color = new THREE.Color(palette.grid);
  }

  // Explicit viewport background override, independent of the light/dark
  // theme toggle — e.g. matching a client's render background, or plain
  // white for screenshots. Pass null to go back to following the theme.
  setBackground(color: string | null) {
    this.explicitBackground = color;
    const resolved = color ?? THEME_SCENE[this.currentTheme].background;
    this.world.scene.three.background = new THREE.Color(resolved);
  }

  get background(): string | null {
    return this.explicitBackground;
  }

  // Raycasts from the current mouse position against the loaded model and
  // re-centers the camera's orbit target there — lets the person pick
  // where "spin around this point" means, instead of always orbiting the
  // scene's origin.
  setPivotFromClick(): boolean {
    const raycasters = this.components.get(OBC.Raycasters);
    const raycaster = raycasters.get(this.world);
    const hit = raycaster.castRayToObjects();
    if (!hit) return false;
    const { x, y, z } = hit.point;
    this.world.camera.controls.setTarget(x, y, z, true);
    return true;
  }

  async loadFragments(
    buffer: Uint8Array,
    name: string,
    onProgress?: (event: FRAGS.LoadProgressEvent) => void,
  ): Promise<FRAGS.FragmentsModel> {
    // Loads a previously-exported .frag buffer directly — this is the
    // compact, pre-converted format from exportModelBuffer() below, so it
    // skips web-ifc parsing entirely (no WASM, no CIRCLE_SEGMENTS pass,
    // no attribute extraction) and loads dramatically faster than the
    // source .ifc for the same model.
    const model = await this.fragments.core.load(buffer, {
      modelId: name,
      onProgress,
    });
    this.world.scene.three.add(model.object);
    await this.fragments.core.update(true);
    return model;
  }

  // Exports a loaded model back to the compact Fragments binary format —
  // compressed by default, meaningfully smaller than the source .ifc for
  // property-heavy models. This is what "Save to Drive" uploads instead
  // of re-sending the original raw IFC bytes.
  async exportModelBuffer(modelId: string, raw = false): Promise<Uint8Array> {
    const model = this.fragments.list.get(modelId);
    if (!model) throw new Error(`No loaded model with id "${modelId}"`);
    const buffer = await model.getBuffer(raw);
    return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  }

  async isolate(modelId: string, localIds: number[]) {
    const model = this.fragments.list.get(modelId);
    if (!model) return;
    await model.resetVisible();
    const all = await model.getItemsOfCategories([/.*/]);
    const allIds = new Set(Object.values(all).flat());
    const keep = new Set(localIds);
    const hide = [...allIds].filter((id) => !keep.has(id));
    await model.setVisible(hide, false);
    await this.fragments.core.update(true);
  }

  async showAll() {
    for (const model of this.fragments.list.values()) {
      await model.resetVisible();
    }
    await this.fragments.core.update(true);
  }

  async getSpatialStructure(modelId: string) {
    const model = this.fragments.list.get(modelId);
    if (!model) return null;
    return model.getSpatialStructure();
  }

  async getItemData(modelId: string, localId: number) {
    const model = this.fragments.list.get(modelId);
    if (!model) return null;
    const [data] = await model.getItemsData([localId], {
      attributesDefault: true,
      relations: {
        IsDefinedBy: { attributes: true, relations: true },
      },
    });
    return data ?? null;
  }

  async selectByLocalId(modelId: string, localId: number) {
    await this.highlighter.highlightByID(
      "select",
      { [modelId]: new Set([localId]) },
      true,
      true,
    );
  }

  get modelIds(): string[] {
    return [...this.fragments.list.keys()];
  }

  get hasModels(): boolean {
    return this.fragments.list.size > 0;
  }
}
