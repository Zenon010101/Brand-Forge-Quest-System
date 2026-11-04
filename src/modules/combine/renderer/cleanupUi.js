"use strict";

// Loaded before Combine's existing app.js, but executed from wireCleanup()
// after app.js creates its shared api and state objects. Cleanup is independent
// of the Rakuten downloader; user explicitly starts every scan/save.
const cleanupState = { items: new Map(), active: null, busy: false, drawing: false,
    drawStart: null, drawPointerId: null, sequence: 0 };
const cleanupEl = name => document.getElementById(name);
const cleanupFilename = file => String(file || "").split(/[\\/]/).pop();

function cleanupCurrent() { return cleanupState.items.get(cleanupState.active) || null; }
function cleanupRegions(item) { return [...(item?.scan?.regions || []), ...(item?.manual || [])]; }
function cleanupSelectedAreas(item) {
    return cleanupRegions(item).filter(area => item.approved.has(area.id))
        .map(area => ({ x: area.x, y: area.y, width: area.width, height: area.height }));
}
function cleanupSignature(item) { return JSON.stringify({ engine: cleanupEl("cleanupRestore").value, areas: cleanupSelectedAreas(item) }); }
function cleanupInvalidate(item) {
    if (!item) return;
    item.preview = null; item.previewSignature = ""; item.view = "before";
}
function cleanupMessage(message, error = false) {
    cleanupEl("cleanupStatus").textContent = message;
    cleanupEl("cleanupStatus").style.color = error ? "#ef9898" : "#bddac8";
}
function refreshCleanupButtons() {
    if (!cleanupEl("cleanupChoose")) return;
    const locked = cleanupState.busy || state.busy || rak.busy;
    const item = cleanupCurrent(), isOff = cleanupEl("cleanupMode").value === "off";
    const hasScan = !!item?.scan;
    const areas = item ? cleanupSelectedAreas(item) : [];
    cleanupEl("cleanupChoose").disabled = locked;
    cleanupEl("cleanupFromDownloads").disabled = locked || !(rak.download?.images || []).some(i => i.status === "downloaded");
    cleanupEl("cleanupMode").disabled = locked;
    cleanupEl("cleanupRestore").disabled = locked;
    cleanupEl("cleanupSelectSuggested").disabled = locked || isOff || !hasScan;
    cleanupEl("cleanupClearSelections").disabled = locked || isOff || !hasScan;
    cleanupEl("cleanupManual").disabled = locked || isOff || !hasScan;
    cleanupEl("cleanupPreview").disabled = locked || isOff || !hasScan || !areas.length;
    cleanupEl("cleanupBefore").disabled = locked || !hasScan;
    cleanupEl("cleanupAfter").disabled = locked || !item?.preview;
    cleanupEl("cleanupSave").disabled = locked || isOff || !item?.preview || !areas.length || item.previewSignature !== cleanupSignature(item);
    cleanupEl("cleanupTarget").disabled = locked;
    cleanupEl("cleanupReuseCaption").disabled = locked;
    cleanupEl("cleanupManual").classList.toggle("active", cleanupState.drawing);
}
function cleanupRenderQueue() {
    const root = cleanupEl("cleanupQueue"); root.replaceChildren();
    if (!cleanupState.items.size) {
        const empty = document.createElement("p"); empty.className = "empty";
        empty.textContent = "Select downloaded slides or choose local images to clean."; root.appendChild(empty); return;
    }
    for (const [file, item] of cleanupState.items) {
        const b = document.createElement("button"); b.type = "button";
        b.textContent = cleanupFilename(file); b.title = file;
        b.className = (cleanupState.active === file ? "active " : "") + (item.saved ? "saved" : "");
        b.disabled = cleanupState.busy || state.busy;
        b.addEventListener("click", () => cleanupActivate(file));
        root.appendChild(b);
    }
}
function cleanupRenderAreas() {
    const root = cleanupEl("cleanupRegions"); root.replaceChildren();
    const item = cleanupCurrent();
    if (!item?.scan) {
        const hint = document.createElement("p"); hint.className = "empty";
        hint.textContent = "Select an image to scan for embedded text."; root.appendChild(hint); return;
    }
    const areas = cleanupRegions(item);
    if (!areas.length) {
        const hint = document.createElement("p"); hint.className = "empty";
        hint.textContent = "No OCR regions detected. Click Draw Text Area to select a caption manually."; root.appendChild(hint); return;
    }
    for (const area of areas) {
        const row = document.createElement("div"); row.className = "cleanup-region-row";
        const checkbox = document.createElement("input"); checkbox.type = "checkbox";
        checkbox.checked = item.approved.has(area.id);
        checkbox.disabled = cleanupState.busy || state.busy || cleanupEl("cleanupMode").value === "off";
        checkbox.addEventListener("change", () => cleanupToggleArea(area.id, checkbox.checked));
        const label = document.createElement("label");
        const title = document.createElement("strong"); title.textContent = area.text || "Manual area";
        const info = document.createElement("small");
        info.textContent = `  ${area.suggested ? "· possible caption" : "· review"}${area.confidence != null ? ` · OCR ${Math.round(area.confidence)}%` : ""}`;
        label.append(title, info); label.addEventListener("click", () => cleanupToggleArea(area.id, !item.approved.has(area.id)));
        row.append(checkbox, label);
        if (String(area.id).startsWith("manual-")) {
            const del = document.createElement("button"); del.type = "button"; del.className = "minor"; del.textContent = "Remove";
            del.disabled = cleanupState.busy || state.busy;
            del.addEventListener("click", () => {
                item.manual = item.manual.filter(a => a.id !== area.id);
                item.approved.delete(area.id); cleanupInvalidate(item); cleanupRender();
            });
            row.appendChild(del);
        }
        root.appendChild(row);
    }
}
function cleanupRenderImage() {
    const item = cleanupCurrent(); const stage = cleanupEl("cleanupStage");
    stage.hidden = !item?.scan;
    const overlay = cleanupEl("cleanupOverlay"); overlay.replaceChildren();
    if (!item?.scan) return;
    const after = item.view === "after" && !!item.preview;
    const url = after ? item.preview.previewDataUrl : item.scan.previewDataUrl;
    if (cleanupEl("cleanupImage").src !== url) cleanupEl("cleanupImage").src = url;
    const { width, height } = item.scan;
    if (!after) {
        for (const area of cleanupRegions(item)) {
            const button = document.createElement("button"); button.type = "button";
            button.className = `cleanup-region-box${item.approved.has(area.id) ? " selected" : ""}`;
            button.title = `${area.text || "Manual selection"} · click to ${item.approved.has(area.id) ? "exclude" : "approve"}`;
            button.style.left = `${area.x / width * 100}%`;
            button.style.top = `${area.y / height * 100}%`;
            button.style.width = `${area.width / width * 100}%`;
            button.style.height = `${area.height / height * 100}%`;
            button.disabled = cleanupState.busy || state.busy;
            button.addEventListener("click", event => { event.stopPropagation();
                if (!cleanupState.drawing) cleanupToggleArea(area.id, !item.approved.has(area.id)); });
            overlay.appendChild(button);
        }
    }
    cleanupEl("cleanupBefore").classList.toggle("active", !after);
    cleanupEl("cleanupAfter").classList.toggle("active", after);
    stage.classList.toggle("drawing", cleanupState.drawing);
}
function cleanupRender() {
    cleanupRenderQueue(); cleanupRenderAreas(); cleanupRenderImage();
    const item = cleanupCurrent();
    cleanupEl("cleanupEngine").textContent = item?.scan
        ? `${cleanupFilename(item.path)} · ${item.scan.width} x ${item.scan.height} · ${item.scan.engine}${item.scan.warning ? ` · ${item.scan.warning}` : ""}`
        : "OCR uses Tesseract when installed, otherwise Windows OCR. If OCR misses text, draw manual boxes.";
    cleanupEl("cleanupInstructions").textContent = cleanupState.drawing
        ? "Drawing mode is on. Drag over the text in the original preview to create a removal area. Click Draw Text Area again to finish."
        : item?.preview ? `Preview ready · ${(item.preview.methods || []).join(", ")}${item.preview.warnings?.length ? ` · WARNING: ${item.preview.warnings.join(" ")}` : ""}. Check the image before saving.`
        : "Approve only existing color names/captions. Keep logos, embroidery, labels, prints, and product details unchecked. Preview before saving.";
    refreshCleanupButtons();
}
function cleanupToggleArea(id, checked) {
    const item = cleanupCurrent(); if (!item || cleanupState.busy) return;
    if (checked) item.approved.add(id); else item.approved.delete(id);
    cleanupInvalidate(item); cleanupRender();
}
async function cleanupActivate(file) {
    if (cleanupState.busy || state.busy) return;
    cleanupState.active = file; cleanupState.drawing = false;
    const item = cleanupCurrent(); if (!item) return;
    cleanupRender();
    if (item.scan) return;
    const seq = ++cleanupState.sequence;
    cleanupState.busy = true; cleanupMessage(`Detecting text in ${cleanupFilename(file)}...`); cleanupRender();
    try {
        const scan = await api.scanCleanup(file);
        item.scan = scan;
        item.approved.clear(); item.manual = []; cleanupInvalidate(item);
        if (cleanupEl("cleanupMode").value === "auto") {
            for (const area of scan.regions) if (area.suggested) item.approved.add(area.id);
        }
        cleanupMessage(scan.warning ? `OCR note: ${scan.warning} You can still draw text areas.` :
            `Found ${scan.regions.length} text region(s). Approve the captions, then preview their removal.`, !!scan.warning);
    } catch(error) { cleanupMessage(error.message || String(error), true); }
    finally { cleanupState.busy = false; if (seq === cleanupState.sequence) cleanupRender(); }
}
async function cleanupAccept(result) {
    const incoming = result?.images || [];
    if (!incoming.length) {
        cleanupMessage((result.failed || []).map(f => `${cleanupFilename(f.path)}: ${f.error}`).join(" | ") || "No cleanup images selected.", true);
        return;
    }
    for (const file of incoming) {
        if (!cleanupState.items.has(file.path)) cleanupState.items.set(file.path,
            { ...file, scan: null, manual: [], approved: new Set(), preview: null, previewSignature: "", saved: null, view: "before" });
    }
    const bad = result.failed?.length || 0;
    cleanupMessage(`Loaded ${incoming.length} image(s) for optional text cleanup.${bad ? ` ${bad} file(s) skipped.` : ""}`);
    cleanupRender();
    if (!cleanupState.active) await cleanupActivate(incoming[0].path);
}
async function cleanupPick() {
    if (cleanupState.busy || state.busy) return;
    try { await cleanupAccept(await api.chooseCleanupFiles()); }
    catch(error) { cleanupMessage(error.message || String(error), true); }
}
async function cleanupUseDownloads() {
    if (cleanupState.busy || state.busy) return;
    try { await cleanupAccept(await api.addDownloadedToCleanup()); }
    catch(error) { cleanupMessage(error.message || String(error), true); }
}
function cleanupSetMode(mode) {
    const item = cleanupCurrent();
    if (item?.scan && mode === "auto") {
        for (const area of item.scan.regions) if (area.suggested) item.approved.add(area.id);
        cleanupInvalidate(item);
    }
    if (mode === "off") cleanupState.drawing = false;
    cleanupRender();
}
function cleanupSetView(view) {
    const item = cleanupCurrent(); if (!item?.scan) return;
    if (view === "after" && !item.preview) return;
    item.view = view; cleanupState.drawing = false; cleanupRender();
}
async function cleanupPreviewSelected() {
    const item = cleanupCurrent(); if (!item?.scan || cleanupState.busy || state.busy) return;
    const areas = cleanupSelectedAreas(item); if (!areas.length) return cleanupMessage("Select at least one text area.", true);
    const signature = cleanupSignature(item);
    cleanupState.busy = true; cleanupMessage("Reconstructing the selected background areas for QC preview..."); cleanupRender();
    try {
        const preview = await api.previewCleanup({ filePath: item.path, areas, engine: cleanupEl("cleanupRestore").value });
        item.preview = preview; item.previewSignature = signature; item.view = "after";
        cleanupMessage(preview.warnings?.length ? `QC REQUIRED: ${preview.warnings.join(" ")}` :
            "Cleaned preview ready. Compare Original / Cleaned, then save only if product details remain correct.", !!preview.warnings?.length);
    } catch(error) { cleanupInvalidate(item); cleanupMessage(error.message || String(error), true); }
    finally { cleanupState.busy = false; cleanupRender(); }
}
async function cleanupSaveSelected() {
    const item = cleanupCurrent(); if (!item?.preview || cleanupState.busy || state.busy) return;
    if (item.previewSignature !== cleanupSignature(item)) return cleanupMessage("Text regions changed. Preview again before saving.", true);
    const areas = cleanupSelectedAreas(item);
    cleanupState.busy = true; cleanupMessage("Saving a new cleaned PNG while preserving the original image..."); cleanupRender();
    try {
        const saved = await api.saveCleanup({ filePath: item.path, areas, engine: cleanupEl("cleanupRestore").value });
        const target = cleanupEl("cleanupTarget").value;
        item.saved = saved.path;
        await addImages(target, saved.imported);
        if (target === "lineup" && cleanupEl("cleanupReuseCaption").checked) {
            // Approved OCR captions are placed by their ORIGINAL image columns,
            // not by OCR emission order. Two different columns automatically
            // turn the newly cleaned image into a full-width dual-item row.
            // Product logos and other unapproved OCR areas cannot become names.
            const approvedOcr = (item.scan?.regions || []).filter(box =>
                item.approved.has(box.id) && box.text?.trim());
            const width = item.scan?.width || 0;
            const left = approvedOcr.filter(box => box.x + box.width / 2 < width / 2)
                .sort((a,b) => a.y - b.y || a.x - b.x).map(box => box.text.trim()).join(" ").trim();
            const right = approvedOcr.filter(box => box.x + box.width / 2 >= width / 2)
                .sort((a,b) => a.y - b.y || a.x - b.x).map(box => box.text.trim()).join(" ").trim();
            const newLine = state.lineup.find(entry => entry.path === saved.path);
            if (newLine && left && right) {
                newLine.rowMode = "dual";
                newLine.colorName = left;
                newLine.colorNameRight = right;
                renderQueues(); requestLayout();
            } else if (newLine && approvedOcr.length === 1) {
                newLine.colorName = approvedOcr[0].text.trim();
                renderQueues(); requestLayout();
            }
        }
        cleanupMessage(`Saved ${cleanupFilename(saved.path)} in COMBINE_CLEANED and added it to ${target === "lineup" ? "Line Up" : target === "single" ? "Single" : "Details"}. Original unchanged.`);
    } catch(error) { cleanupMessage(error.message || String(error), true); }
    finally { cleanupState.busy = false; cleanupRender(); }
}
function cleanupDrawPoint(event, stage) {
    const rect = stage.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
}
function cleanupUpdateDraft(point) {
    const start = cleanupState.drawStart; if (!start) return;
    const box = cleanupEl("cleanupDraw"); box.hidden = false;
    box.style.left = `${Math.min(start.x, point.x) * 100}%`;
    box.style.top = `${Math.min(start.y, point.y) * 100}%`;
    box.style.width = `${Math.abs(start.x - point.x) * 100}%`;
    box.style.height = `${Math.abs(start.y - point.y) * 100}%`;
}
function cleanupEndDraw(event) {
    const item = cleanupCurrent(); const stage = cleanupEl("cleanupStage");
    if (!item?.scan || !cleanupState.drawStart || event.pointerId !== cleanupState.drawPointerId) return;
    const start = cleanupState.drawStart, end = cleanupDrawPoint(event, stage);
    cleanupState.drawStart = null; cleanupState.drawPointerId = null;
    cleanupEl("cleanupDraw").hidden = true;
    const x = Math.floor(Math.min(start.x, end.x) * item.scan.width);
    const y = Math.floor(Math.min(start.y, end.y) * item.scan.height);
    const width = Math.round(Math.abs(start.x - end.x) * item.scan.width);
    const height = Math.round(Math.abs(start.y - end.y) * item.scan.height);
    if (width < 4 || height < 4) return cleanupMessage("Manual area is too small. Drag a larger rectangle around the text.", true);
    const id = `manual-${Date.now()}-${item.manual.length}`;
    item.manual.push({ id, text: `Manual area ${item.manual.length + 1}`, x, y, width, height,
        suggested: false, confidence: null });
    item.approved.add(id); cleanupInvalidate(item); cleanupRender();
    cleanupMessage("Manual area added. Preview removal, then verify the product details.");
}
function wireCleanup() {
    cleanupEl("cleanupChoose").addEventListener("click", cleanupPick);
    cleanupEl("cleanupFromDownloads").addEventListener("click", cleanupUseDownloads);
    cleanupEl("cleanupMode").addEventListener("change", event => cleanupSetMode(event.target.value));
    cleanupEl("cleanupRestore").addEventListener("change", () => { cleanupInvalidate(cleanupCurrent()); cleanupRender(); });
    cleanupEl("cleanupBefore").addEventListener("click", () => cleanupSetView("before"));
    cleanupEl("cleanupAfter").addEventListener("click", () => cleanupSetView("after"));
    cleanupEl("cleanupSelectSuggested").addEventListener("click", () => {
        const item = cleanupCurrent(); if (!item?.scan) return;
        for (const box of item.scan.regions) if (box.suggested) item.approved.add(box.id);
        cleanupInvalidate(item); cleanupRender();
    });
    cleanupEl("cleanupClearSelections").addEventListener("click", () => {
        const item = cleanupCurrent(); if (!item) return;
        item.approved.clear(); cleanupInvalidate(item); cleanupRender();
    });
    cleanupEl("cleanupManual").addEventListener("click", () => {
        const item = cleanupCurrent(); if (!item?.scan) return;
        cleanupState.drawing = !cleanupState.drawing;
        if (cleanupState.drawing) item.view = "before";
        cleanupRender();
    });
    const stage = cleanupEl("cleanupStage");
    stage.addEventListener("pointerdown", event => {
        if (!cleanupState.drawing || cleanupState.busy || state.busy || !cleanupCurrent()?.scan) return;
        event.preventDefault(); cleanupState.drawStart = cleanupDrawPoint(event, stage);
        cleanupState.drawPointerId = event.pointerId; stage.setPointerCapture(event.pointerId);
        cleanupUpdateDraft(cleanupState.drawStart);
    });
    stage.addEventListener("pointermove", event => {
        if (cleanupState.drawStart && event.pointerId === cleanupState.drawPointerId) cleanupUpdateDraft(cleanupDrawPoint(event, stage));
    });
    stage.addEventListener("pointerup", cleanupEndDraw);
    stage.addEventListener("pointercancel", () => {
        cleanupState.drawStart = null; cleanupState.drawPointerId = null; cleanupEl("cleanupDraw").hidden = true;
    });
    cleanupEl("cleanupPreview").addEventListener("click", cleanupPreviewSelected);
    cleanupEl("cleanupSave").addEventListener("click", cleanupSaveSelected);
    cleanupRender();
}
