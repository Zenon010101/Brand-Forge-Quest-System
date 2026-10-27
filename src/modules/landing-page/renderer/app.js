"use strict";

const api = window.landingPageApp;
const ui = Object.fromEntries([
    "addSingle","clearSingle","singleInfo","addScreenshots","queueList","queueCount",
    "clearList","productCode","outputFolder","chooseOutput","tesseractPath","fontLatin","fontJapanese",
    "overwrite","analyze","generate","previewDesc","previewStage","previewEmpty","previewContent",
    "previewImage","previewDimensions","previewMode","analysisOverlay","showText","showImages",
    "analysisStats","heightValue","textValue","imageValue","fallbackValue","warnings",
    "statusText","statusCount","statusDot","dragOverlay","dropTarget","queueDropZone",
    "viewFull","viewDetail","detailPrev","detailNext"
].map(id => [id, document.getElementById(id)]));

const state = { single: null, files: [], selected: null, analysis: null, outputFolder: null, busy: false, previewCounter: 0, previewMode: "full", detailY: 0, detailHeight: 1800, lastPreviewHeight: 0 };
const toName = value => String(value || "").split(/[\\/]/).pop();
const uniqueKey = value => String(value).toLowerCase();

function status(message, tone = "") {
    ui.statusText.textContent = String(message);
    ui.statusDot.className = `dot ${tone}`.trim();
}
function displayError(error) { status(error?.message || String(error), "error"); }
function clearAnalysis() {
    if (state.analysis && !state.busy) void api.discard().catch(() => {});
    state.analysis = null;
    updateAnalysis();
}
function refreshControls() {
    const ready = state.files.length > 0;
    ui.queueCount.textContent = `${state.files.length} file${state.files.length === 1 ? "" : "s"}`;
    ui.addSingle.disabled = state.busy;
    ui.clearSingle.disabled = state.busy || !state.single;
    ui.addScreenshots.disabled = state.busy;
    ui.clearList.disabled = state.busy || !ready;
    ui.chooseOutput.disabled = state.busy;
    ui.analyze.disabled = state.busy || !ready;
    ui.generate.disabled = state.busy || !state.analysis || !state.outputFolder || !ui.productCode.value.trim();
    ui.statusCount.textContent = state.analysis ? `${state.analysis.width} × ${state.analysis.height.toLocaleString()} px · ${state.analysis.format.toUpperCase()}` : `${state.files.length} screenshots · 1000 px width`;
    ui.singleInfo.classList.toggle("loaded", !!state.single);
    ui.singleInfo.replaceChildren();
    const title = document.createElement("strong");
    const desc = document.createElement("small");
    title.textContent = state.single ? toName(state.single) : "1000 × 1000 area reserved";
    desc.textContent = state.single ? "Single placed at top · proportional scaling · no distortion" : "No Single selected. Editable reserved space will still be created.";
    ui.singleInfo.append(title, desc);
}
function renderQueue() {
    const fragment = document.createDocumentFragment();
    state.files.forEach((filePath, index) => {
        const row = document.createElement("div"); row.className = `queue-row ${state.selected === filePath ? "active" : ""}`;
        row.draggable = !state.busy;
        row.dataset.path = filePath;
        const order = document.createElement("span"); order.className = "queue-order"; order.textContent = String(index + 1).padStart(2,"0");
        const name = document.createElement("div"); name.className = "queue-name"; name.title = filePath;
        const filename = document.createElement("span"); filename.textContent = toName(filePath);
        const sub = document.createElement("small");
        const part = state.analysis?.parts?.[index];
        sub.textContent = part ? `Y ${part.y.toLocaleString()} · ${part.height.toLocaleString()} px` : "Original screenshot";
        name.append(filename, sub);
        name.addEventListener("click", () => selectScreenshot(filePath));
        const actions = document.createElement("div"); actions.className = "queue-buttons";
        for (const [label, action, disabled] of [
            ["↑", () => move(index, -1), index === 0],
            ["↓", () => move(index, 1), index === state.files.length - 1],
            ["×", () => removeAt(index), false]
        ]) {
            const button = document.createElement("button"); button.textContent = label; button.type = "button";
            button.title = label === "×" ? "Remove screenshot" : label === "↑" ? "Move Up" : "Move Down";
            button.disabled = state.busy || disabled; button.addEventListener("click", action);
            actions.appendChild(button);
        }
        row.addEventListener("dragstart", event => {
            if (state.busy) { event.preventDefault(); return; }
            event.dataTransfer.setData("text/plain", String(index));
            event.dataTransfer.effectAllowed = "move";
            row.classList.add("dragged");
        });
        row.addEventListener("dragend", () => row.classList.remove("dragged"));
        row.addEventListener("dragover", event => { if (event.dataTransfer.types.includes("text/plain")) event.preventDefault(); });
        row.addEventListener("drop", event => {
            if (state.busy) return;
            const from = Number(event.dataTransfer.getData("text/plain"));
            if (!Number.isInteger(from) || from < 0 || from >= state.files.length || from === index) return;
            event.preventDefault();
            const [item] = state.files.splice(from, 1);
            state.files.splice(index, 0, item); clearAnalysis(); renderQueue();
            status("Screenshot order updated. Analyze again to refresh PSD structure.");
        });
        row.append(order, name, actions); fragment.appendChild(row);
    });
    ui.queueList.replaceChildren(fragment);
    refreshControls();
}
function move(index, delta) {
    if (state.busy) return;
    const other = index + delta;
    if (other < 0 || other >= state.files.length) return;
    [state.files[index], state.files[other]] = [state.files[other], state.files[index]];
    clearAnalysis(); renderQueue(); status("Screenshot order updated.");
}
function removeAt(index) {
    if (state.busy) return;
    const [removed] = state.files.splice(index, 1);
    if (removed === state.selected) state.selected = state.files[Math.min(index,state.files.length-1)] || null;
    clearAnalysis(); renderQueue(); void showPreview();
}
function addPaths(paths) {
    if (state.busy) return;
    const accepted = [];
    const used = new Set(state.files.map(uniqueKey));
    for (const file of paths) {
        if (!file || used.has(uniqueKey(file)) || uniqueKey(file) === uniqueKey(state.single)) continue;
        if (!/\.(png|jpg|jpeg|webp|tif|tiff|bmp|gif|avif)$/i.test(file)) continue;
        used.add(uniqueKey(file)); accepted.push(file);
    }
    if (!accepted.length) { status("No new supported screenshots were added."); return; }
    if (state.files.length + accepted.length > 75) { status("Maximum 75 screenshot parts.", "error"); return; }
    state.files.push(...accepted);
    if (!state.selected) state.selected = accepted[0];
    clearAnalysis(); renderQueue(); void showPreview();
    status(`${accepted.length} screenshot(s) added. Check their order, then Analyze.`);
}
function partForSelection() {
    const index = state.files.findIndex(file => file === state.selected);
    return index < 0 ? null : state.analysis?.parts?.[index] || null;
}
async function selectScreenshot(filePath) {
    state.selected = filePath;
    state.detailY = 0; state.previewMode = "full";
    renderQueue(); await showPreview();
}
function renderOverlays(part, preview = null) {
    ui.analysisOverlay.replaceChildren();
    if (!part) return;
    const clipTop = preview?.mode === "detail" ? (preview.top || 0) : 0;
    const visibleHeight = preview?.mode === "detail" ? preview.height : part.height;
    const marker = (type, rect, tooltip) => {
        const top = rect.top ?? rect.y;
        if (top + rect.height <= clipTop || top >= clipTop + visibleHeight) return;
        const element = document.createElement("div");
        element.className = `overlay-box ${type}`;
        element.style.left = `${100 * (rect.left ?? rect.x) / 1000}%`;
        element.style.top = `${100 * (top - clipTop) / visibleHeight}%`;
        element.style.width = `${100 * rect.width / 1000}%`;
        element.style.height = `${100 * rect.height / visibleHeight}%`;
        element.title = tooltip;
        ui.analysisOverlay.appendChild(element);
    };
    if (ui.showImages.checked) for (const image of part.images) marker("image", image, `${image.name} · raster image block`);
    if (ui.showText.checked) for (const block of part.text) marker(block.editable ? "text" : "review", block,
        `${block.editable ? "Editable text" : "Hidden review text (raster retained)"}: ${block.text}`);
}
async function showPreview() {
    const request = ++state.previewCounter;
    const file = state.selected;
    ui.previewEmpty.hidden = !!file;
    ui.previewContent.hidden = !file;
    if (!file) { ui.previewDesc.textContent = "Select a screenshot in the queue to inspect it."; return; }
    ui.previewDesc.textContent = toName(file);
    ui.previewMode.textContent = state.analysis ? "Original + analysis overlays" : "Original screenshot";
    const part = partForSelection();
    ui.viewFull.classList.toggle("light", state.previewMode === "full");
    ui.viewDetail.classList.toggle("light", state.previewMode === "detail");
    ui.detailPrev.disabled = state.previewMode !== "detail" || state.detailY <= 0;
    ui.detailNext.disabled = state.previewMode !== "detail" || state.detailY + state.detailHeight >= (part?.height || state.lastPreviewHeight || 0);
    ui.previewDimensions.textContent = part ? `${part.originalWidth} × ${part.originalHeight} → 1000 × ${part.height}` : "Screenshot preview · fixed 1000 px PSD width";
    try {
        const result = await api.preview({ filePath: file, maxEdge: 1800, mode: state.previewMode, top: state.detailY, height: state.detailHeight });
        if (request !== state.previewCounter) return;
        if (!result?.ok) throw new Error(result?.error || "Preview not available");
        ui.previewImage.src = result.dataUrl;
        state.lastPreviewHeight = result.normalizedHeight || (part?.height || 0);
        ui.previewMode.textContent = state.previewMode === "detail"
            ? `Detail QC · y ${result.top || 0}–${(result.top || 0) + (result.height || 0)} of ${state.lastPreviewHeight}`
            : "Full screenshot + analysis overlays";
        ui.detailNext.disabled = state.previewMode !== "detail" || (result.top || 0) + (result.height || 0) >= state.lastPreviewHeight;
        ui.detailPrev.disabled = state.previewMode !== "detail" || state.detailY <= 0;
        renderOverlays(part, result);
    } catch (error) { if (request === state.previewCounter) displayError(error); }
}
function updateAnalysis() {
    const a = state.analysis;
    const parts = a?.parts || [];
    ui.heightValue.textContent = a ? `${a.height.toLocaleString()} px` : "—";
    ui.textValue.textContent = a ? String(parts.reduce((n,p) => n + p.counts.editableText, 0)) : "—";
    ui.imageValue.textContent = a ? String(parts.reduce((n,p) => n + p.counts.separateImages, 0)) : "—";
    ui.fallbackValue.textContent = a ? String(parts.length) : "—";
    ui.analysisStats.textContent = a ? `${parts.length} analyzed screenshot(s)` : "Not analyzed";
    ui.warnings.replaceChildren();
    const notes = [ ...(a?.warnings || []), ...parts.flatMap(p => p.warnings.map(w => `${p.name}: ${w}`)) ];
    if (!a) notes.push("No analysis yet. Uncertain regions will be preserved as raster fallback.");
    else if (!notes.length) notes.push("Analysis finished. Review detected blocks in the screenshot preview.");
    for (const note of notes.slice(0, 35)) {
        const p = document.createElement("p"); p.textContent = note;
        if (a && !a.warnings.length && !parts.some(p => p.warnings.length)) p.className = "success";
        ui.warnings.appendChild(p);
    }
    if (notes.length > 35) { const p = document.createElement("p"); p.textContent = `+${notes.length - 35} more warnings in manifest.`; ui.warnings.appendChild(p); }
    refreshControls();
}

async function withBusy(operation) {
    if (state.busy) return;
    state.busy = true; refreshControls(); renderQueue();
    try { await operation(); }
    catch (error) { displayError(error); }
    finally { state.busy = false; refreshControls(); renderQueue(); }
}
ui.addScreenshots.addEventListener("click", async () => {
    if (state.busy) return;
    try { addPaths(await api.selectScreenshots()); }
    catch (error) { displayError(error); }
});
ui.addSingle.addEventListener("click", async () => {
    if (state.busy) return;
    try {
        const file = await api.selectSingle();
        if (!file) return;
        if (state.files.some(s => uniqueKey(s) === uniqueKey(file))) throw new Error("Single is already in the screenshot queue. Remove it there first.");
        state.single = file; clearAnalysis(); refreshControls(); status("Single selected. Its top section will be 1000 × 1000.");
    } catch (error) { displayError(error); }
});
ui.clearSingle.addEventListener("click", () => { state.single = null; clearAnalysis(); refreshControls(); status("Single removed. Empty 1000 × 1000 reserved section will remain."); });
ui.clearList.addEventListener("click", () => { if (state.busy) return; state.files = []; state.selected = null; clearAnalysis(); renderQueue(); void showPreview(); status("Screenshot list cleared."); });
ui.chooseOutput.addEventListener("click", async () => {
    try {
        const folder = await api.selectOutput();
        if (folder) { state.outputFolder = folder; ui.outputFolder.value = folder; refreshControls(); }
    } catch (error) { displayError(error); }
});
ui.productCode.addEventListener("input", refreshControls);
ui.showText.addEventListener("change", () => void showPreview());
ui.showImages.addEventListener("change", () => void showPreview());
ui.viewFull.addEventListener("click", () => { state.previewMode = "full"; state.detailY = 0; void showPreview(); });
ui.viewDetail.addEventListener("click", () => { state.previewMode = "detail"; state.detailY = 0; void showPreview(); });
ui.detailPrev.addEventListener("click", () => { state.detailY = Math.max(0, state.detailY - 1400); void showPreview(); });
ui.detailNext.addEventListener("click", () => { state.detailY += 1400; void showPreview(); });

ui.analyze.addEventListener("click", () => withBusy(async () => {
    status("Analyzing screenshot structure and OCR…", "busy");
    const response = await api.analyze({ screenshots: state.files, singlePath: state.single,
        tesseractPath: ui.tesseractPath.value.trim() });
    state.analysis = response;
    updateAnalysis(); renderQueue(); await showPreview();
    status(`Analysis complete: ${response.width} × ${response.height.toLocaleString()} px. Inspect warnings, then Generate PSD.`, "ok");
}));
ui.generate.addEventListener("click", () => withBusy(async () => {
    if (!state.analysis) throw new Error("Analyze the screenshots first.");
    status("Generating Photoshop layers…", "busy");
    const result = await api.generate({
        sessionId: state.analysis.sessionId, productCode: ui.productCode.value.trim(),
        outputFolder: state.outputFolder, overwrite: ui.overwrite.checked,
        fontLatin: ui.fontLatin.value.trim(), fontJapanese: ui.fontJapanese.value.trim()
    });
    if (!result?.ok) throw new Error(result?.error || "Generation failed");
    state.analysis = null; updateAnalysis();
    status(`Saved ${result.format.toUpperCase()}: ${result.psdPath} · ${result.counts.editableText} editable text layers · ${result.counts.separateImages} isolated images.`, "ok");
}));

if (api?.onProgress) api.onProgress(data => {
    if (state.busy && data?.message) status(data.message, "busy");
});

let dragDepth = 0;
function isFileDrag(event) { return Array.from(event.dataTransfer?.types || []).includes("Files"); }
ui.dropTarget.addEventListener("dragenter", e => {
    if (!isFileDrag(e) || state.busy) return;
    e.preventDefault(); dragDepth++; ui.dragOverlay.hidden = false;
});
ui.dropTarget.addEventListener("dragover", e => {
    if (!isFileDrag(e) || state.busy) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "copy";
});
ui.dropTarget.addEventListener("dragleave", e => {
    if (!isFileDrag(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) ui.dragOverlay.hidden = true;
});
ui.dropTarget.addEventListener("drop", e => {
    if (state.busy || !isFileDrag(e)) return;
    e.preventDefault(); dragDepth = 0; ui.dragOverlay.hidden = true;
    const files = Array.from(e.dataTransfer.files || []);
    const paths = files.map(f => api.getPathForFile(f)).filter(Boolean);
    addPaths(paths);
});
ui.queueDropZone.addEventListener("keydown", event => { if ((event.key === "Enter" || event.key === " ") && !state.busy) { event.preventDefault(); ui.addScreenshots.click(); } });

(async function restore() {
    try {
        const existing = await api.getAnalysis();
        if (existing?.parts?.length) {
            state.analysis = existing; state.files = existing.parts.map(part => part.source);
            state.single = existing.singlePath;
            state.selected = state.files[0];
            updateAnalysis(); await showPreview();
            status("Previous analysis restored. Choose an output folder to generate.", "ok");
        }
    } catch (error) { displayError(error); }
    renderQueue(); refreshControls();
})();
