const sliderApi = window.sliderApp || (() => {
    try { return window.parent && window.parent.sliderApp; } catch (error) { return null; }
})();

if (!sliderApi) {
    throw new Error("Slider module bridge is unavailable. Restart the unified application.");
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

function newOutputId(type) {
    return `${type}-${nextOutputId++}`;
}

const state = {
    creative: [],
    detail: [],
    lineupRows: [makeLineup()],
    layoutMode: "horizontal",
    outputFolder: null,
    busy: false,
    detailAllShadow: false,
    outputOrder: [],
    outputOrderCustomized: false
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
        variant4: ""
    };
}

function cloneFile(file, extra = {}) {
    return {
        path: file.path,
        name: file.name,
        extension: file.extension || "",
        size: file.size || 0,
        url: file.url || "",
        ...extra
    };
}

function isPreviewable(entry) {
    return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"].includes(
        String(entry?.extension || "").toLowerCase()
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
    totalCounter.textContent = `${total} / 18`;
    totalCounter.classList.toggle("over", total > 18);
    creativeNavCount.textContent = state.creative.length;
    lineupNavCount.textContent = state.lineupRows.length;
    detailNavCount.textContent = state.detail.length;

    generateBtn.disabled = state.busy || total === 0 || total > 18;
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
    return list.find(item => item && item._outputId === descriptor.id) || null;
}

function registerOutputItem(type, id) {
    if (!id) return;
    if (state.outputOrder.some(item => item.type === type && item.id === id)) return;

    const descriptor = { type, id };

    if (state.outputOrderCustomized) {
        state.outputOrder.push(descriptor);
        return;
    }

    const rank = outputRank(type);
    const insertAt = state.outputOrder.findIndex(item => outputRank(item.type) > rank);

    if (insertAt === -1) {
        state.outputOrder.push(descriptor);
    } else {
        state.outputOrder.splice(insertAt, 0, descriptor);
    }
}

function ensureOutputOrder() {
    state.outputOrder = state.outputOrder.filter(descriptor => Boolean(resolveOutputItem(descriptor)));

    [
        ["creative", state.creative],
        ["lineup", state.lineupRows],
        ["detail", state.detail]
    ].forEach(([type, list]) => {
        list.forEach(item => registerOutputItem(type, item._outputId));
    });
}

function syncTypeOrderInOutputOrder(type) {
    ensureOutputOrder();
    const ids = outputArray(type).map(item => item._outputId);
    let pointer = 0;

    state.outputOrder.forEach(descriptor => {
        if (descriptor.type === type && pointer < ids.length) {
            descriptor.id = ids[pointer++];
        }
    });
}

function serializeOutputOrder() {
    ensureOutputOrder();

    return state.outputOrder.map(descriptor => {
        const list = outputArray(descriptor.type);
        const index = list.findIndex(item => item && item._outputId === descriptor.id);
        return { type: descriptor.type, index };
    }).filter(item => item.index >= 0);
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
        document.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
    });
    row.addEventListener("dragover", event => {
        if (!dragContext || dragContext.type !== type || state.busy) return;
        event.preventDefault();
        row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", event => {
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
    if (state.layoutMode === "paVertical") return "PA Vertical — Item / Item Detail / Color Name";
    return "Four Cut";
}

function updateLayoutHelp() {
    if (!layoutHelp) return;
    if (state.layoutMode === "horizontal") {
        layoutHelp.textContent = "Horizontal: two product/color entries placed side by side.";
    } else if (state.layoutMode === "vertical") {
        layoutHelp.textContent = "Vertical: two product/color entries stacked from top to bottom.";
    } else if (state.layoutMode === "paVertical") {
        layoutHelp.textContent = "PA Vertical: Item 571×280 · Item Detail 571×250 · Color Name 571×50.";
    } else {
        layoutHelp.textContent = "Four Cut: four product/color entries arranged in a 2×2 layout.";
    }
}

function makeSlot(row, rowIndex, slotNumber) {
    const slot = document.createElement("div");
    slot.className = "slot";

    const isPaVertical = state.layoutMode === "paVertical";
    const slotLabel = isPaVertical
        ? (slotNumber === 1 ? "Item" : "Item Detail")
        : `Photo ${slotNumber}`;

    const top = document.createElement("div");
    top.className = "slot-top";
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

    return slot;
}


function makePaVerticalColorField(row) {
    const fieldWrap = document.createElement("div");
    fieldWrap.className = "pa-color-field";

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
        body.className = `lineup-slots ${slots === 4 ? "four" : ""} ${state.layoutMode === "paVertical" ? "pa-vertical" : ""}`.trim();
        for (let slot = 1; slot <= slots; slot++) {
            body.appendChild(makeSlot(row, rowIndex, slot));
        }
        if (state.layoutMode === "paVertical") {
            body.appendChild(makePaVerticalColorField(row));
        }
        card.appendChild(body);
        lineupList.appendChild(card);
    });
}

function renderOverview() {
    overviewList.innerHTML = "";
    const code = productCodeInput.value.trim() || "IMG";

    ensureOutputOrder();

    const describeOutput = descriptor => {
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
                text: `${item.name}${flags.length ? " · " + flags.join(" · ") : ""}`
            };
        }

        const lineupIndex = state.lineupRows.findIndex(row => row._outputId === descriptor.id);
        const parts = [];

        if (state.layoutMode === "paVertical") {
            if (item.photo1) parts.push(`Item — ${item.photo1.name}${item.shadow1 ? " [S]" : ""}`);
            if (item.photo2) parts.push(`Detail — ${item.photo2.name}${item.shadow2 ? " [S]" : ""}`);
            if (String(item.variant1 || "").trim()) parts.push(`Color — ${item.variant1}`);
        } else {
            for (let slot = 1; slot <= activeSlotCount(); slot++) {
                if (item[`photo${slot}`]) {
                    parts.push(
                        `${item[`variant${slot}`] || `Photo ${slot}`} — ${item[`photo${slot}`].name}` +
                        (item[`shadow${slot}`] ? " [S]" : "")
                    );
                }
            }
        }

        const mode = layoutDisplayName();

        return {
            type: `Lineup ${String(lineupIndex + 1).padStart(2, "0")}`,
            text: `${mode}${parts.length ? " · " + parts.join(" / ") : " · empty"}`
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
            document.querySelectorAll(".overview-row.drag-over").forEach(el => el.classList.remove("drag-over"));
        });

        row.addEventListener("dragover", event => {
            if (overviewDragIndex === null || state.busy) return;
            event.preventDefault();
            row.classList.add("drag-over");
        });

        row.addEventListener("dragleave", () => row.classList.remove("drag-over"));

        row.addEventListener("drop", event => {
            event.preventDefault();
            row.classList.remove("drag-over");
            if (overviewDragIndex === null || overviewDragIndex === orderIndex) return;

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
    state.detailAllShadow = state.detail.length > 0 && state.detail.every(item => item.hasShadow);
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
    if (total === 0) errors.push("Add at least one Creative, Lineup, or Detail item.");
    if (total > 18) errors.push(`Maximum is 18 output items. Current total: ${total}.`);

    const slots = activeSlotCount();
    state.lineupRows.forEach((row, index) => {
        if (state.layoutMode === "paVertical") {
            const hasItem = Boolean(row.photo1);
            const hasDetail = Boolean(row.photo2);
            const colorName = String(row.variant1 || "").trim();
            const hasAny = hasItem || hasDetail || Boolean(colorName);

            if (!hasAny) return;
            if (!hasItem) errors.push(`Lineup ${index + 1}: Item image is missing.`);
            if (!hasDetail) errors.push(`Lineup ${index + 1}: Item Detail image is missing.`);
            if (!colorName) errors.push(`Lineup ${index + 1}: Color Name is empty.`);
            if (hasItem && hasDetail && String(row.photo1.path).toLowerCase() === String(row.photo2.path).toLowerCase()) {
                errors.push(`Lineup ${index + 1}: Item and Item Detail are the same file.`);
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
                if (pb && String(pa.path).toLowerCase() === String(pb.path).toLowerCase()) {
                    errors.push(`Lineup ${index + 1}: Photo ${a} and Photo ${b} are the same file.`);
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
        hasShadow: Boolean(entry.hasShadow)
    };
}

function buildJob() {
    return {
        brandName: brandNameInput.value.trim(),
        productCode: productCodeInput.value.trim(),
        outputFolder: state.outputFolder,
        layoutMode: state.layoutMode,
        outputOrder: serializeOutputOrder(),
        creative: state.creative.map(cleanFileForJob),
        detail: state.detail.map(cleanFileForJob),
        lineupRows: state.lineupRows.map(row => ({
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
            variant4: row.variant4 || ""
        }))
    };
}

function setBusy(busy) {
    state.busy = busy;
    document.querySelectorAll("button, input").forEach(control => {
        if (control === generateBtn) return;
        control.disabled = busy;
    });
    renderAll();
}

addCreativeBtn.onclick = async () => {
    const files = await sliderApi.selectImages({});
    if (!files?.length) return;
    files.forEach(file => {
        const entry = cloneFile(file, { _outputId: newOutputId("creative") });
        state.creative.push(entry);
        registerOutputItem("creative", entry._outputId);
    });
    renderAll();
};

addDetailBtn.onclick = async () => {
    const files = await sliderApi.selectImages({});
    if (!files?.length) return;
    files.forEach(file => {
        const entry = cloneFile(file, {
            _outputId: newOutputId("detail"),
            isCut: false,
            hasShadow: state.detailAllShadow
        });
        state.detail.push(entry);
        registerOutputItem("detail", entry._outputId);
    });
    syncAllShadowState();
    renderAll();
};

addCutDetailBtn.onclick = async () => {
    const files = await sliderApi.selectImages({});
    if (!files?.length) return;
    files.forEach(file => {
        const entry = cloneFile(file, {
            _outputId: newOutputId("detail"),
            isCut: true,
            hasShadow: state.detailAllShadow
        });
        state.detail.push(entry);
        registerOutputItem("detail", entry._outputId);
    });
    syncAllShadowState();
    renderAll();
};

addLineupBtn.onclick = () => {
    const row = makeLineup();
    state.lineupRows.push(row);
    registerOutputItem("lineup", row._outputId);
    renderAll();
};

allShadowBtn.onclick = () => {
    state.detailAllShadow = !state.detailAllShadow;
    state.detail.forEach(item => {
        item.hasShadow = state.detailAllShadow;
    });
    renderAll();
};

outputBtn.onclick = async () => {
    const result = await sliderApi.selectOutputFolder();
    if (!result) return;
    state.outputFolder = result.folderPath;
    outputPath.textContent = state.outputFolder;
    outputPath.title = state.outputFolder;
};

clearOutputBtn.onclick = () => {
    state.outputFolder = null;
    outputPath.textContent = "Not selected — PSD will stay open in Photoshop";
    outputPath.title = "";
};

productCodeInput.oninput = renderOverview;

document.querySelectorAll('input[name="layoutMode"]').forEach(radio => {
    radio.onchange = () => {
        if (!radio.checked) return;
        state.layoutMode = radio.value;
        updateLayoutHelp();
        renderAll();
    };
});

document.querySelectorAll(".nav-tab").forEach(button => {
    button.onclick = () => {
        document.querySelectorAll(".nav-tab").forEach(btn => btn.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.remove("active"));
        button.classList.add("active");
        document.getElementById(`tab-${button.dataset.tab}`).classList.add("active");
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

    setBusy(true);
    setStatus("Starting Photoshop", "Preparing the Slider Maker job...", "busy");

    try {
        const result = await sliderApi.generate(buildJob());
        if (!result?.ok) {
            throw new Error(result?.error || "Slider generation failed.");
        }

        const xpText = result.progression?.xpEarned ? `\n\n+${result.progression.xpEarned} EXP` : "";
        const levelText = result.progression?.levelUp ? `\nLEVEL UP! LV. ${result.progression.profile.level.level}` : "";

        if (result.outputPsdPath) {
            setStatus("PSD generated", result.outputPsdPath, "ready");
            alert(`PSD generated successfully.\n\n${result.outputPsdPath}${xpText}${levelText}`);
        } else {
            setStatus(
                "PSD generated",
                "The editable document is open in Photoshop. Save it when ready.",
                "ready"
            );
            alert(`PSD generated successfully and left open in Photoshop.${xpText}${levelText}`);
        }
    } catch (error) {
        setStatus("Generation failed", error?.message || String(error), "error");
        alert(`Generation failed:\n\n${error?.message || error}`);
    } finally {
        setBusy(false);
    }
};

sliderApi.onProgress(progress => {
    if (!progress) return;
    if (progress.status === "error") {
        setStatus("Photoshop error", progress.message, "error");
    } else if (progress.status === "complete") {
        setStatus("Complete", progress.message, "ready");
    } else {
        setStatus("Working", progress.message, "busy");
    }
});

renderAll();
