"use strict";

const api = window.lpFolderApp;
const el = id => document.getElementById(id);
const buttons = ["chooseFolder", "refreshFolder", "resetOrder", "setSingle", "moveUp", "moveDown", "removeImage", "clearList", "generate", "openOutput"];
const state = { folder: null, images: [], originals: [], order: [], singlePath: null, selected: null,
    warnings: [], busy: false, mode: "image", lastOutput: null };
const thumbs = new Map();
const thumbTasks = new Set();
let previewSeq = 0;
let observer = null;

function basename(p) { return String(p || "").split(/[\\/]/).pop(); }
function entry(p) { return state.images.find(img => img.path === p); }
function escapedRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function outputFileName() {
    const raw = el("outputBaseName").value.trim();
    const name = raw.replace(/\.(?:psd|psb|jpe?g)$/i, "");
    if (!name || name.length > 120 || name.startsWith(".") || /[. ]$/.test(name) ||
        /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) {
        return { name: null, error: "Enter a valid output filename (maximum 120 characters, no path or reserved characters)." };
    }
    const family = new RegExp(`^${escapedRegex(name)}(?:_\\d+)?\\.(?:psd|psb|jpe?g)$`, "i");
    const conflict = state.images.find(image => family.test(image.name));
    if (conflict) return { name: null, error: `This name conflicts with original source image ${conflict.name}. Choose a different filename.` };
    return { name, error: null };
}
function note(message, kind = "idle", detail = "") {
    el("statusText").textContent = message;
    el("statusDetail").textContent = detail;
    el("statusDot").className = `status-dot ${kind === "good" ? "good" : kind === "bad" ? "bad" : ""}`;
}
function totalLayout() {
    if (!state.singlePath || !state.order.includes(state.singlePath)) return null;
    let height = 1000;
    for (const p of state.order) {
        if (p === state.singlePath) continue;
        const img = entry(p);
        if (img) height += Math.max(1, Math.round(1000 * img.height / img.width));
    }
    return { height, format: height > 30000 ? "psb" : "psd" };
}
function orderWithSingle(paths, single) {
    return single && paths.includes(single) ? [single, ...paths.filter(p => p !== single)] : paths.slice();
}
function restoreDefaults() {
    state.order = orderWithSingle(state.originals.map(i => i.path), state.initialSingle);
    state.singlePath = state.initialSingle;
    state.selected = state.singlePath || state.order[0] || null;
    updateAll();
}
function refreshControls() {
    const has = state.images.length > 0;
    const selectedIdx = state.order.indexOf(state.selected);
    const current = selectedIdx > -1;
    el("chooseFolder").disabled = state.busy;
    el("refreshFolder").disabled = !state.folder || state.busy;
    el("resetOrder").disabled = !has || state.busy;
    el("setSingle").disabled = !current || state.busy || state.selected === state.singlePath;
    el("moveUp").disabled = !current || state.busy || selectedIdx < (state.singlePath ? 2 : 1) || state.selected === state.singlePath;
    el("moveDown").disabled = !current || state.busy || selectedIdx === state.order.length - 1 || state.selected === state.singlePath || selectedIdx < 0;
    el("removeImage").disabled = !current || state.busy;
    el("clearList").disabled = !state.order.length || state.busy;
    const layout = totalLayout();
    el("generate").disabled = !layout || layout.height > 300000 || !!outputFileName().error || state.busy;
    el("outputBaseName").disabled = !state.folder || state.busy;
    el("generate").textContent = state.busy ? "Generating LP…" : "Generate LP";
    el("openOutput").disabled = !state.lastOutput || state.busy;
}
async function thumbnail(p) {
    if (thumbs.has(p) || thumbTasks.has(p)) return;
    const img = entry(p);
    if (!img) return;
    // Photoshop previews require starting Photoshop; do these when selected.
    if ([".psd", ".psb"].includes(img.extension)) return;
    thumbTasks.add(p);
    try {
        const result = await api.preview({ filePath: p, maxEdge: 220 });
        if (result?.dataUrl) thumbs.set(p, result.dataUrl);
    } catch (_) { /* keep file-type placeholder if preview unavailable */ }
    finally { thumbTasks.delete(p); if (!state.busy) refreshThumbnail(p); }
}
function refreshThumbnail(p) {
    const data = thumbs.get(p);
    if (!data) return;
    const rows = [...el("imageQueue").querySelectorAll(".image-row")];
    const node = rows.find(row => row.dataset.path === p);
    if (!node) return;
    const old = node.querySelector(".thumb-placeholder");
    if (old) {
        const img = document.createElement("img");
        img.className = "thumb"; img.alt = ""; img.src = data;
        old.replaceWith(img);
    } else {
        const image = node.querySelector("img.thumb");
        if (image) image.src = data;
    }
    if (state.mode === "full") renderFull();
}
function renderList() {
    const queue = el("imageQueue");
    queue.replaceChildren();
    if (!state.order.length) {
        const p = document.createElement("p"); p.className = "empty";
        p.textContent = state.folder ? "No images in the current queue. Reset Auto Order to restore them." : "Select a folder to scan images.";
        queue.appendChild(p); return;
    }
    for (const [i, p] of state.order.entries()) {
        const img = entry(p);
        if (!img) continue;
        const row = document.createElement("div");
        row.className = `image-row ${p === state.selected ? "active" : ""}`;
        row.dataset.path = p; row.draggable = !state.busy && p !== state.singlePath;
        row.title = img.name;
        const number = document.createElement("span"); number.className = "number"; number.textContent = String(i + 1).padStart(2, "0");
        let cover;
        if (thumbs.has(p)) { cover = document.createElement("img"); cover.className = "thumb"; cover.src = thumbs.get(p); cover.alt = ""; }
        else { cover = document.createElement("div"); cover.className = "thumb-placeholder"; cover.textContent = img.extension.replace(".", "").toUpperCase().slice(0, 5); }
        const desc = document.createElement("div"); desc.className = "image-desc";
        const filename = document.createElement("strong"); filename.textContent = img.name;
        const dimensions = document.createElement("small"); dimensions.textContent = `${img.width} × ${img.height} · ${img.type}`;
        desc.append(filename, dimensions);
        row.append(number, cover, desc);
        if (p === state.singlePath) {
            const badge = document.createElement("span"); badge.className = "single-pill"; badge.textContent = "SINGLE"; row.appendChild(badge);
        }
        row.addEventListener("click", () => select(p));
        row.addEventListener("dragstart", event => {
            if (state.busy || p === state.singlePath) { event.preventDefault(); return; }
            event.dataTransfer.setData("text/plain", p); event.dataTransfer.effectAllowed = "move";
        });
        row.addEventListener("dragover", event => {
            if (state.busy || p === state.singlePath) return;
            event.preventDefault(); event.dataTransfer.dropEffect = "move";
            row.classList.add("drag-over");
        });
        row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
        row.addEventListener("drop", event => {
            event.preventDefault(); row.classList.remove("drag-over");
            const from = event.dataTransfer.getData("text/plain");
            if (!from || from === state.singlePath || p === state.singlePath || from === p || !state.order.includes(from)) return;
            state.order.splice(state.order.indexOf(from), 1);
            state.order.splice(state.order.indexOf(p), 0, from);
            state.selected = from; updateAll();
        });
        queue.appendChild(row);
    }
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(list => {
        for (const obs of list) if (obs.isIntersecting) {
            const path = obs.target.dataset.path;
            void thumbnail(path);
            observer.unobserve(obs.target);
        }
    }, { root: queue, rootMargin: "150px" });
    queue.querySelectorAll(".image-row").forEach(row => observer.observe(row));
}
function renderSummary() {
    const layout = totalLayout();
    el("fileCount").textContent = `${state.order.length} file(s)`;
    el("folderPath").textContent = state.folder || "No folder selected.";
    el("heightCount").textContent = layout ? `${layout.height.toLocaleString()} px` : "—";
    el("formatCount").textContent = layout ? `${layout.format.toUpperCase()} + JPG` : "PSD + JPG";
    el("sectionCount").textContent = String(state.order.length);
    el("singleStatus").textContent = state.singlePath ? `Single: ${basename(state.singlePath)}` : "Single not assigned";
    const selectedName = state.folder ? outputFileName() : { name: null, error: null };
    const name = selectedName.name;
    el("outputName").textContent = name ? `${name}.${layout?.format || "psd"}` : "—";
    const jpegCount = layout ? Math.ceil(layout.height / 60000) : 1;
    el("outputJpegName").textContent = name ? (jpegCount === 1 ? `${name}.jpg` : `${name}_01.jpg … ${name}_${String(jpegCount).padStart(2, "0")}.jpg`) : "—";
    el("outputBaseName").setAttribute("aria-invalid", selectedName.error ? "true" : "false");
    el("outputNameError").textContent = selectedName.error || "";
    const warnings = [];
    if (state.folder && !state.singlePath) warnings.push("Assign a Single image to unlock LP generation.");
    if (layout && layout.height > 60000) warnings.push("JPEG has a maximum height of 65,535 px. The LP JPEG will be exported in consecutive 60,000 px parts without cropping content.");
    if (layout && layout.format === "psb") warnings.push("The LP exceeds 30,000 px. Photoshop Large Document (PSB) will be used.");
    if (layout && layout.height > 300000) warnings.push("Document exceeds Photoshop's 300,000 px limit. Remove or split sections.");
    warnings.push(...state.warnings.filter(w => state.singlePath ? !/single (?:was not detected|image)/i.test(w) && !/possible Single/.test(w) : true));
    const root = el("warnings"); root.replaceChildren();
    if (!warnings.length) { const p = document.createElement("p"); p.textContent = "Ready for composition. Images stay in this order, with no added vertical gaps."; root.appendChild(p); }
    else for (const w of warnings) { const p = document.createElement("p"); p.className = "warning"; p.textContent = `• ${w}`; root.appendChild(p); }
}
function renderFull() {
    const target = el("fullPreview"); target.replaceChildren();
    for (const p of state.order) {
        const image = entry(p);
        if (!image) continue;
        const part = document.createElement("div");
        part.className = `full-section ${p === state.singlePath ? "single" : ""}`;
        if (p !== state.singlePath) part.style.aspectRatio = `1000 / ${Math.max(1, Math.round(1000 * image.height / image.width))}`;
        if (thumbs.has(p)) {
            const photo = document.createElement("img"); photo.src = thumbs.get(p); photo.alt = image.name;
            part.appendChild(photo);
        } else {
            const message = document.createElement("div"); message.className = "preview-placeholder"; message.textContent = image.name;
            part.appendChild(message);
        }
        target.appendChild(part);
        if (!thumbs.has(p)) void thumbnail(p);
    }
}
async function renderSelectedPreview() {
    const image = entry(state.selected);
    const token = ++previewSeq;
    el("selectedPreview").hidden = true;
    el("previewEmpty").hidden = !image;
    if (!image) { el("previewDesc").textContent = "Select an image to inspect it."; el("selectedLabel").textContent = "No image selected."; return; }
    el("previewDesc").textContent = image.name;
    el("selectedLabel").textContent = `${image.width} × ${image.height} px · ${image.type}`;
    if (state.mode !== "image") return;
    el("previewEmpty").hidden = false;
    el("previewEmpty").querySelector("strong").textContent = "Loading image preview…";
    try {
        const result = await api.preview({ filePath: image.path, maxEdge: 1400 });
        if (token !== previewSeq || state.mode !== "image") return;
        thumbs.set(image.path, result.dataUrl);
        el("selectedPreview").src = result.dataUrl;
        el("selectedPreview").hidden = false;
        el("previewEmpty").hidden = true;
        refreshThumbnail(image.path);
    } catch (error) {
        if (token !== previewSeq) return;
        el("previewEmpty").querySelector("strong").textContent = `Preview unavailable: ${error.message || String(error)}`;
        // Preview errors must not silently remove a valid source from the queue.
    }
}
function changeMode(mode) {
    state.mode = mode;
    el("showImage").classList.toggle("selected", mode === "image");
    el("showFull").classList.toggle("selected", mode === "full");
    el("previewBadge").textContent = mode === "image" ? "Original image · Visual QC" : "Approximate composite · PSD preserves source quality";
    el("fullPreview").hidden = mode !== "full";
    el("selectedPreview").hidden = mode !== "image";
    el("previewEmpty").hidden = true;
    if (mode === "full") { ++previewSeq; renderFull(); }
    else { void renderSelectedPreview(); }
}
function updateAll() {
    renderList(); renderSummary(); refreshControls();
    if (state.mode === "full") renderFull();
    else void renderSelectedPreview();
}
function select(p) { if (state.busy || !state.order.includes(p)) return; state.selected = p; updateAll(); }
function setBusy(busy) { state.busy = busy; refreshControls(); }
async function load(scan) {
    if (!scan) return;
    const previousFolder = state.folder;
    if (previousFolder !== scan.folder || !el("outputBaseName").value.trim()) {
        el("outputBaseName").value = scan.suggestedOutputName || `${basename(scan.folder)}_LP`;
    }
    state.folder = scan.folder;
    state.images = scan.images;
    state.originals = scan.images.slice();
    state.initialSingle = scan.singlePath;
    state.warnings = scan.warnings || [];
    state.lastOutput = null;
    thumbs.clear(); thumbTasks.clear();
    restoreDefaults();
    note(`${state.order.length} image(s) detected. Review the Single and image order.`, "good", basename(state.folder));
}
async function run(action, label) {
    try { await action(); }
    catch (error) { note(`${label}: ${error.message || String(error)}`, "bad"); }
}
el("chooseFolder").addEventListener("click", () => run(async () => {
    const scan = await api.chooseFolder();
    await load(scan);
}, "Folder selection failed"));
el("refreshFolder").addEventListener("click", () => run(async () => {
    const scan = await api.refresh(); await load(scan);
}, "Refresh failed"));
el("resetOrder").addEventListener("click", restoreDefaults);
el("setSingle").addEventListener("click", () => {
    if (!state.selected || !state.order.includes(state.selected)) return;
    state.singlePath = state.selected;
    state.order = orderWithSingle(state.order, state.singlePath);
    updateAll(); note(`Single set to ${basename(state.singlePath)}.`, "good");
});
function moveSelected(direction) {
    const i = state.order.indexOf(state.selected);
    const target = i + direction;
    if (i < 0 || !state.singlePath && target < 0 || state.selected === state.singlePath || target < (state.singlePath ? 1 : 0) || target >= state.order.length) return;
    [state.order[i], state.order[target]] = [state.order[target], state.order[i]];
    updateAll();
}
el("moveUp").addEventListener("click", () => moveSelected(-1));
el("moveDown").addEventListener("click", () => moveSelected(1));
el("removeImage").addEventListener("click", () => {
    const p = state.selected;
    state.order = state.order.filter(v => v !== p);
    if (state.singlePath === p) state.singlePath = null;
    state.selected = state.order[0] || null;
    updateAll(); note(`${basename(p)} removed from the LP queue (source file unchanged).`);
});
el("clearList").addEventListener("click", () => {
    state.order = []; state.singlePath = null; state.selected = null; updateAll();
    note("Queue cleared. Original image files are unchanged. Use Reset Auto Order to restore them.");
});
el("outputBaseName").addEventListener("input", () => { renderSummary(); refreshControls(); });
el("outputBaseName").addEventListener("blur", () => {
    const result = outputFileName();
    if (!result.error && result.name !== el("outputBaseName").value) {
        el("outputBaseName").value = result.name;
        renderSummary(); refreshControls();
    }
});
el("showImage").addEventListener("click", () => changeMode("image"));
el("showFull").addEventListener("click", () => changeMode("full"));
el("generate").addEventListener("click", () => run(async () => {
    const layout = totalLayout();
    if (!layout) throw new Error("Assign a Single and review the image queue first.");
    if (layout.height > 300000) throw new Error("LP exceeds Photoshop's maximum height.");
    const filename = outputFileName();
    if (filename.error) throw new Error(filename.error);
    setBusy(true);
    note("Preparing Photoshop Smart Objects…");
    try {
        const output = await api.generate({ orderedPaths: state.order, singlePath: state.singlePath,
            outputBaseName: filename.name, existingAction: el("existingAction").value });
        state.lastOutput = output.outputPath;
        note(`Saved ${basename(output.outputPath)} + ${output.jpegPaths.length} JPEG${output.jpegPaths.length === 1 ? "" : "s"}.`, "good",
            output.trackingWarning || `${output.layerCount} editable Smart Objects · Same source folder`);
    } finally { setBusy(false); }
}, "LP generation failed"));
el("openOutput").addEventListener("click", () => run(() => api.openOutput(), "Cannot open output"));
api.onProgress(progress => {
    if (state.busy) note(progress.message || progress.stage, progress.stage === "done" ? "good" : "idle",
        progress.total ? `${progress.completed || 0}/${progress.total}` : "");
});
(async () => { try { const prior = await api.getState(); if (prior) await load(prior); } catch (_) {} })();
