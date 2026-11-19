const sliderApi =
  window.sliderApp ||
  (() => {
    try {
      return window.parent && window.parent.sliderApp;
    } catch (error) {
      return null;
    }
  })();

if (!sliderApi) {
  throw new Error(
    "Slider module bridge is unavailable. Restart the unified application.",
  );
}

const brandNameInput = document.getElementById("brandName");
const productCodeInput = document.getElementById("productCode");
const outputBtn = document.getElementById("outputBtn");
const clearOutputBtn = document.getElementById("clearOutputBtn");
const outputPath = document.getElementById("outputPath");
const totalCounter = document.getElementById("totalCounter");
const versionLabel = document.getElementById("versionLabel");

const creativeList = document.getElementById("creativeList");
const detailList = document.getElementById("detailList");
const lineupList = document.getElementById("lineupList");
const overviewList = document.getElementById("overviewList");

const creativeNavCount = document.getElementById("creativeNavCount");
const lineupNavCount = document.getElementById("lineupNavCount");
const detailNavCount = document.getElementById("detailNavCount");

const addCreativeBtn = document.getElementById("addCreativeBtn");
const addDetailBtn = document.getElementById("addDetailBtn");
const addCutDetailBtn = document.getElementById("addCutDetailBtn");
const addLineupBtn = document.getElementById("addLineupBtn");
const layoutHelp = document.getElementById("layoutHelp");
const allShadowBtn = document.getElementById("allShadowBtn");
const generateBtn = document.getElementById("generateBtn");

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const statusSub = document.getElementById("statusSub");

let nextOutputId = 1;
let dragContext = null;
let overviewDragIndex = null;
let lineupDrag = null; // { kind: "slot" | "pa-variant", fromRow, fromSlot? }
const lineupDnD = window.BrandForgeSliderDnD;

function externalFilesDragged(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}
async function decodeExplorerDrop(event) {
  const browserFiles = Array.from(event.dataTransfer?.files || []);
  const paths = browserFiles.map(file => {
    try { return sliderApi.getPathForFile(file); } catch (_error) { return ""; }
  }).filter(Boolean);
  if (!paths.length) throw new Error("No local image file paths found. Drop files from Windows Explorer.");
  const result = await sliderApi.describeDroppedFiles(paths);
  if (result?.rejected?.length) setStatus("Some files skipped", result.rejected.join("; "), "error");
  if (!result?.files?.length) throw new Error("No supported image files found in the drop.");
  return result.files;
}
function enableFileDrop(element, onFiles) {
  // External file drops must not be mistaken for our internal card/slot drag.
  element.addEventListener("dragover", event => {
    if (!externalFilesDragged(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = state.busy ? "none" : "copy";
    if (!state.busy) element.classList.add("file-drag-over");
  });
  element.addEventListener("dragleave", event => {
    if (!element.contains(event.relatedTarget)) element.classList.remove("file-drag-over");
  });
  element.addEventListener("drop", async event => {
    if (!externalFilesDragged(event)) return;
    event.preventDefault(); event.stopPropagation();
    element.classList.remove("file-drag-over");
    if (state.busy) return;
    try { await onFiles(await decodeExplorerDrop(event)); }
    catch (error) { setStatus("Drop failed", error.message || String(error), "error"); }
  });
}
// Prevent Electron from navigating away when a file is dropped outside a zone.
document.addEventListener("dragover", event => { if (externalFilesDragged(event)) event.preventDefault(); });
document.addEventListener("drop", event => { if (externalFilesDragged(event)) event.preventDefault(); });

function newOutputId(type) {
  return `${type}-${nextOutputId++}`;
}

const state = {
  creative: [],
  detail: [],
  lineupRows: [makeLineup()],
  layoutMode: "horizontal",
  outputFolder: null,
  linkedProjectRoot: null,
  autoLinkedOutput: null,
  busy: false,
  detailAllShadow: false,
  outputOrder: [],
  outputOrderCustomized: false,
};

versionLabel.textContent = `v${sliderApi.version}`;
updateLayoutHelp();

function makeLineup() {
  return {
    _outputId: newOutputId("lineup"),
    photo1: null,
    photo2: null,
    photo3: null,
    photo4: null,
    shadow1: false,
    shadow2: false,
    shadow3: false,
    shadow4: false,
    variant1: "",
    variant2: "",
    variant3: "",
    variant4: "",
  };
}

function cloneFile(file, extra = {}) {
  return {
    path: file.path,
    name: file.name,
    extension: file.extension || "",
    size: file.size || 0,
    url: file.url || "",
    ...extra,
  };
}

function isPreviewable(entry) {
  return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"].includes(
    String(entry?.extension || "").toLowerCase(),
  );
}

function fileThumb(entry, extraClass = "") {
  const wrap = document.createElement("div");
  wrap.className = `thumb ${extraClass}`.trim();

  if (entry && isPreviewable(entry)) {
    const img = document.createElement("img");
    img.src = entry.url;
    img.alt = entry.name;
    img.onerror = () => {
      wrap.innerHTML = "FILE";
    };
    wrap.appendChild(img);
  } else {
    const ext = entry?.extension
      ? entry.extension.replace(/^\./, "").toUpperCase()
      : "FILE";
    wrap.textContent = ext || "FILE";
  }

  return wrap;
}

function totalOutputs() {
  return state.creative.length + state.lineupRows.length + state.detail.length;
}

function setStatus(title, sub, mode = "ready") {
  statusText.textContent = title;
  statusSub.textContent = sub || "";
  statusDot.classList.toggle("busy", mode === "busy");
  statusDot.classList.toggle("error", mode === "error");
}

function renderCounters() {
  const total = totalOutputs();
  totalCounter.textContent = String(total);
  creativeNavCount.textContent = state.creative.length;
  lineupNavCount.textContent = state.lineupRows.length;
  detailNavCount.textContent = state.detail.length;

  generateBtn.disabled = state.busy || total === 0;
}

function emptyState(text) {
  const div = document.createElement("div");
  div.className = "empty-state";
  div.textContent = text;
  return div;
}

function moveArrayItem(array, fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  const [item] = array.splice(fromIndex, 1);
  array.splice(toIndex, 0, item);
}

function outputRank(type) {
  if (type === "creative") return 0;
  if (type === "lineup") return 1;
  if (type === "detail") return 2;
  return 99;
}

function outputArray(type) {
  if (type === "creative") return state.creative;
  if (type === "lineup") return state.lineupRows;
  if (type === "detail") return state.detail;
  return [];
}

function resolveOutputItem(descriptor) {
  if (!descriptor) return null;
  const list = outputArray(descriptor.type);
  return list.find((item) => item && item._outputId === descriptor.id) || null;
}

function registerOutputItem(type, id) {
  if (!id) return;
  if (state.outputOrder.some((item) => item.type === type && item.id === id))
    return;

  const descriptor = { type, id };

  if (state.outputOrderCustomized) {
    state.outputOrder.push(descriptor);
    return;
  }

  const rank = outputRank(type);
  const insertAt = state.outputOrder.findIndex(
    (item) => outputRank(item.type) > rank,
  );

  if (insertAt === -1) {
    state.outputOrder.push(descriptor);
  } else {
    state.outputOrder.splice(insertAt, 0, descriptor);
  }
}

function ensureOutputOrder() {
  state.outputOrder = state.outputOrder.filter((descriptor) =>
    Boolean(resolveOutputItem(descriptor)),
  );

  [
    ["creative", state.creative],
    ["lineup", state.lineupRows],
    ["detail", state.detail],
  ].forEach(([type, list]) => {
    list.forEach((item) => registerOutputItem(type, item._outputId));
  });
}

function syncTypeOrderInOutputOrder(type) {
  ensureOutputOrder();
  const ids = outputArray(type).map((item) => item._outputId);
  let pointer = 0;

  state.outputOrder.forEach((descriptor) => {
    if (descriptor.type === type && pointer < ids.length) {
      descriptor.id = ids[pointer++];
    }
  });
}

function serializeOutputOrder() {
  ensureOutputOrder();

  return state.outputOrder
    .map((descriptor) => {
      const list = outputArray(descriptor.type);
      const index = list.findIndex(
        (item) => item && item._outputId === descriptor.id,
      );
      return { type: descriptor.type, index };
    })
    .filter((item) => item.index >= 0);
}

function makeImageCard(entry, index, type) {
  const row = document.createElement("div");
  row.className = "image-card";
  row.draggable = !state.busy;
  row.dataset.index = index;
  row.dataset.type = type;

  const handle = document.createElement("div");
  handle.className = "drag-handle";
  handle.textContent = "⋮⋮";
  row.appendChild(handle);

  row.appendChild(fileThumb(entry));

  const name = document.createElement("div");
  name.className = "image-name";
  const strong = document.createElement("strong");
  strong.textContent = entry.name;
  strong.title = entry.path;
  const meta = document.createElement("span");

  if (type === "detail") {
    const tags = [];
    tags.push(entry.isCut ? "Cut Image" : "Normal Detail");
    if (entry.hasShadow) tags.push("Shadow");
    meta.textContent = tags.join(" · ");
    if (entry.isCut) meta.classList.add("cut-badge");
  } else {
    meta.textContent = "Full 600×600 fill";
  }

  name.appendChild(strong);
  name.appendChild(meta);
  row.appendChild(name);

  const actions = document.createElement("div");
  actions.className = "card-actions";

  if (type === "detail") {
    const cut = document.createElement("button");
    cut.type = "button";
    cut.className = `mini-btn ${entry.isCut ? "toggle-on" : "toggle-off"}`;
    cut.textContent = entry.isCut ? "CUT ON" : "CUT OFF";
    cut.disabled = state.busy;
    cut.onclick = () => {
      entry.isCut = !entry.isCut;
      renderAll();
    };

    const shadow = document.createElement("button");
    shadow.type = "button";
    shadow.className = `mini-btn ${entry.hasShadow ? "toggle-on" : "toggle-off"}`;
    shadow.textContent = entry.hasShadow ? "SHADOW ON" : "SHADOW OFF";
    shadow.disabled = state.busy;
    shadow.onclick = () => {
      entry.hasShadow = !entry.hasShadow;
      syncAllShadowState();
      renderAll();
    };

    actions.appendChild(cut);
    actions.appendChild(shadow);
  }

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "mini-btn danger";
  remove.textContent = "Remove";
  remove.disabled = state.busy;
  remove.onclick = () => {
    const list = type === "creative" ? state.creative : state.detail;
    list.splice(index, 1);
    syncAllShadowState();
    renderAll();
  };
  actions.appendChild(remove);
  row.appendChild(actions);

  row.addEventListener("dragstart", () => {
    dragContext = { type, index };
    row.classList.add("dragging");
  });
  row.addEventListener("dragend", () => {
    dragContext = null;
    row.classList.remove("dragging");
    document
      .querySelectorAll(".drag-over")
      .forEach((el) => el.classList.remove("drag-over"));
  });
  row.addEventListener("dragover", (event) => {
    if (!dragContext || dragContext.type !== type || state.busy) return;
    event.preventDefault();
    row.classList.add("drag-over");
  });
  row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    row.classList.remove("drag-over");
    if (!dragContext || dragContext.type !== type) return;

    const list = type === "creative" ? state.creative : state.detail;
    moveArrayItem(list, dragContext.index, index);
    syncTypeOrderInOutputOrder(type);
    dragContext = null;
    renderAll();
  });

  return row;
}

function renderSimpleLists() {
  creativeList.innerHTML = "";
  detailList.innerHTML = "";

  if (!state.creative.length) {
    creativeList.appendChild(emptyState("No Creative images yet."));
  } else {
    state.creative.forEach((entry, index) => {
      creativeList.appendChild(makeImageCard(entry, index, "creative"));
    });
  }

  if (!state.detail.length) {
    detailList.appendChild(emptyState("No Detail images yet."));
  } else {
    state.detail.forEach((entry, index) => {
      detailList.appendChild(makeImageCard(entry, index, "detail"));
    });
  }
}

function activeSlotCount() {
  return state.layoutMode === "fourCut" ? 4 : 2;
}

function layoutDisplayName() {
  if (state.layoutMode === "horizontal") return "Horizontal — Side by Side";
  if (state.layoutMode === "vertical") return "Vertical — Stacked";
  if (state.layoutMode === "paVertical")
    return "PA Vertical — Item / Item Detail / Color Name";
  return "Four Cut";
}

function updateLayoutHelp() {
  if (!layoutHelp) return;
  if (state.layoutMode === "horizontal") {
    layoutHelp.textContent =
      "Horizontal: two color variants per group. Drag ONE variant tile to move or swap its position.";
  } else if (state.layoutMode === "vertical") {
    layoutHelp.textContent =
      "Vertical: two stacked color variants. Drag ONE variant tile, never the complete group.";
  } else if (state.layoutMode === "paVertical") {
    layoutHelp.textContent =
      "PA Vertical: Item 571×280 + Item Detail 571×250 + Color Name 571×50. Drag the COLOR handle to move its linked pair.";
  } else {
    layoutHelp.textContent =
      "Four Cut: four color variants in a 2×2 layout. Drag each color tile independently.";
  }
}

function makeSlot(row, rowIndex, slotNumber) {
  const slot = document.createElement("div");
  slot.className = "slot";

  const isPaVertical = state.layoutMode === "paVertical";
  const slotLabel = isPaVertical
    ? slotNumber === 1
      ? "Item"
      : "Item Detail"
    : `Photo ${slotNumber}`;

  const top = document.createElement("div");
  top.className = "slot-top";
  // ONE color variant = ONE draggable tile (photo, caption and shadow together).
  // The surrounding LINEUP 01 / 02 container is never draggable.
  const occupied = Boolean(row[`photo${slotNumber}`] || String(row[`variant${slotNumber}`] || "").trim());
  slot.draggable = !state.busy && !isPaVertical && occupied;
  slot.setAttribute("aria-label", `Line Up color variant ${slotNumber}. Drag this tile to move or swap this color only.`);
  if (!isPaVertical) {
    const colorGrip = document.createElement("div");
    colorGrip.className = "color-drag-handle";
    colorGrip.textContent = "⋮⋮ Drag this color variant";
    colorGrip.title = "Drag the entire color tile, not the Line Up group. Photo, name and shadow move together.";
    slot.appendChild(colorGrip);
  }
  slot.addEventListener("dragstart", event => {
    if (state.busy || isPaVertical || !occupied ||
        event.target.closest?.("button, input, textarea, select, label")) {
      event.preventDefault(); return;
    }
    lineupDrag = {kind: "slot", fromRow: rowIndex, fromSlot: slotNumber};
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `lineup-color-${rowIndex}-${slotNumber}`);
    slot.classList.add("dragging");
  });
  slot.addEventListener("dragend", () => {
    lineupDrag = null;
    slot.classList.remove("dragging");
    document.querySelectorAll(".slot.drag-over").forEach(node => node.classList.remove("drag-over"));
  });
  top.appendChild(fileThumb(row[`photo${slotNumber}`], "slot-thumb"));

  const info = document.createElement("div");
  info.className = "slot-info";
  const label = document.createElement("strong");
  label.textContent = slotLabel;
  const file = document.createElement("div");
  file.className = "slot-file";
  file.textContent = row[`photo${slotNumber}`]?.name || "No file selected";
  file.title = row[`photo${slotNumber}`]?.path || "";
  info.appendChild(label);
  info.appendChild(file);
  top.appendChild(info);

  const shadowLabel = document.createElement("label");
  shadowLabel.className = "shadow-check";
  const shadowCheck = document.createElement("input");
  shadowCheck.type = "checkbox";
  shadowCheck.checked = Boolean(row[`shadow${slotNumber}`]);
  shadowCheck.disabled = state.busy;
  shadowCheck.onchange = () => {
    row[`shadow${slotNumber}`] = shadowCheck.checked;
    renderOverview();
  };
  shadowLabel.appendChild(shadowCheck);
  shadowLabel.appendChild(document.createTextNode("Shadow"));
  top.appendChild(shadowLabel);
  slot.appendChild(top);

  const actions = document.createElement("div");
  actions.className = "slot-actions";
  const choose = document.createElement("button");
  choose.type = "button";
  choose.className = "mini-btn secondary";
  choose.textContent = isPaVertical ? `Choose ${slotLabel}` : "Choose Photo";
  choose.disabled = state.busy;
  choose.onclick = async () => {
    const selected = await sliderApi.selectImage({});
    if (!selected) return;
    row[`photo${slotNumber}`] = cloneFile(selected);
    renderAll();
  };

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "mini-btn ghost";
  clear.textContent = "Clear";
  clear.disabled = state.busy || !row[`photo${slotNumber}`];
  clear.onclick = () => {
    row[`photo${slotNumber}`] = null;
    renderAll();
  };
  actions.appendChild(choose);
  actions.appendChild(clear);
  slot.appendChild(actions);

  // Standard Horizontal / Vertical / Four Cut modes keep the Variant field
  // inside each photo slot. PA Vertical renders its ONE Color Name field
  // separately AFTER Item and Item Detail so the UI order exactly matches:
  // Item -> Item Detail -> Color Name.
  if (!isPaVertical) {
    const variant = document.createElement("input");
    variant.type = "text";
    variant.placeholder = `Variant ${slotNumber}`;
    variant.value = row[`variant${slotNumber}`] || "";
    variant.disabled = state.busy;
    variant.oninput = () => {
      row[`variant${slotNumber}`] = variant.value;
      renderOverview();
    };
    slot.appendChild(variant);
  }

  slot.addEventListener("dragover", event => {
    if (state.busy || !lineupDrag || lineupDrag.kind !== "slot" || isPaVertical) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    slot.classList.add("drag-over");
  });
  slot.addEventListener("dragleave", () => slot.classList.remove("drag-over"));
  slot.addEventListener("drop", event => {
    if (!lineupDrag || lineupDrag.kind !== "slot") return;
    event.preventDefault(); event.stopPropagation(); slot.classList.remove("drag-over");
    if (state.busy) return;
    const {fromRow, fromSlot} = lineupDrag;
    lineupDrag = null;
    if (lineupDnD.moveVariation(state.lineupRows, fromRow, fromSlot, rowIndex, slotNumber, state.layoutMode)) {
      setStatus("Color variant moved", "Only this color's photo, caption and shadow moved; occupied positions are swapped.");
      renderAll();
    }
  });
  enableFileDrop(slot, async files => addLineupFiles(files, rowIndex, slotNumber));
  return slot;
}

function makePaVerticalColorField(row, rowIndex) {
  const fieldWrap = document.createElement("div");
  fieldWrap.className = "pa-color-field";

  // In PA Vertical, ONE color variant necessarily includes Item + Item Detail.
  // Drag via its color label only; never offer drag on an individual paired photo.
  const handle = document.createElement("div");
  handle.className = "pa-color-drag-handle";
  handle.draggable = !state.busy && Boolean(row.photo1 || row.photo2 || String(row.variant1 || "").trim());
  handle.textContent = "⋮⋮ Drag this PA color variant";
  handle.title = "Move this color with its linked Item and Item Detail images";
  handle.addEventListener("dragstart", event => {
    if (state.busy || !handle.draggable) { event.preventDefault(); return; }
    event.stopPropagation();
    lineupDrag = {kind: "pa-variant", fromRow: rowIndex};
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `lineup-pa-color-${rowIndex}`);
    fieldWrap.classList.add("dragging");
  });
  handle.addEventListener("dragend", () => {
    lineupDrag = null;
    fieldWrap.classList.remove("dragging");
    document.querySelectorAll(".pa-color-field.drag-over").forEach(node => node.classList.remove("drag-over"));
  });
  fieldWrap.appendChild(handle);
  fieldWrap.addEventListener("dragover", event => {
    if (state.busy || lineupDrag?.kind !== "pa-variant") return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    fieldWrap.classList.add("drag-over");
  });
  fieldWrap.addEventListener("dragleave", () => fieldWrap.classList.remove("drag-over"));
  fieldWrap.addEventListener("drop", event => {
    if (lineupDrag?.kind !== "pa-variant") return;
    event.preventDefault(); event.stopPropagation();
    fieldWrap.classList.remove("drag-over");
    const fromRow = lineupDrag.fromRow;
    lineupDrag = null;
    if (state.busy) return;
    if (lineupDnD.moveCard(state.lineupRows, fromRow, rowIndex)) {
      syncTypeOrderInOutputOrder("lineup");
      setStatus("PA color variant moved", "Its linked Item + Item Detail and color name stayed together.");
      renderAll();
    }
  });

  const label = document.createElement("strong");
  label.textContent = "Color Name";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Color Name (e.g. ブラック (01))";
  input.value = row.variant1 || "";
  input.disabled = state.busy;
  input.oninput = () => {
    row.variant1 = input.value;
    renderOverview();
  };

  fieldWrap.appendChild(label);
  fieldWrap.appendChild(input);
  return fieldWrap;
}

function renderLineups() {
  lineupList.innerHTML = "";

  if (!state.lineupRows.length) {
    lineupList.appendChild(emptyState("No lineup groups. Add one if needed."));
    return;
  }

  const slots = activeSlotCount();

  state.lineupRows.forEach((row, rowIndex) => {
    const card = document.createElement("div");
    card.className = "lineup-card";

    const head = document.createElement("div");
    head.className = "lineup-card-head";
    // This is a visual group only. Never drag the whole group/card.
    const title = document.createElement("strong");
    title.textContent = `LINEUP ${String(rowIndex + 1).padStart(2, "0")}`;
    head.appendChild(title);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "mini-btn danger";
    remove.textContent = "Remove Lineup";
    remove.disabled = state.busy;
    remove.onclick = () => {
      state.lineupRows.splice(rowIndex, 1);
      renderAll();
    };
    head.appendChild(remove);
    card.appendChild(head);

    const body = document.createElement("div");
    body.className =
      `lineup-slots ${slots === 4 ? "four" : ""} ${state.layoutMode === "paVertical" ? "pa-vertical" : ""}`.trim();
    for (let slot = 1; slot <= slots; slot++) {
      body.appendChild(makeSlot(row, rowIndex, slot));
    }
    if (state.layoutMode === "paVertical") {
      body.appendChild(makePaVerticalColorField(row, rowIndex));
    }
    card.appendChild(body);
    lineupList.appendChild(card);
  });
}

function renderOverview() {
  overviewList.innerHTML = "";
  const code = productCodeInput.value.trim() || "IMG";

  ensureOutputOrder();

  const describeOutput = (descriptor) => {
    const item = resolveOutputItem(descriptor);
    if (!item) return null;

    if (descriptor.type === "creative") {
      return { type: "Creative", text: item.name };
    }

    if (descriptor.type === "detail") {
      const flags = [];
      if (item.isCut) flags.push("CUT");
      if (item.hasShadow) flags.push("SHADOW");
      return {
        type: "Detail",
        text: `${item.name}${flags.length ? " · " + flags.join(" · ") : ""}`,
      };
    }

    const lineupIndex = state.lineupRows.findIndex(
      (row) => row._outputId === descriptor.id,
    );
    const parts = [];

    if (state.layoutMode === "paVertical") {
      if (item.photo1)
        parts.push(`Item — ${item.photo1.name}${item.shadow1 ? " [S]" : ""}`);
      if (item.photo2)
        parts.push(`Detail — ${item.photo2.name}${item.shadow2 ? " [S]" : ""}`);
      if (String(item.variant1 || "").trim())
        parts.push(`Color — ${item.variant1}`);
    } else {
      for (let slot = 1; slot <= activeSlotCount(); slot++) {
        if (item[`photo${slot}`]) {
          parts.push(
            `${item[`variant${slot}`] || `Photo ${slot}`} — ${item[`photo${slot}`].name}` +
              (item[`shadow${slot}`] ? " [S]" : ""),
          );
        }
      }
    }

    const mode = layoutDisplayName();

    return {
      type: `Lineup ${String(lineupIndex + 1).padStart(2, "0")}`,
      text: `${mode}${parts.length ? " · " + parts.join(" / ") : " · empty"}`,
    };
  };

  state.outputOrder.forEach((descriptor, orderIndex) => {
    const description = describeOutput(descriptor);
    if (!description) return;

    const row = document.createElement("div");
    row.className = "overview-row";
    row.draggable = !state.busy;

    const handle = document.createElement("div");
    handle.className = "drag-handle";
    handle.textContent = "⋮⋮";
    handle.title = "Drag to change final PSD order";

    const index = document.createElement("div");
    index.className = "overview-index";
    index.textContent = `${code}_${orderIndex + 1}`;

    const kind = document.createElement("div");
    kind.className = "overview-type";
    kind.textContent = description.type;

    const name = document.createElement("div");
    name.className = "overview-name";
    name.textContent = description.text;

    row.appendChild(handle);
    row.appendChild(index);
    row.appendChild(kind);
    row.appendChild(name);

    row.addEventListener("dragstart", () => {
      if (state.busy) return;
      overviewDragIndex = orderIndex;
      row.classList.add("dragging");
    });

    row.addEventListener("dragend", () => {
      overviewDragIndex = null;
      row.classList.remove("dragging");
      document
        .querySelectorAll(".overview-row.drag-over")
        .forEach((el) => el.classList.remove("drag-over"));
    });

    row.addEventListener("dragover", (event) => {
      if (overviewDragIndex === null || state.busy) return;
      event.preventDefault();
      row.classList.add("drag-over");
    });

    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));

    row.addEventListener("drop", (event) => {
      event.preventDefault();
      row.classList.remove("drag-over");
      if (overviewDragIndex === null || overviewDragIndex === orderIndex)
        return;

      moveArrayItem(state.outputOrder, overviewDragIndex, orderIndex);
      state.outputOrderCustomized = true;
      overviewDragIndex = null;
      renderOverview();
    });

    overviewList.appendChild(row);
  });

  if (!state.outputOrder.length) {
    overviewList.appendChild(emptyState("Nothing will be generated yet."));
  }
}

function syncAllShadowState() {
  state.detailAllShadow =
    state.detail.length > 0 && state.detail.every((item) => item.hasShadow);
}

function renderAllShadowButton() {
  allShadowBtn.textContent = `All Shadow: ${state.detailAllShadow ? "ON" : "OFF"}`;
  allShadowBtn.classList.toggle("toggle-on", state.detailAllShadow);
}

function renderAll() {
  renderCounters();
  renderSimpleLists();
  renderLineups();
  renderOverview();
  renderAllShadowButton();
}

function validateBeforeGenerate() {
  const errors = [];
  const code = productCodeInput.value.trim();

  if (!code) errors.push("Enter a Product Code.");

  const total = totalOutputs();
  if (total === 0)
    errors.push("Add at least one Creative, Lineup, or Detail item.");

  const slots = activeSlotCount();
  state.lineupRows.forEach((row, index) => {
    if (state.layoutMode === "paVertical") {
      const hasItem = Boolean(row.photo1);
      const hasDetail = Boolean(row.photo2);
      const colorName = String(row.variant1 || "").trim();
      const hasAny = hasItem || hasDetail || Boolean(colorName);

      if (!hasAny) return;
      if (!hasItem) errors.push(`Lineup ${index + 1}: Item image is missing.`);
      if (!hasDetail)
        errors.push(`Lineup ${index + 1}: Item Detail image is missing.`);
      if (!colorName) errors.push(`Lineup ${index + 1}: Color Name is empty.`);
      if (
        hasItem &&
        hasDetail &&
        String(row.photo1.path).toLowerCase() ===
          String(row.photo2.path).toLowerCase()
      ) {
        errors.push(
          `Lineup ${index + 1}: Item and Item Detail are the same file.`,
        );
      }
      return;
    }

    for (let slot = 1; slot <= slots; slot++) {
      const hasPhoto = Boolean(row[`photo${slot}`]);
      const hasVariant = Boolean(String(row[`variant${slot}`] || "").trim());
      if (hasPhoto && !hasVariant) {
        errors.push(`Lineup ${index + 1}: Variant ${slot} is empty.`);
      }
      if (!hasPhoto && hasVariant) {
        errors.push(`Lineup ${index + 1}: Photo ${slot} is missing.`);
      }
    }

    for (let a = 1; a <= slots; a++) {
      const pa = row[`photo${a}`];
      if (!pa) continue;
      for (let b = a + 1; b <= slots; b++) {
        const pb = row[`photo${b}`];
        if (
          pb &&
          String(pa.path).toLowerCase() === String(pb.path).toLowerCase()
        ) {
          errors.push(
            `Lineup ${index + 1}: Photo ${a} and Photo ${b} are the same file.`,
          );
        }
      }
    }
  });

  return errors;
}

function cleanFileForJob(entry) {
  if (!entry) return null;
  return {
    path: entry.path,
    name: entry.name,
    outputId: entry._outputId || null,
    isCut: Boolean(entry.isCut),
    hasShadow: Boolean(entry.hasShadow),
  };
}

function buildJob() {
  return {
    brandName: brandNameInput.value.trim(),
    productCode: productCodeInput.value.trim(),
    outputFolder: state.outputFolder,
    projectRoot: state.linkedProjectRoot,
    layoutMode: state.layoutMode,
    outputOrder: serializeOutputOrder(),
    creative: state.creative.map(cleanFileForJob),
    detail: state.detail.map(cleanFileForJob),
    lineupRows: state.lineupRows.map((row) => ({
      outputId: row._outputId || null,
      photo1: cleanFileForJob(row.photo1),
      photo2: cleanFileForJob(row.photo2),
      photo3: cleanFileForJob(row.photo3),
      photo4: cleanFileForJob(row.photo4),
      shadow1: Boolean(row.shadow1),
      shadow2: Boolean(row.shadow2),
      shadow3: Boolean(row.shadow3),
      shadow4: Boolean(row.shadow4),
      variant1: row.variant1 || "",
      variant2: row.variant2 || "",
      variant3: row.variant3 || "",
      variant4: row.variant4 || "",
    })),
  };
}

function setBusy(busy) {
  state.busy = busy;
  document.querySelectorAll("button, input").forEach((control) => {
    if (control === generateBtn) return;
    control.disabled = busy;
  });
  renderAll();
  document.dispatchEvent(
    new CustomEvent("brandforge:project-busy", { detail: { busy } }),
  );
}

function addCreativeFiles(files) {
  files.forEach(file => {
    const entry = cloneFile(file, {_outputId: newOutputId("creative")});
    state.creative.push(entry);
    registerOutputItem("creative", entry._outputId);
  });
  renderAll();
  setStatus("Creative files added", `${files.length} image(s) imported. Drag cards to reorder.`);
}
function addDetailFiles(files, isCut = false) {
  files.forEach(file => {
    const entry = cloneFile(file, {_outputId: newOutputId("detail"),
      isCut, hasShadow: state.detailAllShadow});
    state.detail.push(entry);
    registerOutputItem("detail", entry._outputId);
  });
  syncAllShadowState(); renderAll();
  setStatus("Detail files added", `${files.length} image(s) imported. Drag cards to reorder.`);
}
function addLineupFiles(files, rowIndex = null, slotNumber = 1) {
  if (!files.length) return;
  // Generic list/zone drops APPEND in order (rather than silently inserting
  // ahead of existing images in an earlier empty slot).
  if (rowIndex === null) {
    const slots = activeSlotCount();
    let last = -1;
    state.lineupRows.forEach((row, ri) => {
      for (let n = 1; n <= slots; n++) {
        if (row[`photo${n}`] || String(row[`variant${n}`] || "").trim()) last = ri * slots + n - 1;
      }
    });
    rowIndex = Math.floor((last + 1) / slots);
    slotNumber = (last + 1) % slots + 1;
  }
  // Single-image drop on a filled slot requests explicit replacement;
  // never silently discard the existing variant/photo.
  const row = state.lineupRows[rowIndex];
  if (files.length === 1 && row && row[`photo${slotNumber}`]) {
    const current = row[`photo${slotNumber}`];
    if (!window.confirm(`Replace ${current.name} with ${files[0].name}? The existing color caption will be cleared.`)) return;
    row[`photo${slotNumber}`] = cloneFile(files[0]);
    row[`variant${slotNumber}`] = "";
    row[`shadow${slotNumber}`] = false;
    setStatus("Line Up photo replaced", `Enter the color name for ${files[0].name}.`);
    renderAll(); return;
  }
  const count = lineupDnD.insertDroppedPhotos(state.lineupRows, files.map(file => cloneFile(file)), {
    layoutMode: state.layoutMode, startRow: rowIndex, startSlot: slotNumber, makeRow: makeLineup
  });
  ensureOutputOrder(); renderAll();
  setStatus("Line Up photos added", `${count} image(s) placed in source order. Enter color names before Slider PSD generation.`);
}
// Three clearly marked file-drop zones, plus drops anywhere in their lists.
enableFileDrop(document.getElementById("creativeDropZone"), addCreativeFiles);
enableFileDrop(creativeList, addCreativeFiles);
enableFileDrop(document.getElementById("detailDropZone"), files => addDetailFiles(files));
enableFileDrop(detailList, files => addDetailFiles(files));
enableFileDrop(document.getElementById("lineupDropZone"), files => addLineupFiles(files));
enableFileDrop(lineupList, files => addLineupFiles(files));
// Sidebar tabs are also valid drop targets, even when that section isn't open.
for (const [tab, handler] of [
  ["creative", addCreativeFiles], ["detail", files => addDetailFiles(files)],
  ["lineup", files => addLineupFiles(files)]
]) {
  const button = document.querySelector(`.nav-tab[data-tab="${tab}"]`);
  enableFileDrop(button, files => { handler(files); button.click(); });
}

addCreativeBtn.onclick = async () => {
  const files = await sliderApi.selectImages({});
  if (!files?.length) return;
  addCreativeFiles(files);
};

clearListBtn.onclick = () => {
  state.creative = [];
  renderAll();
};
clearLineupBtn.onclick = () => {
  state.lineupRows = [];
  renderAll();
};

addDetailBtn.onclick = async () => {
  const files = await sliderApi.selectImages({});
  if (!files?.length) return;
  addDetailFiles(files, false);
};
clearDetailBtn.onclick = () => {
  state.detail = [];
  syncAllShadowState();
  renderAll();
};

addCutDetailBtn.onclick = async () => {
  const files = await sliderApi.selectImages({});
  if (!files?.length) return;
  addDetailFiles(files, true);
};

addLineupBtn.onclick = () => {
  const row = makeLineup();
  state.lineupRows.push(row);
  registerOutputItem("lineup", row._outputId);
  renderAll();
};

allShadowBtn.onclick = () => {
  state.detailAllShadow = !state.detailAllShadow;
  state.detail.forEach((item) => {
    item.hasShadow = state.detailAllShadow;
  });
  renderAll();
};

outputBtn.onclick = async () => {
  const result = await sliderApi.selectOutputFolder();
  if (!result) return;
  state.outputFolder = result.folderPath;
  state.linkedProjectRoot = null;
  state.autoLinkedOutput = null;
  document.dispatchEvent(new Event("brandforge:project-manual"));
  outputPath.textContent = state.outputFolder;
  outputPath.title = state.outputFolder;
};

clearOutputBtn.onclick = () => {
  state.outputFolder = null;
  state.linkedProjectRoot = null;
  state.autoLinkedOutput = null;
  document.dispatchEvent(new Event("brandforge:project-manual"));
  outputPath.textContent =
    "Not selected — choose a folder or link your G: brand project";
  outputPath.title = "";
};

productCodeInput.oninput = renderOverview;

document.querySelectorAll('input[name="layoutMode"]').forEach((radio) => {
  radio.onchange = () => {
    if (!radio.checked) return;
    state.layoutMode = radio.value;
    updateLayoutHelp();
    renderAll();
  };
});

document.querySelectorAll(".nav-tab").forEach((button) => {
  button.onclick = () => {
    document
      .querySelectorAll(".nav-tab")
      .forEach((btn) => btn.classList.remove("active"));
    document
      .querySelectorAll(".tab-panel")
      .forEach((panel) => panel.classList.remove("active"));
    button.classList.add("active");
    document
      .getElementById(`tab-${button.dataset.tab}`)
      .classList.add("active");
    if (button.dataset.tab === "overview") renderOverview();
  };
});

generateBtn.onclick = async () => {
  if (state.busy) return;

  const errors = validateBeforeGenerate();
  if (errors.length) {
    setStatus("Cannot generate", errors.join(" • "), "error");
    alert(errors.join("\n"));
    return;
  }

  // Output is mandatory so the PSD left open in Photoshop is the ACTUAL
  // published file rather than a temporary/unsaved document.
  if (!state.outputFolder) {
    try {
      const selected = await sliderApi.selectOutputFolder();
      if (!selected?.folderPath) {
        setStatus(
          "Output folder required",
          "Choose where to save the Slider PSD before generating.",
          "error",
        );
        return;
      }
      state.outputFolder = selected.folderPath;
      state.linkedProjectRoot = null;
      state.autoLinkedOutput = null;
      document.dispatchEvent(new Event("brandforge:project-manual"));
      outputPath.textContent = state.outputFolder;
      outputPath.title = state.outputFolder;
    } catch (error) {
      setStatus(
        "Output folder required",
        error.message || String(error),
        "error",
      );
      return;
    }
  }

  setBusy(true);
  setStatus("Starting Photoshop", "Preparing the Slider Maker job...", "busy");

  try {
    const result = await sliderApi.generate(buildJob());
    if (!result?.ok) {
      throw new Error(result?.error || "Slider generation failed.");
    }

    const xpText = result.progression?.xpEarned
      ? `\n\n+${result.progression.xpEarned} EXP`
      : "";
    const levelText = result.progression?.levelUp
      ? `\nLEVEL UP! LV. ${result.progression.profile.level.level}`
      : "";

    if (result.outputPsdPath) {
      const openMessage =
        result.openWarning ||
        `The saved PSD is now open in Photoshop: ${result.outputPsdPath}`;
      setStatus(
        result.openWarning
          ? "PSD saved - open warning"
          : "PSD generated and opened",
        openMessage,
        "ready",
      );
      alert(
        `PSD generated successfully.\n\n${result.outputPsdPath}${result.openWarning ? `\n\n${result.openWarning}` : "\n\nThe saved PSD is now open in Photoshop."}${xpText}${levelText}`,
      );
    } else {
      setStatus(
        "PSD generated",
        "The editable document is open in Photoshop. Save it when ready.",
        "ready",
      );
      alert(
        `PSD generated successfully and left open in Photoshop.${xpText}${levelText}`,
      );
    }
  } catch (error) {
    setStatus("Generation failed", error?.message || String(error), "error");
    alert(`Generation failed:\n\n${error?.message || error}`);
  } finally {
    setBusy(false);
  }
};

sliderApi.onProgress((progress) => {
  if (!progress) return;
  if (progress.status === "error") {
    setStatus("Photoshop error", progress.message, "error");
  } else if (progress.status === "complete") {
    setStatus("Complete", progress.message, "ready");
  } else {
    setStatus("Working", progress.message, "busy");
  }
});

document.addEventListener("brandforge:project-linked", (event) => {
  const project = event.detail?.project;
  const folder = project?.roles?.slider?.folderPath || null;
  state.linkedProjectRoot = folder ? project.root : null;
  state.autoLinkedOutput = folder;
  if (folder) {
    state.outputFolder = folder;
    outputPath.textContent = folder;
    outputPath.title = folder;
    setStatus(
      "Google Drive project linked",
      `Slider PSD will save to ${folder}`,
      "ready",
    );
  }
});
document.addEventListener("brandforge:project-unlinked", () => {
  if (state.autoLinkedOutput && state.outputFolder === state.autoLinkedOutput) {
    state.outputFolder = null;
    outputPath.textContent =
      "Not selected — choose a folder or link your G: brand project";
    outputPath.title = "";
  }
  state.linkedProjectRoot = null;
  state.autoLinkedOutput = null;
});
window.BrandForgeProjectLink?.mount(
  document.getElementById("sliderBrandProject"),
);

renderAll();
