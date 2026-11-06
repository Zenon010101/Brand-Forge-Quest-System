"use strict";
const api = window.combineApp;
const el = id => document.getElementById(id);
const state = { single: null, lineup: [], details: [], selected: null, view: "full",
    outputFolder: null, lastOutput: null, busy: false, layout: null, error: null };
// Rakuten download + optional conservative caption-cleanup workspace; still independent of Combine PSD generation.
const rak = { scan:null, download:null, folder:null, previews:new Map(), previewPending:new Set(), busy:false };
const thumbs = new Map();
const thumbKey = entry => `${entry.path}${entry.rowMode === "vertical" ? "::full-canvas" : ""}`;
const pending = new Set();
const queue = [];
let activePreviews = 0;
let planSeq = 0;
let previewSeq = 0;
const fileName = path => String(path || "").split(/[\\/]/).pop();
const withoutExt = name => name.replace(/\.[^.]+$/, "");
function suggestColorName(image) {
    const stem = withoutExt(image.name).replace(/(?:[_\- ]+\d{1,3})$/, "").replace(/^(?:lineup|line_up|variation|color|clr)[-_ ]*/i, "");
    if (!stem || /^\d+$/.test(stem) || /^(?:img|image|dsc|photo|pict|screenshot)[-_ ]*\d*$/i.test(stem)) return "";
    return stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}
function note(msg, error = false, meta) {
    el("statusText").textContent = msg;
    el("statusText").style.color = error ? "#ef9898" : "#bddac8";
    if (meta != null) el("statusMeta").textContent = meta;
}
function sectionList(section) { return section === "single" ? (state.single ? [state.single] : []) : state[section]; }
function allEntries() { return [...sectionList("single"), ...state.lineup, ...state.details]; }
function entryKey(entry) { return entry?.path || ""; }
function setActivePreview(entry) {
    state.selected = entry?.path || null;
    state.view = "selected";
    renderQueues(); updateTabs(); showSelected();
}
function scheduleThumb(file, edge = 400) {
    if (!file) return;
    const key = thumbKey(file);
    if (thumbs.has(key) || pending.has(key)) return;
    pending.add(key);
    queue.push({ file, edge, key });
    pumpThumbnails();
}
function pumpThumbnails() {
    while (activePreviews < 2 && queue.length) {
        const { file, edge, key } = queue.shift();
        activePreviews++;
        api.preview({ filePath: file.path, maxEdge: edge,
            preserveCanvas: file.rowMode === "vertical" }).then(result => {
            if (result?.dataUrl) thumbs.set(key, result.dataUrl);
        }).catch(() => { /* unsupported preview retains placeholder; generation validates actual image */ })
            .finally(() => {
                activePreviews--; pending.delete(key);
                renderThumbnailsOnly();
                if (state.view === "full" && state.layout) drawFullPreview();
                if (state.view === "selected" && file.path === state.selected) showSelected();
                pumpThumbnails();
            });
    }
}
function renderThumbnailsOnly() {
    document.querySelectorAll("[data-thumb-path]").forEach(img => {
        const src = thumbs.get(img.dataset.thumbKey || img.dataset.thumbPath);
        if (src && img.tagName === "IMG") img.src = src;
    });
}
function makeButton(label, title, callback, className) {
    const b = document.createElement("button");
    b.type = "button"; b.className = `icon-button ${className || ""}`;
    b.textContent = label; b.title = title; b.addEventListener("click", event => { event.stopPropagation(); callback(); });
    b.disabled = state.busy; return b;
}
// Two-product images can be HORIZONTAL (LEFT | RIGHT) or VERTICAL
// (TOP :: BOTTOM). Both source images remain intact with two editable names.
function parseDualColorNames(raw) {
    const value = String(raw || "");
    const pivot = value.search(/[|｜]/);
    if (pivot < 0) return null;
    const left = value.slice(0, pivot).trim();
    const right = value.slice(pivot + 1).trim();
    return left && right ? { left, right } : null;
}
function parseVerticalColorNames(raw) {
    const value = String(raw || "");
    const match = value.match(/::|：：/);
    if (!match) return null;
    const top = value.slice(0, match.index).trim();
    const bottom = value.slice(match.index + match[0].length).trim();
    return top && bottom ? { top, bottom } : null;
}
function changeLineupVariantCount(entry, mode, focusRight = false) {
    entry.rowMode = ["dual", "vertical"].includes(mode) ? mode : "single";
    renderQueues(); requestLayout();
    if (focusRight && entry.rowMode !== "single") {
        const currentRow = Array.from(document.querySelectorAll('#lineupItems .file-item'))
            .find(row => row.dataset.filePath === entry.path);
        currentRow?.querySelector('[data-color-side="right"]')?.focus();
    }
}
function applyVerticalNames(entry, names) {
    entry.colorName = names.top;
    entry.colorNameRight = names.bottom;
    changeLineupVariantCount(entry, "vertical", true);
}
function applyDualNames(entry, names) {
    entry.colorName = names.left;
    entry.colorNameRight = names.right;
    changeLineupVariantCount(entry, "dual", true);
}
function makeRow(entry, section, i) {
    const row = document.createElement("div");
    const selected = entry.path === state.selected;
    row.className = `file-item${selected ? " selected" : ""}`;
    row.dataset.filePath = entry.path;
    row.dataset.section = section;
    row.draggable = section !== "single" && !state.busy;
    const count = document.createElement("span"); count.className = "number"; count.textContent = i + 1;
    row.appendChild(count);
    const photo = document.createElement("img"); photo.className = "thumb"; photo.alt = ""; photo.dataset.thumbPath = entry.path;
    photo.dataset.thumbKey = thumbKey(entry);
    photo.src = thumbs.get(thumbKey(entry)) || "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='48'%20height='48'%3E%3Crect%20width='48'%20height='48'%20fill='%231b2329'/%3E%3Cpath%20d='M13%2013h22v22H13z'%20fill='none'%20stroke='%23778690'/%3E%3C/svg%3E";
    row.appendChild(photo);
    const copy = document.createElement("div"); copy.className = "file-copy";
    const title = document.createElement("strong"); title.textContent = entry.name;
    const meta = document.createElement("small");
    meta.textContent = section === "single" ? "Top section · 600 x 600" : section === "lineup"
        ? (entry.rowMode === "vertical" ? `Image ${i+1} · full row · TOP / BOTTOM · original caption spacing`
            : entry.rowMode === "dual" ? `Image ${i + 1} · full row · LEFT / RIGHT · 2 × 28 px labels`
            : `Variation ${i + 1} · 1 column · proportional height · 28 px name`)
        : `Detail ${i + 1} · box 293 x 293`;
    copy.append(title, meta);
    if (section !== "lineup" && entry.recoveredCaptions?.length) {
        // Single/Details do not have generated 28px name layers. Preserve the
        // removed text as an editable note instead of silently losing it.
        const noteField = document.createElement("label");
        noteField.className = "combine-recovered-note";
        const label = document.createElement("span");
        label.textContent = "Recovered removed text (editable note; not printed on PSD)";
        const input = document.createElement("textarea");
        input.value = entry.recoveredCaptions.join("\n");
        input.disabled = state.busy;
        input.addEventListener("click", event => event.stopPropagation());
        input.addEventListener("input", event => {
            entry.recoveredCaptions = event.target.value.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
        });
        noteField.append(label, input);
        copy.appendChild(noteField);
    }
    if (section === "lineup") {
        const modeRow = document.createElement("div"); modeRow.className = "lineup-mode-row";
        const modeTitle = document.createElement("label"); modeTitle.className = "lineup-mode-label";
        const caption = document.createElement("span"); caption.textContent = "Variants in this image";
        const mode = document.createElement("select"); mode.className = "lineup-mode";
        for (const [value, title] of [["single", "1 variant / 1 color name"],
            ["dual", "2 variants — horizontal (LEFT / RIGHT)"],
            ["vertical", "2 variants — vertical (TOP / BOTTOM)"]]) {
            const option = document.createElement("option"); option.value = value; option.textContent = title;
            mode.appendChild(option);
        }
        mode.value = ["dual", "vertical"].includes(entry.rowMode) ? entry.rowMode : "single";
        mode.disabled = state.busy;
        mode.addEventListener("click", event => event.stopPropagation());
        mode.addEventListener("change", event => {
            changeLineupVariantCount(entry, event.target.value, event.target.value !== "single");
        });
        modeTitle.append(caption, mode);
        modeRow.appendChild(modeTitle);
        const quick = document.createElement("button"); quick.type = "button";
        quick.className = "lineup-add-variant";
        quick.textContent = mode.value !== "single" ? "− Use 1 color only" : "+ Add 2nd color name";
        quick.title = mode.value !== "single" ? "Change this image back to one variant" : "Show a separate second color-name field";
        quick.disabled = state.busy;
        quick.addEventListener("click", event => {
            event.stopPropagation();
            const next = entry.rowMode !== "single" ? "single" : "dual";
            changeLineupVariantCount(entry, next, next === "dual");
        });
        modeRow.appendChild(quick);
        copy.appendChild(modeRow);
        const names = document.createElement("div");
        names.className = `lineup-name-fields${mode.value !== "single" ? " is-dual" : ""}`;
        function colorField(side, title, placeholder, value, onInput) {
            const field = document.createElement("label"); field.className = "lineup-color-field";
            const heading = document.createElement("span"); heading.textContent = title;
            const input = document.createElement("input"); input.type = "text";
            input.className = "name-edit"; input.dataset.colorSide = side;
            input.placeholder = placeholder; input.maxLength = 120;
            input.value = value || ""; input.disabled = state.busy;
            input.addEventListener("click", event => event.stopPropagation());
            input.addEventListener("input", event => { onInput(event.target.value); requestLayout(); });
            field.append(heading, input);
            names.appendChild(field);
            return input;
        }
        const isVertical = mode.value === "vertical";
        const isDual = mode.value !== "single";
        const left = colorField("left", isVertical ? "Color 1 — TOP" : isDual ? "Color 1 — LEFT" : "Color name",
            isVertical ? "TOP color name (required)" : isDual ? "LEFT color name (required)" : "Enter name; paste LEFT | RIGHT or TOP :: BOTTOM",
            entry.colorName, value => { entry.colorName = value; });
        // Pasting two names also enables the second field automatically. This
        // works even when the original image was imported in 1-variant mode.
        left.addEventListener("paste", event => {
            const value = event.clipboardData?.getData("text/plain");
            const vertical = parseVerticalColorNames(value);
            const horizontal = parseDualColorNames(value);
            if (!vertical && !horizontal) return;
            event.preventDefault(); event.stopPropagation();
            if (vertical) applyVerticalNames(entry, vertical);
            else applyDualNames(entry, horizontal);
        });
        left.addEventListener("change", () => {
            const vertical = parseVerticalColorNames(left.value);
            const horizontal = parseDualColorNames(left.value);
            if (vertical) applyVerticalNames(entry, vertical);
            else if (horizontal) applyDualNames(entry, horizontal);
        });
        if (isDual) {
            colorField("right", isVertical ? "Color 2 — BOTTOM" : "Color 2 — RIGHT",
                isVertical ? "BOTTOM color name (required)" : "RIGHT color name (required)",
                entry.colorNameRight, value => { entry.colorNameRight = value; });
        }
        copy.appendChild(names);
        if (isVertical) {
            const positions = document.createElement("div"); positions.className = "lineup-vertical-positions";
            const caption = document.createElement("p"); caption.textContent =
                "Text position (% of original image height). Use the original erased caption positions; preview before generating.";
            positions.appendChild(caption);
            for (const [side, title, key, fallback] of [
                ["top", "TOP text Y (%)", "captionTopY", 0.44],
                ["bottom", "BOTTOM text Y (%)", "captionBottomY", 0.925]
            ]) {
                const field = document.createElement("label"); field.textContent = title;
                const input = document.createElement("input"); input.type = "number";
                input.dataset.captionPosition = side; input.min = side === "top" ? "5" : "15";
                input.max = side === "top" ? "85" : "99"; input.step = "0.5";
                input.value = (100 * (entry[key] ?? fallback)).toFixed(1).replace(/\.0$/, "");
                input.disabled = state.busy;
                input.addEventListener("click", event => event.stopPropagation());
                input.addEventListener("input", () => {
                    if (input.value !== "") entry[key] = Number(input.value) / 100;
                    requestLayout();
                });
                field.appendChild(input); positions.appendChild(field);
            }
            copy.appendChild(positions);
        }
    }
    copy.addEventListener("click", () => setActivePreview(entry));
    row.appendChild(copy);
    const tools = document.createElement("div"); tools.className = "tools";
    if (section !== "single") {
        tools.append(makeButton("↑", "Move earlier", () => move(section, i, -1)),
            makeButton("↓", "Move later", () => move(section, i, 1)));
    }
    tools.append(makeButton("×", "Remove from Combine", () => remove(section, i), "danger"));
    row.appendChild(tools);
    if (section !== "single") {
        row.addEventListener("dragstart", event => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", JSON.stringify({ section, from: i }));
        });
        row.addEventListener("dragover", event => { event.preventDefault(); row.classList.add("drag-over"); });
        row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
        row.addEventListener("drop", event => {
            event.preventDefault(); event.stopPropagation(); row.classList.remove("drag-over");
            try { const data = JSON.parse(event.dataTransfer.getData("text/plain"));
                if (data.section === section) reorder(section, data.from, i); }
            catch (_) { /* drop from file explorer is handled by upload zones */ }
        });
    }
    scheduleThumb(entry, 360);
    return row;
}
function estimateLineupRows(items) {
    let rows = 0, pending = 0;
    for (const item of items) {
        if (item.rowMode === "dual" || item.rowMode === "vertical") {
            if (pending) { rows++; pending = 0; }
            rows++;
        } else {
            if (++pending === 2) { rows++; pending = 0; }
        }
    }
    return rows + (pending ? 1 : 0);
}
function setAllLineupModes(mode) {
    if (state.busy) return;
    state.lineup.forEach(item => { item.rowMode = mode; });
    renderQueues(); requestLayout();
    note(mode === "vertical" ? "Each Line Up source image now has TOP and BOTTOM color names at original caption positions."
        : mode === "dual" ? "Each Line Up source image now takes one full row. Enter LEFT and RIGHT color names."
        : "Regular Line Up mode restored: two separate images per row.");
}
function renderQueues() {
    for (const [section, id] of [["single", "singleItems"], ["lineup", "lineupItems"], ["details", "detailItems"]]) {
        const target = el(id); target.replaceChildren();
        const list = sectionList(section);
        if (!list.length) {
            const p = document.createElement("p"); p.className = "empty";
            p.textContent = section === "single" ? "No Single selected (optional)." : section === "lineup"
                ? "Line Up is optional — empty section will be skipped." : "No Detail images (optional).";
            target.appendChild(p);
        } else list.forEach((item, index) => target.appendChild(makeRow(item, section, index)));
    }
    el("lineCount").textContent = state.lineup.length
        ? `${state.lineup.length} image(s) · ${estimateLineupRows(state.lineup)} row(s)` : "Optional · skipped";
    el("lineupBulk").hidden = !state.lineup.length;
    el("detailCount").textContent = `${state.details.length} image(s)`;
    refreshButtons();
}
function reorder(section, from, to) {
    if (state.busy || from < 0 || to < 0 || from >= state[section].length || to >= state[section].length || from === to) return;
    const arr = state[section]; const [item] = arr.splice(from, 1); arr.splice(to, 0, item);
    renderQueues(); requestLayout();
}
function move(section, i, shift) { reorder(section, i, i + shift); }
function remove(section, i) {
    if (state.busy) return;
    const removed = section === "single" ? state.single : state[section][i];
    if (section === "single") state.single = null;
    else state[section].splice(i, 1);
    if (removed?.path === state.selected && !allEntries().some(x => x.path === removed.path)) state.selected = null;
    renderQueues(); requestLayout();
}
async function addImages(section, result) {
    const incoming = result?.images || [];
    if (!incoming.length) {
        if (result?.failed?.length) note(result.failed.map(x => `${fileName(x.path)}: ${x.error}`).join(" | "), true);
        return;
    }
    if (section === "single") {
        state.single = incoming[0];
        if (incoming.length > 1) note("Single accepts one image; only the first file was assigned.", true);
    } else {
        const exists = new Set(state[section].map(item => item.path.toLowerCase()));
        for (const item of incoming) {
            if (exists.has(item.path.toLowerCase())) continue;
            exists.add(item.path.toLowerCase());
            state[section].push(section === "lineup" ? { ...item,
                rowMode: item.suggestedLineup?.mode || "single",
                // A cleanup attempt with unreadable OCR explicitly supplies
                // an empty name; never guess a color from *_textclean.png.
                colorName: item.suggestedLineup && Object.prototype.hasOwnProperty.call(item.suggestedLineup, "first")
                    ? item.suggestedLineup.first : suggestColorName(item),
                colorNameRight: item.suggestedLineup?.second || "",
                captionTopY: item.suggestedLineup?.topY,
                captionBottomY: item.suggestedLineup?.bottomY } : item);
        }
    }
    const failed = (result.failed || []).length;
    note(`Added ${incoming.length} image(s) to ${section === "lineup" ? "Line Up" : section === "details" ? "Details" : "Single"}${failed ? ` · ${failed} skipped` : ""}.`);
    renderQueues(); requestLayout();
}
function rakNote(message, error=false) {
    el("rakutenStatus").textContent = message;
    el("rakutenStatus").style.color = error ? "#e39494" : "#b9d9c8";
}
function rakSetBusy(value) { rak.busy=value; renderRakuten(); }
function rakPreview(index) {
    if (!rak.download || rak.previews.has(index) || rak.previewPending.has(index)) return;
    const row = rak.download.images.find(item=>item.index===index);
    if (!row?.path) return;
    rak.previewPending.add(index);
    api.previewRakuten(index, {original:el("rakutenPreviewOriginals").checked}).then(src => { if (src) rak.previews.set(index,src); })
        .catch(()=>{}).finally(()=>{ rak.previewPending.delete(index); renderRakuten(); });
}
function renderRakuten() {
    refreshCleanupButtons();
    const rows=rak.download?.images || rak.scan?.images || [];
    el("rakutenDownload").disabled=rak.busy||state.busy;
    el("rakutenChooseFolder").disabled=rak.busy||state.busy;
    el("rakutenAutoCleanup").disabled=rak.busy||state.busy;
    el("rakutenPreviewOriginals").disabled=rak.busy||state.busy;
    el("rakutenOpenFolder").disabled=rak.busy||state.busy||!rak.download?.folder;
    el("rakutenFolder").textContent=rak.folder||"Windows Downloads (default)";
    el("rakutenScanInfo").textContent=rak.busy?"Processing...":!rak.scan?"Paste URL and click Download":
        `${rows.length} slider images · ${rak.scan.method}`;
    const container=el("rakutenSlideList");container.replaceChildren();
    if (!rows.length) {
        const p=document.createElement("p");p.className="empty";
        p.textContent="Downloaded slide files will appear here in order.";container.appendChild(p);return;
    }
    for (const slide of rows) {
        const row=document.createElement("div");row.className="rakuten-slide"+(slide.status==="failed"?" failed":"");
        const number=document.createElement("span");number.className="rakuten-slide-number";
        number.textContent=String(slide.index).padStart(3,"0");row.appendChild(number);
        const thumb=document.createElement("img");thumb.alt=`Slide ${slide.index}`;thumb.loading="lazy";
        thumb.src=rak.previews.get(slide.index)||slide.url;row.appendChild(thumb);
        const info=document.createElement("div");info.className="slide-copy";
        const name=document.createElement("strong");name.textContent=slide.name;
        const status=document.createElement("small");
        const clean=slide.cleanup;
        const cleanLabel=clean?.status==="cleaned"?` · Cleaned ${clean.removedCount} caption(s)`:clean?.status==="partial"?
            ` · Cleaned ${clean.removedCount}, some need review`:clean?.status==="needs-review"?
            ` · Text cleanup needs review${clean.warning ? ": " + clean.warning : ""}`:clean?.status==="no-caption"?
            " · No safe caption detected": "";
        status.textContent=slide.status==="failed"?`Failed: ${slide.error}`:
            slide.status==="downloaded"?`${slide.width} x ${slide.height} · Original saved${cleanLabel}`:
            "Detected in slider";
        info.append(name,status);row.appendChild(info);container.appendChild(row);
        if (rak.download && slide.status==="downloaded")rakPreview(slide.index);
    }
}
async function rakChooseFolder() {
    if (rak.busy || state.busy) return;
    try { const value=await api.chooseRakutenFolder();if(value)rak.folder=value;renderRakuten(); }
    catch(error){rakNote(error.message||String(error),true);}
}
async function rakDownload() {
    if (rak.busy || state.busy) return;
    const url=el("rakutenUrl").value.trim();
    if (!url) return rakNote("Paste a public Rakuten product or slider URL first.",true);
    rakSetBusy(true);rak.scan=null;rak.download=null;rak.previews.clear();renderRakuten();
    rakNote("Looking for the slider on the Rakuten page...");
    try {
        rak.scan=await api.scanRakuten({url,html:el("rakutenHtml").value.trim()});
        renderRakuten();
        rakNote(`Found ${rak.scan.images.length} slider image(s). Downloading originals...`);
        const autoClean=el("rakutenAutoCleanup").checked;
        const result=await api.downloadRakuten(rak.folder||null,{autoClean});
        rak.download=result;
        const saved=result.images.filter(x=>x.status==="downloaded").length;
        const failed=result.images.length-saved;
        const cleaned=result.images.filter(x=>["cleaned","partial"].includes(x.cleanup?.status)).length;
        const review=result.images.filter(x=>x.cleanup?.status==="needs-review"||x.cleanup?.status==="partial").length;
        rakNote(`Downloaded ${saved}/${result.images.length} original(s) to ${result.folder}.`+
            (autoClean ? ` Cleaned ${cleaned} slide(s) into COMBINE_CLEANED; ${review} need review. OCR may miss captions; inspect the results.` : " Automatic cleanup was off.")+
            (failed ? ` ${failed} download(s) failed.` : "")+" No automatic Combine assignment.", failed>0||review>0);
    } catch(error){rakNote(error.message||String(error),true);}
    finally{rakSetBusy(false);}
}
function wireRakuten() {
    el("rakutenChooseFolder").addEventListener("click",rakChooseFolder);
    el("rakutenPreviewOriginals").addEventListener("change",()=>{rak.previews.clear();renderRakuten();});
    el("rakutenDownload").addEventListener("click",rakDownload);
    el("rakutenOpenFolder").addEventListener("click",async()=>{
        try {await api.openRakutenFolder();}
        catch(error){rakNote(error.message||String(error),true);}
    });
    api.onRakutenProgress?.(p=>{if(p?.name)rakNote(`${p.done}/${p.total}: ${p.name} ${p.status}${p.error?" - "+p.error:""}`,(p?.status==="failed"));});
    renderRakuten();
}

async function pick(section) {
    if (state.busy) return;
    try { await addImages(section, await api.chooseFiles(section)); }
    catch (error) { note(error.message, true); }
}
async function dropImages(section, event) {
    event.preventDefault(); event.stopPropagation();
    if (state.busy) return;
    const files = Array.from(event.dataTransfer?.files || []);
    const paths = files.map(f => api.getPathForFile(f)).filter(Boolean);
    if (!paths.length) { note("Could not resolve dropped file paths. Use the Add Images button.", true); return; }
    try { await addImages(section, await api.addPaths(section === "single" ? paths.slice(0, 1) : paths)); }
    catch (error) { note(error.message, true); }
}
function payload() {
    return { singlePath: state.single?.path || null,
        lineup: state.lineup.map(item => ({ path: item.path,
            rowMode: ["dual", "vertical"].includes(item.rowMode) ? item.rowMode : "single",
            colorName: item.colorName || "", colorNameRight: item.colorNameRight || "",
            captionTopY: item.captionTopY, captionBottomY: item.captionBottomY })),
        details: state.details.map(item => item.path),
        outputName: el("outputName").value.trim(), existingAction: el("saveAction").value };
}
function updateTabs() {
    el("tabFull").classList.toggle("selected", state.view === "full");
    el("tabSelected").classList.toggle("selected", state.view === "selected");
}
function refreshButtons() {
    el("removeSingle").disabled = !state.single || state.busy;
    for (const id of ["chooseSingle", "chooseLineup", "chooseDetails", "clearLineup", "clearDetails", "applyColors", "setAllDual", "setAllVertical", "setAllNormal", "chooseOutput", "reset", "saveAction", "outputName"]) {
        el(id).disabled = state.busy;
    }
    el("bulkColorNames").disabled = state.busy || !state.lineup.length;
    el("applyColors").disabled = state.busy || !state.lineup.length;
    el("setAllDual").disabled = state.busy || !state.lineup.length;
    el("setAllVertical").disabled = state.busy || !state.lineup.length;
    el("setAllNormal").disabled = state.busy || !state.lineup.length;
    el("generate").disabled = state.busy || !state.layout || !state.outputFolder || !!state.error;
    el("generate").textContent = state.busy ? "Generating Combine..." : "Generate Combine";
    el("openOutput").disabled = !state.lastOutput || state.busy;
}
function missingLineupName() {
    for (let i = 0; i < state.lineup.length; i++) {
        const item = state.lineup[i];
        if (!String(item.colorName || "").trim()) {
            return `Line Up image ${i + 1}: enter the ${item.rowMode === "vertical" ? "TOP" : item.rowMode === "dual" ? "LEFT" : "color"} name.`;
        }
        if (["dual", "vertical"].includes(item.rowMode) && !String(item.colorNameRight || "").trim()) {
            return `Line Up image ${i + 1}: enter the ${item.rowMode === "vertical" ? "BOTTOM" : "RIGHT"} color name (2 variants in this image).`;
        }
    }
    return null;
}
function requestLayout() {
    const seq = ++planSeq;
    if (!allEntries().length) {
        state.layout = null; state.error = "Add at least one image to Single, Line Up, or Details.";
        showPlan(); return;
    }
    // An unfinished field is normal while typing. Do not send it to the
    // Electron IPC handler repeatedly, which previously logged the same
    // 'Every Line Up variation needs a color name' exception on each keystroke.
    const missing = missingLineupName();
    if (missing) { state.layout = null; state.error = missing; showPlan(); return; }
    api.layout(payload()).then(layout => {
        if (seq !== planSeq) return;
        state.layout = layout; state.error = null; showPlan();
    }).catch(error => {
        if (seq !== planSeq) return;
        state.layout = null; state.error = error.message || String(error); showPlan();
    });
}
function showPlan() {
    const layout = state.layout;
    el("heightStat").textContent = layout ? `${layout.height.toLocaleString()} px` : "—";
    el("lineStat").textContent = `${state.lineup.length} · ${layout?.lineupRows?.length ?? estimateLineupRows(state.lineup)} rows`;
    el("detailsStat").textContent = `${state.details.length} · ${Math.ceil(state.details.length / 2)} rows`;
    const skipped = layout ? [!state.single && "Single", !state.lineup.length && "Line Up", !state.details.length && "Details"].filter(Boolean) : [];
    const omitted = skipped.length ? `${skipped.join(" / ")} skipped.` : "";
    el("warnings").textContent = state.error || `Ready: ${layout.sourceCount} image layers · ${layout.format.toUpperCase()} + ${layout.jpegCount} JPEG(s).${omitted ? ` ${omitted}` : ""}`;
    el("warnings").classList.toggle("good", !!layout && !state.error);
    el("previewCaption").textContent = layout ? `600 x ${layout.height.toLocaleString()} px · ${!state.lineup.length ? "Line Up skipped · " : ""}source order follows list` : "Add at least one image; all sections are optional.";
    el("previewInfo").textContent = layout ? `JPEG: ${layout.jpegCount} file(s)` : "600 px canvas";
    refreshButtons();
    if (state.view === "full") drawFullPreview();
}
function position(node, x, y, width, height, scale) {
    node.style.left = `${Math.round(x * scale)}px`;
    node.style.top = `${Math.round(y * scale)}px`;
    node.style.width = `${Math.round(width * scale)}px`;
    node.style.height = `${Math.round(height * scale)}px`;
}
function drawFullPreview() {
    const target = el("fullPreview"); target.replaceChildren();
    const layout = state.layout;
    el("previewEmpty").hidden = !!layout;
    if (!layout) { target.hidden = true; return; }
    const screenWidth = Math.max(200, el("previewScreen").clientWidth - 54);
    const scale = Math.min(1, screenWidth / 600);
    target.hidden = false;
    target.style.width = `${Math.round(600 * scale)}px`;
    target.style.height = `${Math.round(layout.height * scale)}px`;
    for (const section of [...(layout.single ? [layout.single] : []), ...layout.lineup, ...layout.details]) {
        const originalEntry = allEntries().find(item => item.path === section.path) || section;
        const data = thumbs.get(thumbKey(originalEntry));
        const layer = document.createElement(data ? "img" : "div");
        layer.className = data ? "composition-image" : "preview-placeholder";
        if (data) { layer.src = data; layer.alt = section.name || "Product image"; }
        else { layer.textContent = "▣"; if (originalEntry) scheduleThumb(originalEntry, 500); }
        position(layer, section.x, section.y, section.placedWidth, section.placedHeight, scale);
        target.appendChild(layer);
    }
    for (const entry of layout.lineup) {
        const labels = entry.labels || [{ lines: entry.labelLines, x: entry.labelX,
            y: entry.labelY, width: entry.labelWidth, height: entry.labelHeight }];
        for (const caption of labels) {
            const label = document.createElement("div"); label.className = "composition-label";
            label.textContent = caption.lines.join("\n");
            label.style.fontSize = `${Math.max(8, Math.round(28 * scale))}px`;
            label.style.lineHeight = `${Math.round(36 * scale)}px`;
            position(label, caption.x, caption.y, caption.width, caption.height, scale);
            target.appendChild(label);
        }
    }
    if (layout.detailsHeader) {
        const heading = document.createElement("div"); heading.className = "composition-heading";
        heading.textContent = "DETAILS";
        heading.style.fontSize = `${Math.round(layout.detailsHeader.fontSize * scale)}px`;
        position(heading, layout.detailsHeader.x, layout.detailsHeader.y, 580, layout.detailsHeader.height, scale);
        target.appendChild(heading);
    }
}
async function showSelected() {
    const seq = ++previewSeq;
    if (state.view !== "selected") return;
    el("fullPreview").hidden = true;
    const item = allEntries().find(x => x.path === state.selected) || allEntries()[0];
    const img = el("selectedPreview");
    if (!item) { img.hidden = true; el("previewEmpty").hidden = false; return; }
    el("previewEmpty").hidden = true;
    el("currentSelection").textContent = item.name;
    img.hidden = false;
    if (!thumbs.has(thumbKey(item))) scheduleThumb(item, 1000);
    if (thumbs.has(thumbKey(item))) img.src = thumbs.get(thumbKey(item));
    else img.removeAttribute("src");
    if (seq !== previewSeq) return;
}
function showFull() {
    state.view = "full"; el("selectedPreview").hidden = true;
    el("currentSelection").textContent = "Full Combine composition · row-major order";
    updateTabs(); drawFullPreview();
}
function switchToSelected() { state.view = "selected"; updateTabs(); showSelected(); }
function toggleBusy(busy) { state.busy = busy; refreshButtons(); renderQueues(); renderRakuten(); refreshCleanupButtons(); }
async function generate() {
    if (state.busy) return;
    try {
        // Request a fresh backend layout. UI preview is advisory only.
        await api.layout(payload());
        toggleBusy(true);
        note("Starting Photoshop Combine generation...", false, "Preparing image layers");
        const result = await api.generate(payload());
        state.lastOutput = result.outputPath;
        note(`Completed ${result.format.toUpperCase()} + ${result.jpegPaths.length} JPEG(s)`, false, fileName(result.outputPath));
        el("openOutput").disabled = false;
    } catch (error) { note(error.message || String(error), true, "No output reported until all files are verified"); }
    finally { toggleBusy(false); }
}
function wire() {
    wireRakuten();
    wireCleanup();
    el("chooseSingle").addEventListener("click", () => pick("single"));
    el("chooseLineup").addEventListener("click", () => pick("lineup"));
    el("chooseDetails").addEventListener("click", () => pick("details"));
    el("removeSingle").addEventListener("click", () => remove("single", 0));
    el("clearLineup").addEventListener("click", () => { state.lineup = []; renderQueues(); requestLayout(); });
    el("clearDetails").addEventListener("click", () => { state.details = []; renderQueues(); requestLayout(); });
    el("setAllDual").addEventListener("click", () => setAllLineupModes("dual"));
    el("setAllVertical").addEventListener("click", () => setAllLineupModes("vertical"));
    el("setAllNormal").addEventListener("click", () => setAllLineupModes("single"));
    el("applyColors").addEventListener("click", () => {
        const names = el("bulkColorNames").value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (!names.length) return note("Paste one color name per line.", true);
        names.forEach((value, i) => {
            const entry = state.lineup[i]; if (!entry) return;
            const vertical = parseVerticalColorNames(value);
            const pair = parseDualColorNames(value);
            if (vertical) {
                entry.rowMode = "vertical";
                entry.colorName = vertical.top;
                entry.colorNameRight = vertical.bottom;
            } else if (pair) {
                // Automatically enable dual/full-row mode on LEFT | RIGHT input.
                entry.rowMode = "dual";
                entry.colorName = pair.left;
                entry.colorNameRight = pair.right;
            } else {
                entry.colorName = value;
            }
        });
        renderQueues(); requestLayout(); note(`Applied names to ${Math.min(names.length, state.lineup.length)} Line Up image(s). LEFT | RIGHT = horizontal; TOP :: BOTTOM = vertical.`);
    });
    for (const zone of document.querySelectorAll(".drop-zone")) {
        const section = zone.dataset.section;
        zone.addEventListener("click", () => pick(section));
        zone.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pick(section); } });
        zone.addEventListener("dragover", event => { if (event.dataTransfer?.types?.includes("Files")) { event.preventDefault(); zone.classList.add("over"); } });
        zone.addEventListener("dragleave", () => zone.classList.remove("over"));
        zone.addEventListener("drop", event => { zone.classList.remove("over"); dropImages(section, event); });
    }
    el("tabFull").addEventListener("click", showFull);
    el("tabSelected").addEventListener("click", switchToSelected);
    el("outputName").addEventListener("input", requestLayout);
    el("chooseOutput").addEventListener("click", async () => {
        try { const result = await api.chooseOutput(); state.outputFolder = result.outputFolder;
            el("outputFolder").textContent = state.outputFolder || "No output folder selected";
            refreshButtons(); }
        catch (error) { note(error.message, true); }
    });
    el("generate").addEventListener("click", generate);
    el("openOutput").addEventListener("click", async () => {
        try { await api.openOutput(); } catch (error) { note(error.message, true); }
    });
    el("reset").addEventListener("click", async () => {
        if (state.busy || (allEntries().length && !confirm("Clear all Combine image lists? Original files are not affected."))) return;
        try { await api.reset(); state.single = null; state.lineup = []; state.details = [];
            state.selected = null; state.layout = null; state.lastOutput = null;
            thumbs.clear(); renderQueues(); requestLayout(); showFull(); note("All Combine lists cleared."); }
        catch (error) { note(error.message, true); }
    });
    api.onProgress(p => { if (p?.message) note(p.message, false, p.completed != null ? `${p.completed}/${p.total}` : String(p.stage || "")); });
    window.addEventListener("resize", () => { if (state.view === "full" && state.layout) drawFullPreview(); });
    window.addEventListener("dragover", e => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
    window.addEventListener("drop", e => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
}
async function init() {
    if (!api) { note("Combine backend is not available. Restart BrandForge after updating.", true); return; }
    wire();
    try { const data = await api.getState(); state.outputFolder = data.outputFolder;
        el("outputFolder").textContent = state.outputFolder || "No output folder selected";
        state.lastOutput = data.lastOutput; }
    catch (error) { note(error.message, true); }
    renderQueues(); requestLayout(); showFull(); renderRakuten();
}
init();
