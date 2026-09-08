import type { SpatialTreeItem } from "@thatopen/fragments";
import { icon } from "./icons";

export interface TreeSelectHandler {
  (modelId: string, localId: number): void;
}

export interface TreeRemoveHandler {
  (modelId: string): void;
}

// Per-model lookups used to give tree rows a real label instead of just
// their category — fetched once in a couple of batched calls after the
// spatial structure loads (see fetchTreeNames in main.ts), not per-row,
// since a large model can have many thousands of items.
export interface TreeNodeNames {
  names: Map<number, string>; // localId -> IFC "Name" attribute
  frameNames: Map<number, string>; // localId -> "FrameName" property (assemblies only)
}

// A lightweight parallel structure built alongside the rendered DOM,
// purely so search can walk it directly (already-lowercased labels,
// direct element references) instead of re-deriving labels or querying
// the DOM on every keystroke.
interface SearchNode {
  localId: number | null;
  label: string;
  wrap: HTMLElement;
  caret: HTMLElement;
  childrenEl: HTMLElement | null;
  labelLower: string;
  startOpen: boolean;
  children: SearchNode[];
}

const CATEGORIES_OPEN_BY_DEFAULT = new Set([
  "IFCPROJECT",
  "IFCSITE",
  "IFCBUILDING",
  "IFCBUILDINGSTOREY",
]);

// Assemblies group several individual members under one row — their
// FrameName (when available) is a far more useful label for that group
// than the generic category name every other node falls back to.
const ASSEMBLY_CATEGORY = "IFCELEMENTASSEMBLY";

function shortCategory(category: string | null): string {
  if (!category) return "";
  return category.replace(/^IFC/i, "");
}

function labelFor(node: SpatialTreeItem, names?: TreeNodeNames): string {
  if (names && node.localId !== null) {
    if (node.category === ASSEMBLY_CATEGORY) {
      const frameName = names.frameNames.get(node.localId);
      if (frameName) return frameName;
    }
    const name = names.names.get(node.localId);
    if (name) return name;
  }
  const cat = shortCategory(node.category);
  return cat || "Item";
}

// Depth-first search for the first descendant with an actual selectable
// localId — used so clicking a group (an assembly, a storey, anything
// with children) jumps to/selects something concrete in that group
// rather than the group's own container entity, which usually isn't very
// meaningful to look at on its own.
function firstSelectableDescendant(node: SpatialTreeItem): number | null {
  for (const child of node.children ?? []) {
    if (child.localId !== null) return child.localId;
    const found = firstSelectableDescendant(child);
    if (found !== null) return found;
  }
  return null;
}

// Renders the spatial tree as one collapsible group per loaded model,
// rather than assuming a single active model — each group carries its own
// filename label and a close button to unload just that model.
export class SpatialTree {
  private root: HTMLElement;
  private onSelect: TreeSelectHandler;
  private onRemove: TreeRemoveHandler;
  private selectedKey: string | null = null;
  private rowsByKey = new Map<string, HTMLElement>();
  private groupsByModelId = new Map<string, HTMLElement>();
  private searchRootsByModelId = new Map<string, SearchNode>();
  private currentQuery = "";

  constructor(root: HTMLElement, onSelect: TreeSelectHandler, onRemove: TreeRemoveHandler) {
    this.root = root;
    this.onSelect = onSelect;
    this.onRemove = onRemove;
  }

  clear() {
    this.root.innerHTML = `<div class="tree-empty">Load a model to see its spatial structure.</div>`;
    this.rowsByKey.clear();
    this.groupsByModelId.clear();
    this.searchRootsByModelId.clear();
    this.selectedKey = null;
  }

  get modelCount(): number {
    return this.groupsByModelId.size;
  }

  // Adds a new model group. If this is the first model, clears the empty
  // state first. Does not touch any other already-rendered model group.
  addModel(modelId: string, label: string, node: SpatialTreeItem, names?: TreeNodeNames) {
    if (this.groupsByModelId.size === 0) {
      this.root.innerHTML = "";
    }

    const group = document.createElement("div");
    group.className = "tree-model-group";

    const header = document.createElement("div");
    header.className = "tree-model-header";
    header.innerHTML = `
      <span class="tree-model-icon">${icon.beam}</span>
      <span class="tree-model-label" title="${label.replace(/"/g, "&quot;")}">${label}</span>
      <button class="tree-model-remove" title="Unload this model">${icon.trash}</button>
    `;
    header.querySelector(".tree-model-remove")!.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onRemove(modelId);
    });
    group.appendChild(header);

    const body = document.createElement("div");
    body.className = "tree-model-body";
    const searchRoot = this.renderNode(body, modelId, node, 0, names);
    this.searchRootsByModelId.set(modelId, searchRoot);
    group.appendChild(body);

    this.root.appendChild(group);
    this.groupsByModelId.set(modelId, group);

    // A new model added mid-search should respect whatever's currently
    // typed, rather than showing fully expanded and ignoring the filter.
    if (this.currentQuery) this.applySearch(this.currentQuery);
  }

  // Removes one model's group and prunes its rows from the selection map.
  // Restores the empty state if that was the last model.
  removeModel(modelId: string) {
    const group = this.groupsByModelId.get(modelId);
    if (group) {
      group.remove();
      this.groupsByModelId.delete(modelId);
    }
    for (const key of [...this.rowsByKey.keys()]) {
      if (key.startsWith(`${modelId}:`)) this.rowsByKey.delete(key);
    }
    this.searchRootsByModelId.delete(modelId);
    if (this.selectedKey?.startsWith(`${modelId}:`)) this.selectedKey = null;
    if (this.groupsByModelId.size === 0) this.clear();
  }

  // Same idea as firstSelectableDescendant above, but walking the
  // SearchNode structure instead of the raw SpatialTreeItem tree — used
  // so a search match on a group (an assembly's FrameName, most often)
  // resolves to something with actual visible geometry to select and
  // zoom to, rather than the assembly's own container entity, which
  // usually has none of its own.
  private static firstSelectableSearchDescendant(node: SearchNode): number | null {
    for (const child of node.children) {
      if (child.localId !== null) return child.localId;
      const found = SpatialTree.firstSelectableSearchDescendant(child);
      if (found !== null) return found;
    }
    return null;
  }

  // Flat list of matches (not the in-place panel filter below) — used by
  // the external-viewer's standalone search dropdown, which has no full
  // tree UI to filter in place. Leaf-only (a real, selectable item), same
  // case-insensitive label match as applySearch, capped since a dropdown
  // showing hundreds of results isn't useful to scroll through anyway.
  search(query: string, limit = 30): { modelId: string; localId: number; label: string }[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results: { modelId: string; localId: number; label: string }[] = [];
    const walk = (node: SearchNode, modelId: string) => {
      if (results.length >= limit) return;
      if (node.localId !== null && node.labelLower.includes(q)) {
        // A match on a group (e.g. an assembly's FrameName) resolves to
        // its first real member instead of its own localId, the same
        // way clicking a group row does in the in-panel tree — the
        // assembly entity itself usually has no geometry of its own to
        // select or zoom to.
        const targetId = node.children.length
          ? SpatialTree.firstSelectableSearchDescendant(node) ?? node.localId
          : node.localId;
        results.push({ modelId, localId: targetId, label: node.label });
      }
      for (const child of node.children) {
        if (results.length >= limit) return;
        walk(child, modelId);
      }
    };
    for (const [modelId, root] of this.searchRootsByModelId) {
      walk(root, modelId);
    }
    return results;
  }

  // Filters the tree to rows whose label contains the query (case-
  // insensitive) — matches by whatever's actually displayed, so this
  // covers both individual item names and assembly FrameNames. A group
  // stays visible and expanded if any descendant matches, even if the
  // group's own label doesn't, so a match is never hidden inside a
  // collapsed/filtered-out ancestor. Clearing the query restores the
  // normal default-collapsed view.
  applySearch(query: string) {
    this.currentQuery = query;
    const q = query.trim().toLowerCase();
    for (const root of this.searchRootsByModelId.values()) {
      if (!q) this.resetNode(root);
      else this.filterNode(root, q);
    }
  }

  private resetNode(node: SearchNode) {
    node.wrap.style.display = "";
    node.wrap.querySelector(".tree-row")?.classList.remove("search-match");
    node.caret.classList.toggle("open", node.startOpen);
    if (node.childrenEl) node.childrenEl.style.display = node.startOpen ? "block" : "none";
    for (const child of node.children) this.resetNode(child);
  }

  // Returns true if this node or any descendant matches — the caller uses
  // that to decide whether an ancestor should stay visible too.
  private filterNode(node: SearchNode, q: string): boolean {
    const ownMatch = node.labelLower.includes(q);
    let childMatch = false;
    for (const child of node.children) {
      if (this.filterNode(child, q)) childMatch = true;
    }
    const shouldShow = ownMatch || childMatch;
    node.wrap.style.display = shouldShow ? "" : "none";
    node.wrap.querySelector(".tree-row")?.classList.toggle("search-match", ownMatch);
    if (node.childrenEl) {
      // Expanded whenever a descendant matches, so the match is actually
      // visible rather than hidden inside a collapsed group.
      const open = childMatch;
      node.caret.classList.toggle("open", open);
      node.childrenEl.style.display = open ? "block" : "none";
    }
    return shouldShow;
  }

  private renderNode(
    parentEl: HTMLElement,
    modelId: string,
    node: SpatialTreeItem,
    depth: number,
    names?: TreeNodeNames,
  ): SearchNode {
    const key = `${modelId}:${node.localId}`;
    const hasChildren = !!node.children?.length;

    const wrap = document.createElement("div");
    wrap.className = "tree-node";

    const row = document.createElement("div");
    row.className = "tree-row";
    row.style.paddingLeft = `${10 + depth * 2}px`;

    const startOpen = hasChildren && CATEGORIES_OPEN_BY_DEFAULT.has(node.category ?? "");
    const caret = document.createElement("span");
    caret.className = `tree-caret${hasChildren ? "" : " leaf"}${startOpen ? " open" : ""}`;
    caret.innerHTML = icon.chevron;
    row.appendChild(caret);

    if (node.category) {
      const badge = document.createElement("span");
      badge.className = "tree-category";
      badge.textContent = shortCategory(node.category).slice(0, 10);
      row.appendChild(badge);
    }

    const nodeLabel = labelFor(node, names);
    const labelEl = document.createElement("span");
    labelEl.className = "tree-label";
    labelEl.textContent = nodeLabel;
    row.appendChild(labelEl);

    wrap.appendChild(row);
    this.rowsByKey.set(key, row);

    let childrenEl: HTMLElement | null = null;
    const searchChildren: SearchNode[] = [];
    if (hasChildren) {
      childrenEl = document.createElement("div");
      childrenEl.className = "tree-children";
      childrenEl.style.display = startOpen ? "block" : "none";
      for (const child of node.children!) {
        searchChildren.push(this.renderNode(childrenEl, modelId, child, depth + 1, names));
      }
      wrap.appendChild(childrenEl);
    }

    row.addEventListener("click", (e) => {
      e.stopPropagation();
      if (hasChildren && (e.target === caret || caret.contains(e.target as Node))) {
        const open = caret.classList.toggle("open");
        if (childrenEl) childrenEl.style.display = open ? "block" : "none";
        return;
      }
      // Clicking a group selects the first concrete thing inside it
      // (see firstSelectableDescendant) rather than the group's own
      // container entity — a plain PROJECT/SITE/BUILDING/assembly node
      // usually isn't itself worth looking at, but jumping to its first
      // member gets you looking at the right part of the model.
      if (hasChildren) {
        const targetId = firstSelectableDescendant(node);
        if (targetId !== null) {
          this.select(`${modelId}:${targetId}`);
          this.onSelect(modelId, targetId);
          return;
        }
        const open = caret.classList.toggle("open");
        if (childrenEl) childrenEl.style.display = open ? "block" : "none";
        return;
      }
      if (node.localId !== null) {
        this.select(key);
        this.onSelect(modelId, node.localId);
      }
    });

    parentEl.appendChild(wrap);

    return {
      localId: node.localId,
      label: nodeLabel,
      wrap,
      caret,
      childrenEl,
      labelLower: nodeLabel.toLowerCase(),
      startOpen,
      children: searchChildren,
    };
  }

  select(key: string) {
    if (this.selectedKey) {
      this.rowsByKey.get(this.selectedKey)?.classList.remove("selected");
    }
    this.selectedKey = key;
    const row = this.rowsByKey.get(key);
    row?.classList.add("selected");
    row?.scrollIntoView({ block: "nearest" });
  }
}
