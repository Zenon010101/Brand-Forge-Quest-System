"use strict";

const api = window.removeBgApp;
const ui = Object.fromEntries([
    "queueList", "queueEmpty", "queueCount", "queueTotal", "queueSummary", "previewName",
    "previewSubtitle", "previewImage", "previewPlaceholder", "previewStage", "qcNote",
    "originalTab", "pngTab", "fitZoom", "actualZoom", "addImages", "removeSelected",
    "clearList", "removeBackground", "addShadow", "overwriteFiles", "progressFill",
    "statusText", "statusCounts", "statusIndicator", "dropOverlay", "dropTarget"
].map(id => [id, document.getElementById(id)]));

const state = {
    items: [], selectedPath: null, previewMode: "original", zoom: "fit",
    busy: false, serverBusy: false, previewRequest: 0, dragCounter: 0,
    thumbnails: new Map(), failedThumbnails: new Set()
};
let thumbnailLoading = false;
let serverSyncTimer = null;
let serverSyncInFlight = false;

function isBusy() {
    return state.busy || state.serverBusy;
}

/**
 * Reconcile the UI from the authoritative main-process queue. This also
 * restores PNG Ready after reloading the embedded module while a batch is
 * running, and prevents permanent disabled buttons when progress is lost.
 */
async function synchronizeQueue() {
    if (!api || !api.getState || serverSyncInFlight) return;
    serverSyncInFlight = true;
    try {
        const snapshot = await api.getState();
        if (!snapshot?.ok || !Array.isArray(snapshot.items)) return;
        const previous = current();
        const prevPath = previous?.path;
        const prevPng = previous?.pngPath;
        const prevStatus = previous?.status;
        state.items = snapshot.items;
        state.serverBusy = !!snapshot.active;
        if (!current()) {
            state.selectedPath = state.items[0]?.path || null;
            state.previewMode = current()?.pngPath ? "png" : "original";
        }
        const selected = current();
        if (!selected?.pngPath && state.previewMode === "png") state.previewMode = "original";
        renderQueue();
        if (prevPath !== selected?.path || prevPng !== selected?.pngPath || prevStatus !== selected?.status) {
            displayPreview();
        }
        if (state.serverBusy && !serverSyncTimer) {
            // A reloaded iframe does not receive the earlier frame's updates.
            // Poll only while an already-running batch still needs recovery.
            serverSyncTimer = setInterval(() => {
                if (!state.busy) void synchronizeQueue();
            }, 1200);
        } else if (!state.serverBusy && serverSyncTimer) {
            clearInterval(serverSyncTimer);
            serverSyncTimer = null;
            if (!state.busy) void loadMissingThumbnails();
        }
    } finally {
        serverSyncInFlight = false;
    }
}

function applyBatchResults(results) {
    if (!Array.isArray(results)) return;
    const byPath = new Map(results.filter(x => x && typeof x.path === "string").map(x => [x.path, x]));
    for (const item of state.items) {
        const result = byPath.get(item.path);
        if (result) Object.assign(item, result);
    }
    renderQueue();
}

const BROWSER_THUMBNAIL_FORMATS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]);

async function loadMissingThumbnails() {
    if (!api || isBusy() || thumbnailLoading) return;
    thumbnailLoading = true;
    try {
        for (const item of state.items) {
            if (isBusy()) break;
            if (BROWSER_THUMBNAIL_FORMATS.has(item.extension) || item.pngUrl ||
                state.thumbnails.has(item.path) || state.failedThumbnails.has(item.path)) continue;
            try {
                const result = await api.getPreview(item.originalPreviewPath || item.path, 150);
                if (result?.ok && state.items.some(x => x.path === item.path)) {
                    state.thumbnails.set(item.path, result.dataUrl);
                    renderQueue();
                } else if (!result?.error?.includes("busy")) {
                    state.failedThumbnails.add(item.path);
                }
            } catch (error) {
                if (!String(error?.message || error).includes("busy")) state.failedThumbnails.add(item.path);
            }
        }
    } finally {
        thumbnailLoading = false;
    }
}

function current() {
    return state.items.find(item => item.path === state.selectedPath) || null;
}

function humanSize(bytes) {
    if (!bytes) return "0 KB";
    return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

function fileKind(item) {
    if (item.status === "Processing...") return "processing";
    if (item.status.includes("Failed")) return "failed";
    if (item.status === "Shadow Ready") return "shadow";
    if (item.status === "PNG Ready") return "png";
    return "original";
}

function setStatus(text, tone = "") {
    ui.statusText.textContent = text;
    ui.statusIndicator.className = `status-indicator ${tone}`.trim();
}

function refreshControls() {
    const selected = current();
    const total = state.items.length;
    const pngReady = state.items.filter(x => !!x.pngPath).length;
    const psdReady = state.items.filter(x => !!x.psdPath).length;
    ui.removeSelected.disabled = isBusy() || !selected;
    ui.clearList.disabled = isBusy() || total === 0;
    ui.addImages.disabled = isBusy();
    ui.overwriteFiles.disabled = isBusy();
    ui.removeBackground.disabled = isBusy() || !state.items.some(x => !x.pngPath);
    ui.addShadow.disabled = isBusy() || !state.items.some(x => !!x.pngPath && !x.psdPath);
    ui.pngTab.disabled = !selected || !selected.pngPath;
    ui.queueCount.textContent = `${total} image${total === 1 ? "" : "s"}`;
    ui.queueTotal.textContent = String(total);
    ui.statusCounts.textContent = `${pngReady} PNG ready · ${psdReady} PSD ready`;
    ui.queueSummary.textContent = total
        ? `${pngReady} cutouts · ${psdReady} shadows · ${state.items.filter(x => x.status.includes("Failed")).length} failures`
        : "JPG, JPEG, PNG, WEBP, TIFF, BMP, GIF, PSD, PSB, TGA, HEIC";
    ui.originalTab.classList.toggle("active", state.previewMode === "original");
    ui.originalTab.setAttribute("aria-pressed", String(state.previewMode === "original"));
    ui.pngTab.classList.toggle("active", state.previewMode === "png");
    ui.pngTab.setAttribute("aria-pressed", String(state.previewMode === "png"));
    ui.fitZoom.classList.toggle("active", state.zoom === "fit");
    ui.actualZoom.classList.toggle("active", state.zoom === "actual");
    ui.fitZoom.setAttribute("aria-pressed", String(state.zoom === "fit"));
    ui.actualZoom.setAttribute("aria-pressed", String(state.zoom === "actual"));
    ui.previewStage.classList.toggle("actual", state.zoom === "actual");
}

function thumbElement(item) {
    const thumb = document.createElement("span");
    thumb.className = "thumb";
    const source = item.pngUrl || item.originalUrl;
    const image = document.createElement("img");
    const fallback = document.createElement("span");
    fallback.className = "no-thumb";
    fallback.textContent = item.extension.replace(".", "").toUpperCase().slice(0, 4);
    if (BROWSER_THUMBNAIL_FORMATS.has(item.extension) || item.pngUrl || state.thumbnails.has(item.path)) {
        image.src = state.thumbnails.get(item.path) || source;
        image.alt = "";
        image.addEventListener("error", () => { image.remove(); thumb.appendChild(fallback); });
        thumb.appendChild(image);
    } else {
        thumb.appendChild(fallback);
    }
    return thumb;
}

function renderQueue() {
    const fragment = document.createDocumentFragment();
    for (const item of state.items) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `queue-row ${item.path === state.selectedPath ? "selected" : ""}`;
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(item.path === state.selectedPath));
        button.dataset.status = fileKind(item);
        button.title = `${item.path}\n${item.message || item.status}`;
        const copy = document.createElement("span");
        copy.className = "row-info";
        const name = document.createElement("strong");
        name.textContent = item.name;
        const status = document.createElement("span");
        status.textContent = item.status;
        copy.append(name, status);
        button.append(thumbElement(item), copy);
        button.addEventListener("click", () => selectItem(item.path));
        fragment.appendChild(button);
    }
    ui.queueList.replaceChildren(fragment);
    ui.queueEmpty.hidden = state.items.length !== 0;
    refreshControls();
}

function showPlaceholder(title, explanation) {
    ui.previewImage.hidden = true;
    ui.previewImage.removeAttribute("src");
    ui.previewPlaceholder.hidden = false;
    ui.previewPlaceholder.querySelector("h2").textContent = title;
    ui.previewPlaceholder.querySelector("p").textContent = explanation;
}

async function displayPreview() {
    const version = ++state.previewRequest;
    const item = current();
    if (!item) {
        ui.previewName.textContent = "Large QC Preview";
        ui.previewSubtitle.textContent = "Select an image to inspect it at a larger size.";
        ui.qcNote.classList.remove("error");
        ui.qcNote.textContent = "Original / transparent PNG comparison is available once Remove Background succeeds.";
        showPlaceholder("Review the whole product", "Check all handles, wheels, straps, corners, edges and fine details before adding a shadow.");
        return;
    }
    if (!item.pngPath && state.previewMode === "png") state.previewMode = "original";
    refreshControls();
    const pngMode = state.previewMode === "png";
    const imagePath = pngMode ? item.pngPath : item.originalPreviewPath || item.path;
    const imageUrl = pngMode ? item.pngUrl : item.originalUrl;
    ui.previewName.textContent = item.name;
    ui.previewSubtitle.textContent = `${pngMode ? "PNG Result" : "Original"} · ${humanSize(item.size)} · ${item.status}`;
    const failed = item.status.includes("Failed");
    ui.qcNote.classList.toggle("error", failed);
    ui.qcNote.textContent = failed
        ? `${item.status}: ${item.message}`
        : pngMode
            ? "Visual QC: inspect all product edges, straps, handles, wheels and fine details. Add Shadow only when satisfied."
            : item.pngPath ? "Compare this original against the PNG Result using the toggle above." : "Remove Background will generate a transparent PNG for QC.";
    showPlaceholder("Loading product preview...", "The original or cutout will appear here.");

    const image = ui.previewImage;
    const applySrc = (src, fallbackAllowed) => {
        if (version !== state.previewRequest) return;
        image.onload = () => {
            if (version !== state.previewRequest) return;
            ui.previewPlaceholder.hidden = true;
            image.hidden = false;
        };
        image.onerror = async () => {
            if (version !== state.previewRequest) return;
            if (!fallbackAllowed) {
                showPlaceholder("Preview unavailable", "The file is saved on disk, but this preview could not be rendered. Check the file in Photoshop.");
                return;
            }
            try {
                const response = await api.getPreview(imagePath, 2400);
                if (version !== state.previewRequest) return;
                if (!response?.ok) throw new Error(response?.error || "Could not render preview.");
                applySrc(response.dataUrl, false);
            } catch (error) {
                if (version === state.previewRequest) showPlaceholder("Preview unavailable", error?.message || String(error));
            }
        };
        image.src = src;
    };

    // Photoshop-specific TIFF/PSD/HEIC types require a preview composite.
    // PNG Result always displays the FULL exported file, never a proxy.
    const needsComposite = !pngMode && [".tif", ".tiff", ".psd", ".psb", ".tga", ".heic", ".heif"].includes(pathExtension(imagePath));
    if (needsComposite) {
        try {
            const response = await api.getPreview(imagePath, 2400);
            if (version !== state.previewRequest) return;
            if (!response?.ok) throw new Error(response?.error || "Could not render preview.");
            applySrc(response.dataUrl, false);
            state.thumbnails.set(item.path, response.dataUrl);
            renderQueue();
            ui.previewSubtitle.textContent += " · preview composite";
        } catch (error) {
            if (version === state.previewRequest) showPlaceholder("Preview unavailable", error?.message || String(error));
        }
    } else {
        // A different cache key forces reloading freshly exported PNGs.
        applySrc(imageUrl + (imageUrl.includes("?") ? "&" : "?") + `gws=${Date.now()}`, true);
    }
}

function pathExtension(p) {
    const name = String(p || "").split(/[\\/]/).pop();
    const i = name.lastIndexOf(".");
    return i < 0 ? "" : name.slice(i).toLowerCase();
}

function selectItem(path) {
    if (state.selectedPath !== path) {
        state.selectedPath = path;
        state.previewMode = current()?.pngPath ? "png" : "original";
    }
    renderQueue();
    displayPreview();
}

function setZoom(zoom) {
    state.zoom = zoom;
    refreshControls();
}

async function acceptAddition(result) {
    if (!result) return;
    state.items.push(...(result.added || []));
    if (result.added?.length && !state.selectedPath) {
        state.selectedPath = result.added[0].path;
        state.previewMode = result.added[0].pngPath ? "png" : "original";
    }
    renderQueue();
    displayPreview();
    // TIFF and PSD cannot be displayed natively by Chromium. Load their real
    // composite thumbnails lazily, with one Photoshop request at a time.
    void loadMissingThumbnails();
    if (result.rejected?.length) {
        const details = result.rejected.slice(0, 3).map(x => `${x.name}: ${x.reason}`).join(" | ");
        setStatus(`${result.rejected.length} image(s) could not be added. ${details}`, "error");
    } else if (result.added?.length) {
        const recovered = result.added.filter(x => !!x.pngPath).length;
        const remaining = result.added.length - recovered;
        setStatus(recovered
            ? `${recovered} existing transparent PNG(s) loaded for QC; ${remaining} original(s) still need Remove Background. Inspect PNG Result, then select Add Shadow.`
            : `${result.added.length} image(s) added. Step 1: Remove Background.`, "success");
    } else if (result.skipped?.length) {
        setStatus("These images are already in the queue.");
    }
}

async function removeQueueItems(paths) {
    if (isBusy() || !paths.length) return;
    try {
        await api.forget(paths);
        const deleteSet = new Set(paths);
        state.items = state.items.filter(item => !deleteSet.has(item.path));
        for (const path of deleteSet) {
            state.thumbnails.delete(path);
            state.failedThumbnails.delete(path);
        }
        if (!current()) {
            state.selectedPath = state.items[0]?.path || null;
            state.previewMode = "original";
        }
        renderQueue();
        displayPreview();
        setStatus(paths.length === 1 ? "Image removed from queue (disk files were not deleted)." : "Queue cleared (disk files were not deleted).");
    } catch (error) {
        setStatus(error?.message || String(error), "error");
    }
}

async function startBatch(phase) {
    if (!api || isBusy()) return;
    const eligible = state.items.filter(item => phase === "remove" ? !item.pngPath : !!item.pngPath && !item.psdPath);
    if (!eligible.length) return;
    state.busy = true;
    ui.progressFill.style.width = "0%";
    renderQueue();
    setStatus(phase === "remove" ? "Removing backgrounds..." : "Creating editable contact shadows...", "busy");
    try {
        const payload = { paths: eligible.map(x => x.path), overwrite: ui.overwriteFiles.checked };
        const response = phase === "remove" ? await api.removeBackground(payload) : await api.addShadow(payload);
        if (!response?.ok) throw new Error(response?.error || "Batch did not run.");
        // Critical fallback: event.sender.send() from the earlier version
        // targeted the parent window rather than this iframe. Even if no
        // progress events arrive, the invoke response contains each final
        // file state and must enable Add Shadow for successful PNGs.
        applyBatchResults(response.results);
        if (phase === "remove" && current()?.pngPath) state.previewMode = "png";
        ui.progressFill.style.width = "100%";
        setStatus(phase === "remove"
            ? `${response.success} PNG(s) ready for QC; ${response.failed} failed. No shadows were added. Open PNG Result to inspect.`
            : `${response.success} PSD(s) ready; ${response.failed} failed. Main Smart Object + separate Shadow.`,
            response.failed ? "error" : "success");
    } catch (error) {
        setStatus(error?.message || String(error), "error");
    } finally {
        state.busy = false;
        try {
            await synchronizeQueue();
        } catch (syncError) {
            // Do not discard the final invoke results if state refresh fails.
            if (!state.items.some(item => item.pngPath || item.psdPath)) {
                setStatus(`Could not refresh the queue: ${syncError?.message || syncError}`, "error");
            }
        }
        renderQueue();
        displayPreview();
        void loadMissingThumbnails();
    }
}

if (api) {
    api.onProgress(payload => {
        const item = state.items.find(entry => entry.path === payload.path);
        if (!item) return;
        if (payload.status === "processing") {
            item.status = "Processing...";
            item.message = payload.message;
        } else if (payload.status === "stage") {
            item.message = payload.message;
        } else if (payload.result) {
            Object.assign(item, payload.result);
        }
        const percent = payload.total ? Math.round((payload.current - (payload.status === "done" || payload.status === "failed" ? 0 : 1)) / payload.total * 100) : 0;
        ui.progressFill.style.width = `${percent}%`;
        setStatus(`${payload.phase === "remove" ? "Remove Background" : "Add Shadow"} · ${payload.current}/${payload.total} · ${payload.message || item.status}${payload.status === "failed" ? ` · ${item.message}` : ""}`,
            payload.status === "failed" ? "error" : "busy");
        renderQueue();
        if ((payload.status === "done" || payload.status === "failed") && item.path === state.selectedPath) {
            if (payload.phase === "remove" && payload.status === "done") state.previewMode = "png";
            displayPreview();
        }
    });

    ui.addImages.addEventListener("click", async () => {
        if (isBusy()) return;
        try { await acceptAddition(await api.selectImages()); }
        catch (error) { setStatus(error?.message || String(error), "error"); }
    });
    ui.removeSelected.addEventListener("click", () => removeQueueItems(state.selectedPath ? [state.selectedPath] : []));
    ui.clearList.addEventListener("click", () => removeQueueItems(state.items.map(item => item.path)));
    ui.removeBackground.addEventListener("click", () => startBatch("remove"));
    ui.addShadow.addEventListener("click", () => startBatch("shadow"));
    ui.originalTab.addEventListener("click", () => { state.previewMode = "original"; displayPreview(); });
    ui.pngTab.addEventListener("click", () => { if (current()?.pngPath) { state.previewMode = "png"; displayPreview(); } });
    ui.fitZoom.addEventListener("click", () => setZoom("fit"));
    ui.actualZoom.addEventListener("click", () => setZoom("actual"));

    const dragHandlers = ["dragenter", "dragover", "dragleave", "drop"];
    for (const name of dragHandlers) {
        document.addEventListener(name, event => {
            event.preventDefault();
            event.stopPropagation();
        });
    }
    document.addEventListener("dragenter", event => {
        if (isBusy() || !event.dataTransfer?.types?.includes("Files")) return;
        state.dragCounter++;
        ui.dropOverlay.hidden = false;
    });
    document.addEventListener("dragover", event => {
        if (isBusy()) return;
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    document.addEventListener("dragleave", () => {
        state.dragCounter = Math.max(0, state.dragCounter - 1);
        if (state.dragCounter === 0) ui.dropOverlay.hidden = true;
    });
    document.addEventListener("drop", async event => {
        state.dragCounter = 0;
        ui.dropOverlay.hidden = true;
        if (isBusy()) return;
        try {
            const paths = Array.from(event.dataTransfer?.files || [])
                .map(file => { try { return api.getPathForFile(file); } catch (ignore) { return ""; } })
                .filter(Boolean);
            if (!paths.length) throw new Error("No local image files found. Drag images from File Explorer.");
            await acceptAddition(await api.addPaths(paths));
        } catch (error) { setStatus(error?.message || String(error), "error"); }
    });
    void synchronizeQueue().catch(error => {
        setStatus(`Could not restore the image queue: ${error?.message || error}`, "error");
    });
} else {
    setStatus("The Remove Background preload API is unavailable. Restart the Electron app.", "error");
}
renderQueue();
displayPreview();
