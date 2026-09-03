import type { SpatialTreeItem } from "@thatopen/fragments";
import { icon } from "./icons";

export interface TreeSelectHandler {
  (modelId: string, localId: number): void;
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

export class SpatialTree {
  private root: HTMLElement;
  private onSelect: TreeSelectHandler;
  private selectedKey: string | null = null;
  private rowsByKey = new Map<string, HTMLElement>();

  constructor(root: HTMLElement, onSelect: TreeSelectHandler) {
    this.root = root;
    this.onSelect = onSelect;
  }

  clear() {
    this.root.innerHTML = `<div class="tree-empty">Load an IFC model to see its spatial structure.</div>`;
    this.rowsByKey.clear();
    this.selectedKey = null;
  }

  render(modelId: string, node: SpatialTreeItem) {
    this.root.innerHTML = "";
    this.rowsByKey.clear();
    const list = document.createElement("div");
    // Skip the synthetic root IFCPROJECT wrapper if it has exactly one child
    // — most models only have one site/building and it reads cleaner flat.
    this.renderNode(list, modelId, node, 0);
    this.root.appendChild(list);
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
