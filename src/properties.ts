import type { ItemData } from "@thatopen/fragments";

function shortCategory(category: string): string {
  return category.replace(/^IFC/i, "");
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") {
    // IFC attribute values often arrive as { value, type } — unwrap once more.
    const v = value as { value?: unknown };
    if ("value" in v) return formatValue(v.value);
    return JSON.stringify(value);
  }
  return String(value);
}

function isAttributeLeaf(v: unknown): v is { value: unknown; type?: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    "value" in (v as Record<string, unknown>)
  );
}

export function renderProperties(root: HTMLElement, data: ItemData | null) {
  root.innerHTML = "";

  if (!data) {
    root.innerHTML = `<div class="props-empty">Select an element in the model or the tree to inspect its properties.</div>`;
    return;
  }

  const nameAttr = data.Name as { value?: unknown } | undefined;
  const typeAttr = (data._category ?? data.type) as { value?: unknown } | undefined;
  const name = nameAttr?.value ? String(nameAttr.value) : "Unnamed element";
  const category = typeAttr?.value ? shortCategory(String(typeAttr.value)) : "";

  const header = document.createElement("div");
  header.className = "prop-header";
  header.innerHTML = `
    <p class="name">${escapeHtml(name)}</p>
    <div class="meta">${category ? `<span class="tree-category">${escapeHtml(category.slice(0, 12))}</span>` : ""}</div>
  `;
  root.appendChild(header);

  // Flat attribute group (skip internal/relation keys that aren't simple attrs)
  const skipKeys = new Set(["_category", "_guid", "type"]);
  const flatEntries: [string, unknown][] = [];
  const groupEntries: [string, ItemData[]][] = [];

  for (const [key, value] of Object.entries(data)) {
    if (skipKeys.has(key)) continue;
    if (key === "IsDefinedBy" && Array.isArray(value)) continue; // handled separately below
    if (Array.isArray(value)) {
      if (value.length) groupEntries.push([key, value as ItemData[]]);
      continue;
    }
    if (isAttributeLeaf(value)) {
      flatEntries.push([key, value]);
    }
  }

  if (flatEntries.length) {
    const group = document.createElement("div");
    group.className = "prop-group";
    group.innerHTML = `<p class="prop-group-title">Attributes</p>`;
    for (const [key, value] of flatEntries) {
      const row = document.createElement("div");
      row.className = "prop-row";
      row.innerHTML = `<span class="prop-key">${escapeHtml(key)}</span><span class="prop-val">${escapeHtml(formatValue(value))}</span>`;
      group.appendChild(row);
    }
    root.appendChild(group);
  }

  for (const [relName, items] of groupEntries) {
    const group = document.createElement("div");
    group.className = "prop-group";
    group.innerHTML = `<p class="prop-group-title">${escapeHtml(relName)} (${items.length})</p>`;
    for (const item of items.slice(0, 25)) {
      const itemName = (item.Name as { value?: unknown } | undefined)?.value;
      const itemNominal =
        (item.NominalValue as { value?: unknown } | undefined)?.value ??
        (item.Value as { value?: unknown } | undefined)?.value;
      const row = document.createElement("div");
      row.className = "prop-row";
      row.innerHTML = `<span class="prop-key">${escapeHtml(itemName ? String(itemName) : "—")}</span><span class="prop-val">${escapeHtml(itemNominal !== undefined ? formatValue(itemNominal) : "")}</span>`;
      group.appendChild(row);
    }
    root.appendChild(group);
  }

  // Property sets (IsDefinedBy → HasProperties) get their own titled groups
  const psets = (data.IsDefinedBy as ItemData[] | undefined) ?? [];

  if (!flatEntries.length && !groupEntries.length && !psets.length) {
    const empty = document.createElement("div");
    empty.className = "props-empty";
    empty.textContent = "No attributes were carried over from the IFC for this element.";
    root.appendChild(empty);
  }

  for (const pset of psets) {
    const psetName = (pset.Name as { value?: unknown } | undefined)?.value;
    const props = (pset.HasProperties as ItemData[] | undefined) ?? [];
    if (!props.length) continue;
    const group = document.createElement("div");
    group.className = "prop-group";
    group.innerHTML = `<p class="prop-group-title">${escapeHtml(psetName ? String(psetName) : "Property set")}</p>`;
    for (const prop of props) {
      const propName = (prop.Name as { value?: unknown } | undefined)?.value;
      const propValue =
        (prop.NominalValue as { value?: unknown } | undefined)?.value ??
        (prop.Value as { value?: unknown } | undefined)?.value;
      const row = document.createElement("div");
      row.className = "prop-row";
      row.innerHTML = `<span class="prop-key">${escapeHtml(propName ? String(propName) : "—")}</span><span class="prop-val">${escapeHtml(propValue !== undefined ? formatValue(propValue) : "—")}</span>`;
      group.appendChild(row);
    }
    root.appendChild(group);
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
