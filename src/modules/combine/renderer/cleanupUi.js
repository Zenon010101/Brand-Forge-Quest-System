"use strict";

// Loaded before Combine's existing app.js, but executed from wireCleanup()
// after app.js creates its shared api and state objects. Cleanup is independent
// of the Rakuten downloader; user explicitly starts every scan/save.
const cleanupState = { items: new Map(), active: null, busy: false, tool: "inspect", drawing: false,
    drawStart: null, drawPointerId: null, activeStroke: null, sequence: 0 };
const cleanupEl = name => document.getElementById(name);
const cleanupFilename = file => String(file || "").split(/[\\/]/).pop();

function cleanupCurrent() { return cleanupState.items.get(cleanupState.active) || null; }
function cleanupRegions(item) { return [...(item?.scan?.regions || []), ...(item?.manual || [])]; }
function cleanupSelectedAreas(item) {
    return cleanupRegions(item).filter(area => item.approved.has(area.id))
        .map(area => ({ x: area.x, y: area.y, width: area.width, height: area.height }));
}
function cleanupPayload(item) {
    return { filePath: item.path, areas: cleanupSelectedAreas(item),
        strokes: (item.strokes || []).map(s => ({ mode: s.mode, size: s.size, points: s.points })),
        engine: cleanupEl("cleanupRestore").value,
        feather: Number(cleanupEl("cleanupFeather").value) };
}
function cleanupSignature(item) {
    const { filePath, ...selection } = cleanupPayload(item);
    return JSON.stringify(selection);
}
function cleanupSnapshot(item) {
    return { approved: [...item.approved], manual: item.manual.map(x => ({ ...x })),
        strokes: item.strokes.map(s => ({ mode: s.mode, size: s.size, points: s.points.map(p => [...p]) })) };
}
function cleanupRemember(item) {
    if (!item) return;
    item.past.push(cleanupSnapshot(item));
    if (item.past.length > 35) item.past.shift();
    item.future = [];
}
function cleanupRestoreSnapshot(item, snap) {
    item.approved = new Set(snap.approved);
    item.manual = snap.manual.map(x => ({ ...x }));
    item.strokes = snap.strokes.map(s => ({ mode: s.mode, size: s.size, points: s.points.map(p => [...p]) }));
    cleanupInvalidate(item);
}
function cleanupHistory(direction) {
    const item = cleanupCurrent();
    if (!item || cleanupState.busy || state.busy) return;
    const source = direction === "undo" ? item.past : item.future;
    const destination = direction === "undo" ? item.future : item.past;
    if (!source.length) return;
    destination.push(cleanupSnapshot(item));
    cleanupRestoreSnapshot(item, source.pop());
    cleanupRender();
}
function cleanupInvalidate(item) {
    if (!item) return;
    item.preview = null; item.previewSignature = ""; item.view = "before";
    item.capturedCaptions = []; item.captionFields = { first: "", second: "" };
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
    const hasBrush = !!item?.strokes?.some(s => s.mode === "add");
    const canEdit = !locked && !isOff && hasScan;
    cleanupEl("cleanupChoose").disabled = locked;
    cleanupEl("cleanupFromDownloads").disabled = locked || !(rak.download?.images || []).some(i => i.status === "downloaded");
    cleanupEl("cleanupMode").disabled = locked;
    cleanupEl("cleanupRestore").disabled = locked;
    cleanupEl("cleanupFeather").disabled = locked;
    cleanupEl("cleanupBrushSize").disabled = locked || !hasScan;
    cleanupEl("cleanupSelectSuggested").disabled = !canEdit;
    cleanupEl("cleanupClearSelections").disabled = !canEdit;
    for (const id of ["cleanupManual", "cleanupBrush", "cleanupEraser"]) cleanupEl(id).disabled = !canEdit;
    cleanupEl("cleanupUndo").disabled = !canEdit || !item?.past?.length;
    cleanupEl("cleanupRedo").disabled = !canEdit || !item?.future?.length;
    cleanupEl("cleanupPreview").disabled = !canEdit || (!areas.length && !hasBrush);
    cleanupEl("cleanupBefore").disabled = locked || !hasScan;
    cleanupEl("cleanupAfter").disabled = locked || !item?.preview;
    cleanupEl("cleanupSave").disabled = locked || isOff || !item?.preview || (!areas.length && !hasBrush) || item.previewSignature !== cleanupSignature(item);
    cleanupEl("cleanupTarget").disabled = locked;
    cleanupEl("cleanupReuseCaption").disabled = locked;
    for (const [id, tool] of [["cleanupManual", "rectangle"], ["cleanupBrush", "brush"], ["cleanupEraser", "eraser"]]) {
        cleanupEl(id).classList.toggle("active", cleanupState.tool === tool);
    }
    cleanupEl("cleanupBrushSizeValue").textContent = `${cleanupEl("cleanupBrushSize").value}px`;
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
                cleanupRemember(item);
                item.manual = item.manual.filter(a => a.id !== area.id);
                item.approved.delete(area.id); cleanupInvalidate(item); cleanupRender();
            });
            row.appendChild(del);
        }
        root.appendChild(row);
    }
}
function cleanupRenderMask(item) {
    const canvas = cleanupEl("cleanupMask");
    if (!item?.scan || item.view === "after" || cleanupEl("cleanupMode").value === "off") {
        canvas.width = 1; canvas.height = 1; return;
    }
    const { width, height } = item.scan;
    const factor = Math.min(1, 850 / Math.max(width, height));
    const cw = Math.max(1, Math.round(width * factor));
    const ch = Math.max(1, Math.round(height * factor));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "rgba(57, 206, 145, .38)";
    for (const area of cleanupRegions(item)) {
        if (!item.approved.has(area.id)) continue;
        // Mirror backend's small OCR/rectangle padding so mask preview matches.
        const pad = Math.max(1, Math.min(8, Math.round(Math.min(area.height * .10, 6))));
        ctx.fillRect((area.x - pad) * factor, (area.y - pad) * factor,
            (area.width + 2 * pad) * factor, (area.height + 2 * pad) * factor);
    }
    for (const stroke of [...(item.strokes || []), ...(cleanupState.activeStroke ? [cleanupState.activeStroke] : [])]) {
        if (!stroke.points.length) continue;
        ctx.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
        // Destination-out must be opaque: translucent erase leaves a ghost mask.
        ctx.strokeStyle = stroke.mode === "erase" ? "rgba(0,0,0,1)" : "rgba(57, 206, 145, .38)";
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = stroke.size * factor;
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.beginPath();
        const first = stroke.points[0];
        ctx.moveTo(first[0] * factor, first[1] * factor);
        for (const pt of stroke.points.slice(1)) ctx.lineTo(pt[0] * factor, pt[1] * factor);
        if (stroke.points.length > 1) ctx.stroke();
        ctx.beginPath(); ctx.arc(first[0] * factor, first[1] * factor,
            stroke.size * factor / 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
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
    cleanupRenderMask(item);
    cleanupEl("cleanupBefore").classList.toggle("active", !after);
    cleanupEl("cleanupAfter").classList.toggle("active", after);
    stage.classList.toggle("drawing", cleanupState.tool === "rectangle");
    stage.classList.toggle("painting", cleanupState.tool === "brush" || cleanupState.tool === "eraser");
}
function cleanupSuggest(item) {
    const positions = item?.capturedCaptions || [];
    const mode = item?.captionMode || "auto";
    const helper = window.BrandForgeCaptionLayout;
    const suggestion = helper?.capturedCaptionSuggestion(positions, item?.scan?.width, item?.scan?.height, mode) || null;
    const first = (item?.captionFields?.first || "").trim();
    const second = (item?.captionFields?.second || "").trim();
    if (!first && !second) return null;
    return { ...(suggestion || {}), mode: suggestion?.mode || (mode === "auto" ? "single" : mode),
        first, second };
}
function cleanupRenderCaptured() {
    const item = cleanupCurrent();
    const panel = cleanupEl("cleanupRecovered");
    if (!panel) return;
    const show = !!item?.preview && item.previewSignature === cleanupSignature(item);
    panel.hidden = !show;
    if (!show) return;
    const suggested = window.BrandForgeCaptionLayout?.capturedCaptionSuggestion(
        item.capturedCaptions || [], item.scan.width, item.scan.height, item.captionMode || "auto");
    const mode = item.captionMode === "auto" ? (suggested?.mode || "single") : item.captionMode;
    cleanupEl("cleanupCaptionMode").value = item.captionMode || "auto";
    cleanupEl("cleanupCaptionFirstLabel").textContent = mode === "vertical" ? "TOP color name" :
        mode === "dual" ? "LEFT color name" : "Color name";
    cleanupEl("cleanupCaptionSecondLabel").textContent = mode === "vertical" ? "BOTTOM color name" : "RIGHT color name";
    cleanupEl("cleanupCaptionSecondField").hidden = mode === "single" && !(item.captionFields?.second || "");
    cleanupEl("cleanupCaptionFirst").value = item.captionFields?.first || "";
    cleanupEl("cleanupCaptionSecond").value = item.captionFields?.second || "";
    const warnings = [...(item.preview.captionWarnings || [])];
    if (suggested?.review && (item.captionMode || "auto") === "auto") {
        warnings.push("Two captions were found but their arrangement is uncertain. Select LEFT/RIGHT or TOP/BOTTOM before adding.");
    }
    if ((item.capturedCaptions || []).length > 2) warnings.push("More than two captions detected. Only the first two fields are placed into a Line Up row; review the names.");
    if (cleanupEl("cleanupTarget").value !== "lineup") warnings.push("Single/Details save the recovered text as an editable note; only Line Up has generated 28px caption layers.");
    cleanupEl("cleanupCaptionWarning").textContent = warnings.join(" ") ||
        "OCR text is editable. Adjust the fields before saving; your original image will remain unchanged.";
}
function cleanupRender() {
    cleanupRenderQueue(); cleanupRenderAreas(); cleanupRenderImage();
    const item = cleanupCurrent();
    cleanupEl("cleanupEngine").textContent = item?.scan
        ? `${cleanupFilename(item.path)} · ${item.scan.width} x ${item.scan.height} · ${item.scan.engine}${item.scan.warning ? ` · ${item.scan.warning}` : ""}`
        : "OCR uses Tesseract when installed, otherwise Windows OCR. If OCR misses text, draw manual boxes.";
    cleanupEl("cleanupInstructions").textContent = cleanupState.tool === "rectangle"
        ? "Rectangle: drag closely around existing text. The green overlay is the selection, not an edit to the photo."
        : cleanupState.tool === "brush"
        ? "Brush Select / Restore: paint only the text or repaint selection accidentally erased. Adjust brush size as needed."
        : cleanupState.tool === "eraser"
        ? "Eraser: paint over GREEN SELECTION to protect product pixels. This erases the mask, not the image."
        : item?.preview ? `Preview ready · ${(item.preview.methods || []).join(", ")}${item.preview.warnings?.length ? ` · WARNING: ${item.preview.warnings.join(" ")}` : ""}. Compare before/after before saving.`
        : "Approve captions, then refine the green selection with Brush or Eraser. Clean Fill changes selected pixels only; logos and product details should stay outside the mask.";
    cleanupRenderCaptured();
    refreshCleanupButtons();
}
function cleanupToggleArea(id, checked) {
    const item = cleanupCurrent(); if (!item || cleanupState.busy) return;
    if (item.approved.has(id) === checked) return;
    cleanupRemember(item);
    if (checked) item.approved.add(id); else item.approved.delete(id);
    cleanupInvalidate(item); cleanupRender();
}
async function cleanupActivate(file) {
    if (cleanupState.busy || state.busy) return;
    cleanupState.active = file; cleanupState.tool = "inspect"; cleanupState.drawing = false; cleanupState.activeStroke = null;
    const item = cleanupCurrent(); if (!item) return;
    cleanupRender();
    if (item.scan) return;
    const seq = ++cleanupState.sequence;
    cleanupState.busy = true; cleanupMessage(`Detecting text in ${cleanupFilename(file)}...`); cleanupRender();
    try {
        const scan = await api.scanCleanup(file);
        item.scan = scan;
        item.approved.clear(); item.manual = []; item.strokes = []; item.past = []; item.future = []; cleanupInvalidate(item);
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
            { ...file, scan: null, manual: [], approved: new Set(), strokes: [], past: [], future: [], preview: null, previewSignature: "", saved: null, view: "before" });
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
        cleanupRemember(item);
        for (const area of item.scan.regions) if (area.suggested) item.approved.add(area.id);
        cleanupInvalidate(item);
    }
    if (mode === "off") { cleanupState.drawing = false; cleanupState.tool = "inspect"; cleanupState.activeStroke = null; }
    cleanupRender();
}
function cleanupSetView(view) {
    const item = cleanupCurrent(); if (!item?.scan) return;
    if (view === "after" && !item.preview) return;
    item.view = view; cleanupState.drawing = false; cleanupState.tool = "inspect"; cleanupState.activeStroke = null; cleanupRender();
}
async function cleanupPreviewSelected() {
    const item = cleanupCurrent(); if (!item?.scan || cleanupState.busy || state.busy) return;
    const payload = cleanupPayload(item);
    if (!payload.areas.length && !payload.strokes.some(s => s.mode === "add")) return cleanupMessage("Select at least one text area.", true);
    if (payload.strokes.length && payload.engine !== "clean") return cleanupMessage("Brush/Eraser selections require Clean Fill. Change the removal method to Clean Fill.", true);
    const signature = cleanupSignature(item);
    cleanupState.busy = true; cleanupMessage("Reconstructing the selected background areas for QC preview..."); cleanupRender();
    try {
        // Capture from the ORIGINAL selected pixels before filling the erased
        // region. Includes manual rectangles and Brush Select, not only OCR
        // boxes clicked during the first full-image scan.
        const preview = await api.previewCleanup({ ...payload, captureText: true });
        item.preview = preview; item.previewSignature = signature; item.view = "after";
        const approvedOcr = (item.scan?.regions || []).filter(box =>
            item.approved.has(box.id) && box.text?.trim());
        item.capturedCaptions = Array.isArray(preview.captions) ? preview.captions : approvedOcr;
        item.captionMode = "auto";
        const suggestion = window.BrandForgeCaptionLayout?.capturedCaptionSuggestion(
            item.capturedCaptions, item.scan.width, item.scan.height, "auto");
        item.captionFields = { first: suggestion?.first || "", second: suggestion?.second || "" };
        const warnings = [...(preview.warnings || []), ...(preview.captionWarnings || [])];
        cleanupMessage(warnings.length ? `QC REQUIRED: ${warnings.join(" ")}` :
            "Cleaned preview ready. Original text was captured and will fill the selected Combine fields. Review before saving.", !!warnings.length);
    } catch(error) { cleanupInvalidate(item); cleanupMessage(error.message || String(error), true); }
    finally { cleanupState.busy = false; cleanupRender(); }
}
async function cleanupSaveSelected() {
    const item = cleanupCurrent(); if (!item?.preview || cleanupState.busy || state.busy) return;
    if (item.previewSignature !== cleanupSignature(item)) return cleanupMessage("Text regions changed. Preview again before saving.", true);
    const payload = cleanupPayload(item);
    if (payload.strokes.length && payload.engine !== "clean") return cleanupMessage("Brush/Eraser selections require Clean Fill.", true);
    const pendingNames = cleanupSuggest(item);
    if (cleanupEl("cleanupTarget").value === "lineup" && cleanupEl("cleanupReuseCaption").checked &&
        pendingNames?.review && item.captionMode === "auto" && pendingNames.first && pendingNames.second) {
        return cleanupMessage("Two names were captured, but their arrangement is unclear. Choose LEFT/RIGHT or TOP/BOTTOM before saving.", true);
    }
    if (cleanupEl("cleanupTarget").value === "lineup" && cleanupEl("cleanupReuseCaption").checked &&
        [pendingNames?.first, pendingNames?.second].some(name => String(name || "").length > 120)) {
        return cleanupMessage("Line Up color names must be 120 characters or fewer. Shorten the recovered OCR name before saving.", true);
    }
    cleanupState.busy = true; cleanupMessage("Saving a new cleaned PNG while preserving the original image..."); cleanupRender();
    try {
        const saved = await api.saveCleanup(payload);
        const target = cleanupEl("cleanupTarget").value;
        item.saved = saved.path;
        // Fill before addImages() so the normal existing queue renderer can
        // display the names immediately. The user can still edit every field.
        const suggestion = cleanupEl("cleanupReuseCaption").checked ? cleanupSuggest(item) : null;
        if (saved.imported?.images?.length) {
            const imported = saved.imported.images.find(entry => entry.path === saved.path) || saved.imported.images[0];
            if (target === "lineup" && cleanupEl("cleanupReuseCaption").checked) {
                // No OCR result is not a license to derive a color name from
                // the cleaned filename. Leave the input blank for user review.
                imported.suggestedLineup = suggestion || { mode: "single", first: "", second: "" };
            }
            const names = [item.captionFields?.first, item.captionFields?.second].filter(name => String(name || "").trim());
            if (target !== "lineup" && names.length && cleanupEl("cleanupReuseCaption").checked) {
                imported.recoveredCaptions = names;
            }
        }
        await addImages(target, saved.imported);
        cleanupMessage(`Saved ${cleanupFilename(saved.path)} in COMBINE_CLEANED and added it to ${target === "lineup" ? "Line Up" : target === "single" ? "Single" : "Details"}.${suggestion && target === "lineup" ? " Color name fields filled automatically; review/edit them as needed." : ""} Original unchanged.`);
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
    cleanupRemember(item);
    const id = `manual-${Date.now()}-${item.manual.length}`;
    item.manual.push({ id, text: `Manual area ${item.manual.length + 1}`, x, y, width, height,
        suggested: false, confidence: null });
    item.approved.add(id); cleanupInvalidate(item); cleanupRender();
    cleanupMessage("Manual area added. Use Eraser to subtract any product pixels from the green selection.");
}
function cleanupSetTool(tool) {
    const item = cleanupCurrent(); if (!item?.scan || cleanupState.busy || state.busy) return;
    cleanupState.tool = cleanupState.tool === tool ? "inspect" : tool;
    cleanupState.drawing = cleanupState.tool === "rectangle";
    cleanupState.drawStart = null; cleanupState.activeStroke = null;
    if (cleanupState.tool !== "inspect") {
        item.view = "before";
        if (["brush", "eraser"].includes(tool) && cleanupEl("cleanupRestore").value !== "clean") {
            cleanupEl("cleanupRestore").value = "clean";
            cleanupInvalidate(item);
            cleanupMessage("Switched to Clean Fill because Photoshop Content-Aware cannot honor precise eraser masks.");
        }
    }
    cleanupEl("cleanupDraw").hidden = true;
    cleanupRender();
}
function cleanupBrushPoint(event, stage, item) {
    const p = cleanupDrawPoint(event, stage);
    return [Math.min(item.scan.width - 1, p.x * item.scan.width),
        Math.min(item.scan.height - 1, p.y * item.scan.height)];
}
function cleanupStageStart(event, stage) {
    const item = cleanupCurrent();
    if (!item?.scan || cleanupState.busy || state.busy || cleanupEl("cleanupMode").value === "off") return;
    if (!(["rectangle", "brush", "eraser"].includes(cleanupState.tool))) return;
    if (event.button !== 0) return;
    event.preventDefault();
    cleanupState.drawPointerId = event.pointerId;
    stage.setPointerCapture(event.pointerId);
    if (cleanupState.tool === "rectangle") {
        cleanupState.drawStart = cleanupDrawPoint(event, stage);
        cleanupUpdateDraft(cleanupState.drawStart);
    } else {
        const sizeInImagePixels = Math.min(600, Math.max(2, Number(cleanupEl("cleanupBrushSize").value)
            * item.scan.width / Math.max(1, stage.getBoundingClientRect().width)));
        cleanupState.activeStroke = { mode: cleanupState.tool === "brush" ? "add" : "erase",
            size: Math.round(sizeInImagePixels * 10) / 10, points: [cleanupBrushPoint(event, stage, item)] };
        cleanupRenderMask(item);
    }
}
function cleanupStageMove(event, stage) {
    if (event.pointerId !== cleanupState.drawPointerId) return;
    if (cleanupState.drawStart) return cleanupUpdateDraft(cleanupDrawPoint(event, stage));
    const stroke = cleanupState.activeStroke, item = cleanupCurrent();
    if (!stroke || !item?.scan) return;
    const p = cleanupBrushPoint(event, stage, item);
    const last = stroke.points[stroke.points.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) > Math.max(1.5, stroke.size * 0.12)) {
        if (stroke.points.length < 1800) stroke.points.push(p);
        cleanupRenderMask(item);
    }
}
function cleanupStageFinish(event, stage) {
    if (event.pointerId !== cleanupState.drawPointerId) return;
    if (cleanupState.drawStart) return cleanupEndDraw(event);
    const item = cleanupCurrent(), stroke = cleanupState.activeStroke;
    cleanupState.drawPointerId = null; cleanupState.activeStroke = null;
    if (!item?.scan || !stroke) return;
    cleanupRemember(item);
    item.strokes.push(stroke);
    cleanupInvalidate(item); cleanupRender();
    cleanupMessage(stroke.mode === "erase"
        ? "Selection mask refined: green pixels removed; original image untouched. Preview again."
        : "Selection mask expanded. Preview to remove just the marked text pixels.");
}
function wireCleanup() {
    cleanupEl("cleanupChoose").addEventListener("click", cleanupPick);
    cleanupEl("cleanupFromDownloads").addEventListener("click", cleanupUseDownloads);
    cleanupEl("cleanupMode").addEventListener("change", event => cleanupSetMode(event.target.value));
    cleanupEl("cleanupRestore").addEventListener("change", () => { cleanupInvalidate(cleanupCurrent()); cleanupRender(); });
    cleanupEl("cleanupFeather").addEventListener("change", () => { cleanupInvalidate(cleanupCurrent()); cleanupRender(); });
    cleanupEl("cleanupBrushSize").addEventListener("input", () => refreshCleanupButtons());
    cleanupEl("cleanupBefore").addEventListener("click", () => cleanupSetView("before"));
    cleanupEl("cleanupAfter").addEventListener("click", () => cleanupSetView("after"));
    cleanupEl("cleanupSelectSuggested").addEventListener("click", () => {
        const item = cleanupCurrent(); if (!item?.scan) return;
        cleanupRemember(item);
        for (const box of item.scan.regions) if (box.suggested) item.approved.add(box.id);
        cleanupInvalidate(item); cleanupRender();
    });
    cleanupEl("cleanupClearSelections").addEventListener("click", () => {
        const item = cleanupCurrent(); if (!item) return;
        cleanupRemember(item);
        item.approved.clear(); item.strokes = []; cleanupInvalidate(item); cleanupRender();
    });
    cleanupEl("cleanupManual").addEventListener("click", () => cleanupSetTool("rectangle"));
    cleanupEl("cleanupBrush").addEventListener("click", () => cleanupSetTool("brush"));
    cleanupEl("cleanupEraser").addEventListener("click", () => cleanupSetTool("eraser"));
    cleanupEl("cleanupUndo").addEventListener("click", () => cleanupHistory("undo"));
    cleanupEl("cleanupRedo").addEventListener("click", () => cleanupHistory("redo"));
    cleanupEl("cleanupCaptionMode").addEventListener("change", event => {
        const item = cleanupCurrent(); if (!item || cleanupState.busy) return;
        item.captionMode = event.target.value; cleanupRenderCaptured();
    });
    for (const [id, side] of [["cleanupCaptionFirst", "first"], ["cleanupCaptionSecond", "second"]]) {
        cleanupEl(id).addEventListener("input", event => {
            const item = cleanupCurrent(); if (item?.preview && !cleanupState.busy) {
                item.captionFields[side] = event.target.value;
            }
        });
    }
    cleanupEl("cleanupTarget").addEventListener("change", cleanupRenderCaptured);
    cleanupEl("cleanupPreview").addEventListener("click", cleanupPreviewSelected);
    cleanupEl("cleanupSave").addEventListener("click", cleanupSaveSelected);
    const stage = cleanupEl("cleanupStage");
    stage.addEventListener("pointerdown", event => cleanupStageStart(event, stage));
    stage.addEventListener("pointermove", event => cleanupStageMove(event, stage));
    stage.addEventListener("pointerup", event => cleanupStageFinish(event, stage));
    stage.addEventListener("pointercancel", () => {
        cleanupState.drawStart = null; cleanupState.drawPointerId = null;
        cleanupState.activeStroke = null;
        cleanupEl("cleanupDraw").hidden = true;
        cleanupRenderMask(cleanupCurrent());
    });
    cleanupRender();
}
