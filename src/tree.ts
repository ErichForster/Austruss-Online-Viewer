import type { SpatialTreeItem } from "@thatopen/fragments";
import { icon } from "./icons";

export interface TreeSelectHandler {
  (modelId: string, localId: number): void;
}

export interface TreeRemoveHandler {
  (modelId: string): void;
}

const CATEGORIES_OPEN_BY_DEFAULT = new Set([
  "IFCPROJECT",
  "IFCSITE",
  "IFCBUILDING",
  "IFCBUILDINGSTOREY",
]);

function shortCategory(category: string | null): string {
  if (!category) return "";
  return category.replace(/^IFC/i, "");
}

function labelFor(node: SpatialTreeItem): string {
  const cat = shortCategory(node.category);
  return cat || "Item";
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

  constructor(root: HTMLElement, onSelect: TreeSelectHandler, onRemove: TreeRemoveHandler) {
    this.root = root;
    this.onSelect = onSelect;
    this.onRemove = onRemove;
  }

  clear() {
    this.root.innerHTML = `<div class="tree-empty">Load a model to see its spatial structure.</div>`;
    this.rowsByKey.clear();
    this.groupsByModelId.clear();
    this.selectedKey = null;
  }

  get modelCount(): number {
    return this.groupsByModelId.size;
  }

  // Adds a new model group. If this is the first model, clears the empty
  // state first. Does not touch any other already-rendered model group.
  addModel(modelId: string, label: string, node: SpatialTreeItem) {
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
    this.renderNode(body, modelId, node, 0);
    group.appendChild(body);

    this.root.appendChild(group);
    this.groupsByModelId.set(modelId, group);
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
    if (this.selectedKey?.startsWith(`${modelId}:`)) this.selectedKey = null;
    if (this.groupsByModelId.size === 0) this.clear();
  }

  private renderNode(
    parentEl: HTMLElement,
    modelId: string,
    node: SpatialTreeItem,
    depth: number,
  ) {
    const key = `${modelId}:${node.localId}`;
    const hasChildren = !!node.children?.length;

    const wrap = document.createElement("div");
    wrap.className = "tree-node";

    const row = document.createElement("div");
    row.className = "tree-row";
    row.style.paddingLeft = `${10 + depth * 2}px`;

    const caret = document.createElement("span");
    caret.className = `tree-caret${hasChildren ? "" : " leaf"}${
      hasChildren && CATEGORIES_OPEN_BY_DEFAULT.has(node.category ?? "") ? " open" : ""
    }`;
    caret.innerHTML = icon.chevron;
    row.appendChild(caret);

    if (node.category) {
      const badge = document.createElement("span");
      badge.className = "tree-category";
      badge.textContent = shortCategory(node.category).slice(0, 10);
      row.appendChild(badge);
    }

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = labelFor(node);
    row.appendChild(label);

    wrap.appendChild(row);
    this.rowsByKey.set(key, row);

    let childrenEl: HTMLElement | null = null;
    if (hasChildren) {
      childrenEl = document.createElement("div");
      childrenEl.className = "tree-children";
      const startOpen = CATEGORIES_OPEN_BY_DEFAULT.has(node.category ?? "");
      childrenEl.style.display = startOpen ? "block" : "none";
      for (const child of node.children!) {
        this.renderNode(childrenEl, modelId, child, depth + 1);
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
      if (node.localId !== null) {
        this.select(key);
        this.onSelect(modelId, node.localId);
      } else if (hasChildren) {
        const open = caret.classList.toggle("open");
        if (childrenEl) childrenEl.style.display = open ? "block" : "none";
      }
    });

    parentEl.appendChild(wrap);
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
