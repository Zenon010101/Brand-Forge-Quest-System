/* Folderless Amazon UI: virtual source groups, no source file moves/renames.
 * The existing Amazon engine renders every source set and clones outputs for
 * shared IDs. All Photoshop, PSD, Colorbox and EXP logic stays server-side. */
(() => {
    "use strict";
    const api = window.amazonApp || (() => {
        try { return window.parent && window.parent.amazonApp; }
        catch (error) { return null; }
    })();
    const sharing = window.AmazonSharing;
    const formatFilters = window.BrandForgeImageFilters;
    const selectionOrder = window.BrandForgeSelectionOrder;
    const sharingEditor = window.BrandForgeBatchSharingEditor;
    const $ = id => document.getElementById(id);
    if (!api || !sharing || !formatFilters || !selectionOrder || !sharingEditor) return;

    const folderTab = $("folderModeTab");
    const batchTab = $("batchModeTab");
    const folderPanel = $("folderModeContent");
    const batchPanel = $("batchModeContent");
    const batchDropZone = $("batchDropZone");
    const imagePool = $("batchImagePool");
    const groupList = $("batchGroupList");
    const orderList = $("batchOrderList");
    const generate = $("batchGenerateBtn");
    const pool = new Map();
    const thumbnails = new Map();
    const thumbnailJobs = [];
    let thumbnailsActive = 0;
    let groups = [];
    let activeUid = null;
    const selectedPool = selectionOrder.createOrderedSelection(8);
    let scanningFolder = false;
    let outputFolder = "";
    let isBusy = false;
    let previewToken = 0;
    let nextUid = 1;
    let mode = "batch";
    let editingShareUid = null;
    let shareModalReturnFocus = null;

    const acceptedFilePath = file => {
        try { return api.getPathForFile(file) || ""; }
        catch (error) { return ""; }
    };
    const norm = value => String(value || "").replace(/\\/g, "/").toLowerCase();
    const el = (tag, className, text) => {
        const n = document.createElement(tag);
        if (className) n.className = className;
        if (text !== undefined) n.textContent = text;
        return n;
    };
    const group = () => groups.find(g => g.uid === activeUid) || null;
    const assigned = () => new Set(groups.flatMap(g => g.files.map(norm)));
    const totalIds = () => groups.reduce((sum, g) => sum + 1 + g.sharedIds.length, 0);

    function setMode(value) {
        if (isBusy) return;
        closeBatchShareModal();
        mode = value;
        folderPanel.classList.toggle("hidden", mode !== "folder");
        batchPanel.classList.toggle("hidden", mode !== "batch");
        folderTab.classList.toggle("current", mode === "folder");
        batchTab.classList.toggle("current", mode === "batch");
        folderTab.setAttribute("aria-pressed", String(mode === "folder"));
        batchTab.setAttribute("aria-pressed", String(mode === "batch"));
        $("amazonHeaderTitle").textContent = mode === "batch" ? "Amazon Batch Workspace" : "Amazon Generator — Folder Mode";
        $("amazonHeaderSubtitle").textContent = mode === "batch"
            ? "Scan a source path, filter image types, pick in the correct order, and Generate Amazon."
            : "Original folder-based Amazon workflow. Existing processing, sharing and Colorbox rules are unchanged.";
    }
    folderTab.addEventListener("click", () => setMode("folder"));
    batchTab.addEventListener("click", () => setMode("batch"));

    function status(title, description = "", error = false) {
        $("batchStatus").textContent = title;
        $("batchStatusDetail").textContent = description;
        $("batchStatusDot").classList.toggle("error", error);
        $("batchStatusDot").classList.toggle("busy", isBusy && !error);
    }
    function busy(value) {
        isBusy = Boolean(value);
        for (const btn of batchPanel.querySelectorAll("button, input, textarea, select")) btn.disabled = isBusy;
        folderTab.disabled = isBusy;
        generate.disabled = isBusy;
        if (!isBusy) { renderSummary(); updatePoolSelection(); }
    }

    function newGroup(id = "") {
        const item = { uid: nextUid++, id, files: [], sharedIds: [] };
        groups.push(item);
        activeUid = item.uid;
        renderAll();
        return item;
    }
    // Deleting a virtual group never touches the imported files on disk or
    // the image library. Confirm when this group has work attached to it.
    function deleteGroup(uid) {
        if (isBusy) return;
        const index = groups.findIndex(item => item.uid === uid);
        if (index < 0) return;
        const item = groups[index];
        const name = item.id.trim() || "(unnamed group)";
        if ((item.files.length || item.sharedIds.length) && !confirm(
            `Delete product group "${name}"?\n\n` +
            `${item.files.length} assigned image(s) and ${item.sharedIds.length} shared ID(s) will be removed from this group.\n` +
            "Original images will remain in the library and on your computer."
        )) return;
        if (editingShareUid === uid) closeBatchShareModal();
        groups.splice(index, 1);
        if (activeUid === uid) {
            activeUid = groups[Math.min(index, groups.length - 1)]?.uid ?? null;
            selectedPool.clear();
            // Prevent an in-flight preview from showing the removed group's image.
            ++previewToken;
            $("batchPreviewImage").removeAttribute("src");
            $("batchPreviewImage").classList.add("hidden");
            $("batchPreviewPlaceholder").textContent = "Click a source image to inspect it.";
            $("batchPreviewPlaceholder").classList.remove("hidden");
            $("batchPreviewText").textContent = "—";
        }
        renderAll();
        status(`Deleted product group: ${name}`,
            `${item.sharedIds.length} linked ID(s) removed. Imported images and source files were not deleted.`);
    }
    // Batch Workspace has its own Share Images dialog. The original Folder
    // Mode dialog and Photoshop/Colorbox processing pipeline remain untouched.
    function openBatchShareModal(uid, trigger = null) {
        if (isBusy) return;
        const item = groups.find(g => g.uid === uid);
        if (!item) return;
        activeUid = uid;
        editingShareUid = uid;
        shareModalReturnFocus = trigger;
        renderAll();
        $("batchShareSourceSummary").textContent = `${item.id || "(enter Product ID)"} · ${item.files.length}/8 images selected. Linked IDs reuse Image 1 (Colorbox source) and the exact selected order.`;
        $("batchShareIdsInput").value = item.sharedIds.join("\n");
        $("batchShareModalBackdrop").classList.remove("hidden");
        refreshBatchShareValidation();
        $("batchShareIdsInput").focus();
    }
    function closeBatchShareModal() {
        if (editingShareUid === null) return;
        const uid = editingShareUid;
        editingShareUid = null;
        $("batchShareModalBackdrop").classList.add("hidden");
        const fallback = groupList.querySelector(`[data-share-uid="${uid}"]`);
        if (shareModalReturnFocus?.isConnected) shareModalReturnFocus.focus();
        else if (fallback) fallback.focus();
        shareModalReturnFocus = null;
    }
    function refreshBatchShareValidation() {
        const item = groups.find(g => g.uid === editingShareUid);
        if (!item) return;
        const result = sharingEditor.preview(groups, item.uid, $("batchShareIdsInput").value);
        $("batchShareApplyBtn").disabled = isBusy || !result.ok;
        $("batchShareCountSummary").textContent = `${result.sharedCount} shared IDs · ${result.sharedJpgCount} shared JPGs`;
        $("batchShareValidation").classList.toggle("invalid", !result.ok);
        $("batchShareValidation").textContent = result.ok
            ? `${result.ids.length ? "IDs validated. Existing outputs will be checked before processing." : "No shared IDs. Apply to clear sharing."}${result.warning ? "\n" + result.warning : ""}`
            : result.errors.slice(0, 10).join("\n");
        $("batchShareOutputPreview").textContent = result.outputPreview;
    }
    function applyBatchShareModal() {
        if (isBusy || editingShareUid === null) return;
        const item = groups.find(g => g.uid === editingShareUid);
        if (!item) return;
        const result = sharingEditor.preview(groups, item.uid, $("batchShareIdsInput").value);
        if (!result.ok) { refreshBatchShareValidation(); return; }
        item.sharedIds = [...result.ids];
        closeBatchShareModal();
        renderAll();
        status(`${result.ids.length} shared ID(s) linked to ${item.id || "Product Group"}`,
            result.sourceCount
                ? `Image 1 is Colorbox source. ${result.sharedJpgCount} shared JPG(s) planned; Generate Colorbox / Skip remains optional.`
                : `Sharing saved. Assign the source images before Generate Amazon.`);
    }
    function renderGroupList() {
        groupList.replaceChildren();
        if (!groups.length) {
            groupList.append(el("div", "empty-state", "Add Product IDs, then assign up to eight images to each."));
            return;
        }
        groups.forEach((item, index) => {
            const row = el("div", "batch-group-entry");
            const button = el("button", `batch-group-card${item.uid === activeUid ? " active" : ""}`);
            button.type = "button";
            button.setAttribute("aria-pressed", String(item.uid === activeUid));
            button.setAttribute("aria-label", `Select product group ${item.id || "unnamed"}`);
            button.append(el("span", "batch-group-number", String(index + 1).padStart(2, "0")));
            const body = el("span", "batch-group-details");
            body.append(el("strong", "", item.id || "(enter Product ID)"));
            body.append(el("small", "", `${item.files.length}/8 images · ${item.sharedIds.length} shared ID(s)`));
            if (item.sharedIds.length) body.append(el("small", "batch-share-names", `Linked: ${item.sharedIds.slice(0, 2).join(", ")}${item.sharedIds.length > 2 ? " …" : ""}`));
            button.append(body);
            button.addEventListener("click", () => {
                activeUid = item.uid;
                selectedPool.clear();
                renderAll();
            });
            button.addEventListener("dragover", event => {
                if (isBusy) return;
                event.preventDefault();
                button.classList.add("drag-over");
            });
            button.addEventListener("dragleave", () => button.classList.remove("drag-over"));
            button.addEventListener("drop", async event => {
                event.preventDefault();
                button.classList.remove("drag-over");
                if (isBusy) return;
                activeUid = item.uid;
                const pathFromPool = event.dataTransfer?.getData("text/x-brandforge-pool");
                if (pathFromPool) addPathsToActive([pathFromPool]);
                else if (event.dataTransfer?.files?.length) await importFiles(event.dataTransfer.files, true);
                renderAll();
            });
            row.append(button);
            const shareButton = el("button", `batch-group-share${item.sharedIds.length ? " has-shares" : ""}`, item.sharedIds.length ? `Share (${item.sharedIds.length})` : "Share");
            shareButton.type = "button";
            shareButton.disabled = isBusy;
            shareButton.dataset.shareUid = String(item.uid);
            shareButton.title = `Share Images from ${item.id || "unnamed group"} to additional Amazon IDs`;
            shareButton.setAttribute("aria-label", `Share Images for ${item.id || "unnamed group"}`);
            shareButton.addEventListener("click", () => openBatchShareModal(item.uid, shareButton));
            row.append(shareButton);
            // Separate button (not nested inside the select button) for clear,
            // accessible one-click removal from the list of Product IDs.
            const remove = el("button", "batch-group-delete", "Delete");
            remove.type = "button";
            remove.disabled = isBusy;
            remove.title = `Delete ${item.id || "unnamed group"} from this batch (does not delete source files)`;
            remove.setAttribute("aria-label", `Delete product group ${item.id || "unnamed"}`);
            remove.addEventListener("click", () => deleteGroup(item.uid));
            row.append(remove);
            groupList.append(row);
        });
    }
    function renderEditor() {
        const item = group();
        $("batchActiveId").value = item?.id || "";
        $("batchSharedIds").value = (item?.sharedIds || []).join("\n");
        $("batchActiveId").disabled = isBusy || !item;
        $("batchSharedIds").disabled = isBusy || !item;
        $("batchShareImagesBtn").disabled = isBusy || !item;
        $("batchSharedCount").textContent = item
            ? `${item.sharedIds.length} shared ID${item.sharedIds.length === 1 ? "" : "s"}` : "0 shared IDs";
        $("batchRemoveGroupBtn").disabled = isBusy || !item;
    }
    function runThumbQueue() {
        while (thumbnailsActive < 2 && thumbnailJobs.length) {
            const task = thumbnailJobs.shift();
            thumbnailsActive++;
            api.getFilePreview(task.path).then(result => {
                if (result?.ok && result.dataUrl) {
                    thumbnails.set(norm(task.path), result.dataUrl);
                    for (const node of imagePool.querySelectorAll(".batch-pool-thumb[data-source-path]")) {
                        if (norm(node.dataset.sourcePath) !== norm(task.path)) continue;
                        node.replaceChildren();
                        const image = el("img");
                        image.src = result.dataUrl;
                        image.alt = task.name;
                        node.append(image);
                    }
                } else if (task.node.isConnected) {
                    task.node.textContent = "Preview unavailable";
                }
            }).catch(() => {
                if (task.node.isConnected) task.node.textContent = "Preview unavailable";
            }).finally(() => { thumbnailsActive--; runThumbQueue(); });
        }
    }
    function thumb(node, file) {
        const key = norm(file.path);
        const cached = thumbnails.get(key);
        if (cached) {
            const img = el("img");
            img.src = cached;
            img.alt = file.name;
            node.append(img);
            return;
        }
        node.append(el("em", "", file.extension.replace(".", "")));
        // Lazy preview: only visible thumbnails request Photoshop/Sharp work.
        node.dataset.sourcePath = file.path;
        thumbnailObserver.observe(node);
    }
    const thumbnailObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const node = entry.target;
            thumbnailObserver.unobserve(node);
            const filePath = node.dataset.sourcePath;
            if (!filePath || thumbnails.has(norm(filePath))) continue;
            thumbnailJobs.push({ path: filePath, node, name: filePath.split(/[\\/]/).pop() });
        }
        runThumbQueue();
    }, { root: imagePool, rootMargin: "100px" });

    function updatePoolSelection() {
        const picked = selectedPool.values();
        const pickedNames = picked.map((key, index) => {
            const file = pool.get(key);
            return `${index + 1}. ${file?.name || key.split(/[\\/]/).pop()}`;
        });
        $("batchSelectionPreview").textContent = picked.length
            ? `PICK ORDER → ${pickedNames.join("  →  ")} · Add Selected preserves this exact order (1 = Main + Colorbox).`
            : "Click images in the order you want: 1 = Main + Colorbox, then 2–8. Filters don't change your picks.";
        const shown = [...pool.values()].filter(file => formatFilters.matchesFile(file, $("batchLibraryFilter").value)).length;
        $("batchPoolCount").textContent = `${shown} of ${pool.size} image(s) visible · ${picked.length}/8 selected in click order`;
        $("batchAssignBtn").disabled = isBusy || !picked.length;
        $("batchClearSelectionBtn").disabled = isBusy || !picked.length;
        for (const tile of imagePool.querySelectorAll(".batch-pool-tile")) {
            const key = tile.dataset.poolKey;
            const position = selectedPool.position(key);
            tile.classList.toggle("selected", position !== 0);
            tile.setAttribute("aria-pressed", String(position !== 0));
            const badge = tile.querySelector(".batch-pool-pick-position");
            if (badge) {
                badge.textContent = String(position || "");
                badge.classList.toggle("hidden", !position);
            }
        }
    }
    function renderPool() {
        // The filter affects only the visible Library, never stored assignments
        // or the user's selection sequence across multiple filter changes.
        const previousScroll = imagePool.scrollTop;
        imagePool.replaceChildren();
        const visible = [...pool.values()].filter(file => formatFilters.matchesFile(file, $("batchLibraryFilter").value));
        if (!visible.length) {
            imagePool.append(el("div", "empty-state", pool.size
                ? "No images match this file type. Switch Show file type to view other imported formats."
                : "Paste an image-folder path and click Scan Images, or drag images in from File Explorer."));
            updatePoolSelection();
            return;
        }
        const alreadyAssigned = assigned();
        for (const file of visible) {
            const key = norm(file.path);
            const tile = el("button", `batch-pool-tile${selectedPool.has(key) ? " selected" : ""}`);
            tile.type = "button";
            tile.draggable = true;
            tile.dataset.poolKey = key;
            tile.setAttribute("aria-pressed", String(selectedPool.has(key)));
            tile.title = file.path;
            const image = el("div", "batch-pool-thumb");
            thumb(image, file);
            tile.append(image);
            const badge = el("span", `batch-pool-pick-position${selectedPool.has(key) ? "" : " hidden"}`, String(selectedPool.position(key) || ""));
            tile.append(badge);
            tile.append(el("strong", "", file.relativePath || file.name));
            tile.append(el("small", "", alreadyAssigned.has(key) ? "Assigned · click or drag" : "Available · click or drag"));
            tile.addEventListener("click", () => {
                if (isBusy || scanningFolder) return;
                const result = selectedPool.toggle(key);
                if (!result.ok) { status("Selection limit reached", result.error, true); return; }
                // Update the badges in place, preserving current scroll and the
                // exact order of clicks. Never sort by filename when adding.
                updatePoolSelection();
                showPreview(file.path);
            });
            tile.addEventListener("dblclick", () => {
                if (!isBusy && !scanningFolder) addPathsToActive([file.path]);
            });
            tile.addEventListener("dragstart", event => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData("text/x-brandforge-pool", file.path);
            });
            imagePool.append(tile);
        }
        imagePool.scrollTop = previousScroll;
        updatePoolSelection();
    }
    function renderOrder() {
        const item = group();
        $("batchArrangeTitle").textContent = item?.id || "Select Product ID";
        $("batchOrderCount").textContent = `${item?.files.length || 0} / 8 · Image 1 = Colorbox source`;
        orderList.replaceChildren();
        if (!item || !item.files.length) {
            orderList.append(el("div", "empty-state", "Click images in the library and Add, or drag them onto this panel."));
            return;
        }
        item.files.forEach((filePath, index) => {
            const file = pool.get(norm(filePath));
            const row = el("div", `batch-order-row${index === 0 ? " first" : ""}`);
            row.draggable = true;
            row.title = filePath;
            row.append(el("span", "batch-order-position", `${index + 1}`));
            const label = el("div", "batch-order-label");
            label.append(el("strong", "", file?.name || filePath.split(/[\\/]/).pop()));
            label.append(el("small", "", index === 0 ? "Main + Colorbox source" : `Amazon image ${index + 1}`));
            label.addEventListener("click", () => showPreview(filePath));
            row.append(label);
            for (const [symbol, delta, hint] of [["↑", -1, "Move Up"], ["↓", 1, "Move Down"]]) {
                const btn = el("button", "", symbol);
                btn.type = "button";
                btn.title = hint;
                btn.disabled = isBusy || (delta === -1 && index === 0) || (delta === 1 && index === item.files.length - 1);
                btn.addEventListener("click", () => moveFile(index, index + delta));
                row.append(btn);
            }
            const remove = el("button", "", "×");
            remove.type = "button";
            remove.title = "Remove from this product only";
            remove.disabled = isBusy;
            remove.addEventListener("click", () => {
                item.files.splice(index, 1);
                renderAll();
            });
            row.append(remove);
            row.addEventListener("dragstart", event => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/x-brandforge-order", String(index));
            });
            row.addEventListener("dragover", event => {
                event.preventDefault();
                row.classList.add("drag-over");
            });
            row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
            row.addEventListener("drop", async event => {
                event.preventDefault();
                event.stopPropagation();
                row.classList.remove("drag-over");
                if (isBusy) return;
                const sourceIndex = event.dataTransfer.getData("text/x-brandforge-order");
                const pathFromPool = event.dataTransfer.getData("text/x-brandforge-pool");
                if (sourceIndex !== "") moveFile(Number(sourceIndex), index);
                else if (pathFromPool) addPathsToActive([pathFromPool], index);
                else if (event.dataTransfer?.files?.length) await importFiles(event.dataTransfer.files, true);
            });
            orderList.append(row);
        });
    }
    function moveFile(start, end) {
        const item = group();
        if (!item || isBusy || start < 0 || end < 0 || start >= item.files.length || end >= item.files.length || start === end) return;
        const [filePath] = item.files.splice(start, 1);
        item.files.splice(end, 0, filePath);
        renderAll();
        showPreview(filePath);
    }
    function renderSummary() {
        const virtual = [{ id: "Batch Workspace", variants: groups.map(g => ({
            id: g.id, files: g.files.map(p => ({ path: p })), sharedIds: g.sharedIds
        })) }];
        const plan = sharing.buildSharingPlan(virtual);
        const missing = groups.filter(g => !g.files.length || !g.id.trim()).length;
        $("batchTotals").textContent = `${groups.length} source sets · ${groups.reduce((s,g)=>s+g.files.length,0)} assigned images · ${totalIds()} total IDs · ${plan.jpgCount} JPGs`;
        generate.disabled = isBusy || scanningFolder || !groups.length || missing > 0 || !outputFolder || !$("batchPsdName").value.trim() || !plan.ok;
        if (!isBusy && !plan.ok) {
            $("batchStatus").textContent = "Check product IDs / image assignments";
            $("batchStatusDetail").textContent = plan.errors.slice(0, 2).join(" · ");
        }
    }
    function renderAll() {
        renderGroupList();
        renderEditor();
        renderPool();
        renderOrder();
        renderSummary();
    }
    function addPathsToActive(paths, at = null) {
        let item = group();
        if (!item) item = newGroup();
        let count = 0;
        for (const p of paths) {
            if (!pool.has(norm(p)) || item.files.some(x => norm(x) === norm(p))) continue;
            if (item.files.length >= 8) break;
            if (Number.isInteger(at)) item.files.splice(at + count++, 0, p);
            else { item.files.push(p); count++; }
        }
        const skipped = paths.filter(p => pool.has(norm(p)) && !item.files.some(x => norm(x) === norm(p))).length;
        if (!count && paths.length) status("Nothing new assigned", "Each group allows up to eight distinct images.", true);
        else if (count) status(`${count} image(s) added`, skipped
            ? `${skipped} image(s) skipped because this product reached the 8-image limit.`
            : `${item.id || "Product"}: ${item.files.length}/8 images · drag to reorder`, Boolean(skipped));
        renderAll();
    }
    async function importFiles(fileList, assign = false) {
        if (isBusy || scanningFolder) return;
        const paths = Array.from(fileList || [], acceptedFilePath).filter(Boolean);
        if (!paths.length) {
            status("No valid file paths received", "Use Import Images to select files through Windows File Explorer.", true);
            return;
        }
        try {
            const answer = await api.inspectBatchImages(paths);
            let added = 0;
            for (const file of answer.files || []) {
                const key = norm(file.path);
                if (pool.has(key)) continue;
                pool.set(key, file);
                added++;
            }
            if (assign) addPathsToActive((answer.files || []).map(f => f.path));
            else renderAll();
            status(`${added} image(s) imported`, (answer.errors || []).length
                ? `${answer.errors.length} skipped: ${(answer.errors || []).slice(0, 2).join(" · ")}`
                : `${pool.size} image(s) in library. Select or drag into a product group.`, Boolean(answer.errors?.length));
        } catch (error) { status("Import failed", error.message || String(error), true); }
    }
    async function showPreview(filePath) {
        const token = ++previewToken;
        $("batchPreviewText").textContent = filePath;
        $("batchPreviewPlaceholder").textContent = "Loading preview...";
        $("batchPreviewPlaceholder").classList.remove("hidden");
        $("batchPreviewImage").classList.add("hidden");
        try {
            const key = norm(filePath);
            let dataUrl = thumbnails.get(key);
            if (!dataUrl) {
                const result = await api.getFilePreview(filePath);
                if (!result?.ok) throw new Error(result?.error || "Preview unavailable");
                dataUrl = result.dataUrl;
                thumbnails.set(key, dataUrl);
            }
            if (token !== previewToken) return;
            $("batchPreviewImage").src = dataUrl;
            $("batchPreviewImage").classList.remove("hidden");
            $("batchPreviewPlaceholder").classList.add("hidden");
        } catch (error) {
            if (token === previewToken) $("batchPreviewPlaceholder").textContent = `Preview unavailable: ${error.message}`;
        }
    }
    async function generateAmazon() {
        if (isBusy || scanningFolder) return;
        const payload = {
            mode: "batch",
            groups: groups.map(item => ({ id: item.id.trim(), files: item.files.map(filePath => ({ path: filePath })), sharedIds: [...item.sharedIds] })),
            outputFolder, psdFileName: $("batchPsdName").value.trim()
        };
        busy(true);
        status("Checking entire batch", "Validating product IDs, physical images, output names and existing files...");
        try {
            const preflight = await api.preflightBatch(payload);
            if (!preflight?.ok) throw new Error((preflight?.errors || ["Batch preflight failed."]).join("\n"));
            const existing = preflight.existingFiles || [];
            if (existing.length) {
                const list = existing.slice(0, 15).join("\n");
                const text = `${existing.length} existing output(s) would be overwritten:\n\n${list}` +
                    (existing.length > 15 ? `\n... plus ${existing.length - 15} more` : "") +
                    "\n\nReplace these exports? Originals are protected and replaced files are backed up per ID.";
                if (!confirm(text)) { status("Batch canceled", "No existing files were changed."); return; }
            }
            status("Generating Amazon JPGs", `${preflight.sourceCount} unique image sets · ${preflight.totalVariants} IDs · ${preflight.jpgCount} JPGs`);
            const result = await api.startProcessing({ ...payload, confirmedExistingFiles: existing });
            if (!result?.ok) throw new Error(result?.error || "Amazon generation failed.");
            const failed = (result.results || []).filter(item => !item.ok);
            let report = `Amazon batch complete\n\nSuccessful IDs: ${result.successful}\nFailed IDs: ${result.failed}` +
                `\nUnique source sets: ${result.sourceSuccessful || 0}\nShared IDs completed: ${result.sharedSuccessful || 0}` +
                `\nOutput: ${result.outputFolder}` +
                `\nMaster PSD: ${result.masterPsdPath || "FAILED / NOT GENERATED"}`;
            if (result.masterPsdError) report += `\nPSD ERROR: ${result.masterPsdError}`;
            failed.forEach(f => { report += `\n${f.variantId}: ${f.error}`; });
            // Preserve the EXISTING post-Amazon Colorbox choice. Image 1 of
            // each successful ID is the exact Amazon JPG used as Colorbox source.
            let colorbox = null;
            if (result.colorboxJobId && result.colorboxEligibleCount > 0) {
                status("Amazon done", "Choose Generate Colorbox or Skip in the next dialog.");
                try { colorbox = await api.offerColorbox(result.colorboxJobId); }
                catch (error) { colorbox = { ok: false, error: error.message || String(error) }; }
            }
            if (colorbox?.skipped) report += "\n\nColorbox: skipped (Amazon JPGs unchanged)";
            else if (colorbox?.ok) report += `\n\nColorbox: ${colorbox.successful} saved, ${colorbox.failed} failed, ${colorbox.skippedFiles || 0} kept`;
            else if (colorbox) report += `\n\nColorbox error: ${colorbox.error}`;
            if (result.progression?.xpEarned) report += `\n\nAmazon EXP: +${result.progression.xpEarned}`;
            if (colorbox?.progression?.xpEarned) report += `\nColorbox EXP: +${colorbox.progression.xpEarned}`;
            alert(report);
            status(failed.length || result.masterPsdError || (colorbox && !colorbox.ok) ? "Finished with warnings" : "Amazon batch finished", `${result.successful} IDs exported · ${result.outputFolder}`, Boolean(failed.length || result.masterPsdError));
        } catch (error) {
            status("Amazon batch failed", error.message || String(error), true);
            alert(`Amazon Batch Workspace error:\n\n${error.message || String(error)}`);
        } finally { busy(false); }
    }

    for (const filter of formatFilters.filters) {
        for (const select of [$("batchScanFormat"), $("batchLibraryFilter")]) {
            const option = document.createElement("option");
            option.value = filter.value;
            option.textContent = filter.label;
            select.append(option);
        }
    }
    $("batchScanFormat").value = "all";
    $("batchLibraryFilter").value = "all";
    $("batchLibraryFilter").addEventListener("change", renderPool);

    async function scanImageLocation() {
        if (isBusy || scanningFolder) return;
        const folderPath = $("batchSourcePath").value.trim();
        if (!folderPath) { status("Choose an image folder", "Paste the folder path or click Browse.", true); return; }
        scanningFolder = true;
        const scanBtn = $("batchScanFolderBtn");
        const browseBtn = $("batchBrowseSourceBtn");
        scanBtn.disabled = true;
        browseBtn.disabled = true;
        $("batchScanSummary").textContent = "Scanning image files...";
        try {
            const format = $("batchScanFormat").value;
            const answer = await api.scanImageFolder({
                folderPath, recursive: $("batchIncludeSubfolders").checked, format
            });
            if (!answer || answer.error) throw new Error(answer?.error || "No scan result received.");
            const newFiles = (answer.files || []).filter(file => !pool.has(norm(file.path)));
            if (pool.size + newFiles.length > 2500) {
                throw new Error("The Image Library supports 2,500 files. Clear unused images or scan a smaller folder / one image type.");
            }
            for (const file of newFiles) pool.set(norm(file.path), file);
            $("batchSourcePath").value = answer.folderPath;
            // The requested scan filter is also shown in the Library. Images
            // from earlier scans remain available when switching to All.
            $("batchLibraryFilter").value = format;
            renderAll();
            const trouble = [...(answer.errors || []), ...(answer.warnings || [])];
            const detail = `${answer.files.length} matching image(s) · ${newFiles.length} newly imported` +
                ` · ${answer.scannedFolders} folder(s) searched` +
                (trouble.length ? ` · ${trouble.length} warning(s)` : "");
            $("batchScanSummary").textContent = detail;
            status("Folder scan complete", trouble.length ? `${detail}. ${trouble.slice(0, 2).join(" | ")}` : detail, Boolean(trouble.length));
        } catch (error) {
            $("batchScanSummary").textContent = `Scan failed: ${error.message || String(error)}`;
            status("Unable to scan image path", error.message || String(error), true);
        } finally {
            scanningFolder = false;
            scanBtn.disabled = false;
            browseBtn.disabled = false;
            renderSummary();
        }
    }
    $("batchScanFolderBtn").addEventListener("click", scanImageLocation);
    $("batchBrowseSourceBtn").addEventListener("click", async () => {
        if (isBusy || scanningFolder) return;
        try {
            const chosen = await api.chooseImageFolder();
            if (chosen?.error) throw new Error(chosen.error);
            if (chosen?.folderPath) {
                $("batchSourcePath").value = chosen.folderPath;
                await scanImageLocation();
            }
        } catch (error) { status("Choose folder failed", error.message || String(error), true); }
    });
    $("batchSourcePath").addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); scanImageLocation(); }
    });
    $("batchClearSelectionBtn").addEventListener("click", () => {
        selectedPool.clear();
        updatePoolSelection();
    });

    $("batchAddGroupBtn").addEventListener("click", () => newGroup());
    $("batchAddIdsBtn").addEventListener("click", () => {
        const ids = sharing.parseSharedIds($("batchBulkIds").value);
        if (!ids.length) { status("Paste Product IDs first", "One ID per line, comma, tab or semicolon.", true); return; }
        const existing = new Set(groups.map(g => sharing.idKey(g.id)));
        const rejected = [];
        let count = 0;
        ids.forEach(id => {
            const issue = sharing.validId(id);
            if (issue || existing.has(sharing.idKey(id))) { rejected.push(`${id}: ${issue || "duplicate ID"}`); return; }
            groups.push({ uid: nextUid++, id, files: [], sharedIds: [] });
            activeUid = groups[groups.length - 1].uid;
            existing.add(sharing.idKey(id));
            count++;
        });
        $("batchBulkIds").value = "";
        renderAll();
        status(`${count} product ID(s) created`, rejected.length ? rejected.slice(0, 2).join(" · ") : "Assign images to each product. No source folders are needed.", Boolean(rejected.length));
    });
    $("batchActiveId").addEventListener("input", event => {
        const item = group();
        if (!item) return;
        item.id = event.target.value;
        renderGroupList();
        renderSummary();
    });
    $("batchSharedIds").addEventListener("input", event => {
        const item = group();
        if (!item) return;
        item.sharedIds = sharing.parseSharedIds(event.target.value);
        renderGroupList();
        renderSummary();
    });
    $("batchShareImagesBtn").addEventListener("click", event => {
        if (group()) openBatchShareModal(activeUid, event.currentTarget);
    });
    $("batchShareIdsInput").addEventListener("input", refreshBatchShareValidation);
    $("batchShareApplyBtn").addEventListener("click", applyBatchShareModal);
    for (const id of ["batchShareCloseBtn", "batchShareCancelBtn"]) {
        $(id).addEventListener("click", closeBatchShareModal);
    }
    $("batchShareModalBackdrop").addEventListener("click", event => {
        if (event.target === $("batchShareModalBackdrop")) closeBatchShareModal();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && editingShareUid !== null) {
            event.preventDefault();
            closeBatchShareModal();
        }
    });
    $("batchRemoveGroupBtn").addEventListener("click", () => deleteGroup(activeUid));
    $("batchPsdName").addEventListener("input", renderSummary);
    $("batchImportBtn").addEventListener("click", async () => {
        if (isBusy || scanningFolder) return;
        try {
            const answer = await api.chooseBatchImages();
            if (!answer?.files?.length && !answer?.errors?.length) return;
            let added = 0;
            for (const file of answer.files || []) {
                const key = norm(file.path);
                if (!pool.has(key)) { pool.set(key, file); added++; }
            }
            renderAll();
            status(`${added} image(s) imported`, answer.errors?.length ? answer.errors.slice(0, 3).join(" · ") : `${pool.size} total. Assign these images to Product IDs.`, Boolean(answer.errors?.length));
        } catch (error) { status("Import failed", error.message || String(error), true); }
    });
    $("batchAssignBtn").addEventListener("click", () => {
        // Pick order, not pool/filename order: third clicked can become Image 1.
        const paths = selectedPool.values().map(key => pool.get(key)?.path).filter(Boolean);
        if (!paths.length) return;
        addPathsToActive(paths);
        selectedPool.clear();
        renderPool();
    });
    $("batchClearPoolBtn").addEventListener("click", () => {
        const inUse = assigned();
        for (const key of pool.keys()) if (!inUse.has(key)) pool.delete(key);
        selectedPool.prune(new Set(pool.keys()));
        renderPool();
        renderSummary();
    });
    $("batchOutputBtn").addEventListener("click", async () => {
        try {
            const result = await api.selectOutputFolder();
            if (result?.folderPath) {
                outputFolder = result.folderPath;
                $("batchOutputPath").textContent = outputFolder;
                $("batchOutputPath").title = outputFolder;
                renderSummary();
            }
        } catch (error) { status("Output folder failed", error.message, true); }
    });
    $("batchGenerateBtn").addEventListener("click", generateAmazon);
    batchDropZone.addEventListener("click", () => $("batchImportBtn").click());
    batchDropZone.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $("batchImportBtn").click(); }
    });
    for (const node of [batchDropZone, orderList, imagePool]) {
        node.addEventListener("dragover", event => {
            if (isBusy) return;
            event.preventDefault();
            if (node === batchDropZone) node.classList.add("drag-over");
        });
        node.addEventListener("dragleave", () => node.classList.remove("drag-over"));
        node.addEventListener("drop", async event => {
            if (isBusy) return;
            if (event.target.closest(".batch-order-row, .batch-group-card")) return;
            event.preventDefault();
            node.classList.remove("drag-over");
            const internal = event.dataTransfer.getData("text/x-brandforge-pool");
            if (internal && node === orderList) addPathsToActive([internal]);
            else if (event.dataTransfer.files?.length) await importFiles(event.dataTransfer.files, node === orderList);
        });
    }
    window.addEventListener("dragover", event => {
        if (mode === "batch" && event.dataTransfer?.types?.includes("Files")) event.preventDefault();
    });
    window.addEventListener("drop", event => {
        if (mode === "batch" && event.dataTransfer?.files?.length) event.preventDefault();
    });
    api.onProcessingProgress(progress => {
        if (!isBusy || !progress) return;
        const labels = {
            "parent-start": "Starting product batch",
            "variant-start": `Rendering ${progress.variantId || "product"}`,
            "image-progress": `${progress.variantId || "Product"} · image ${progress.outputPosition || "?"} · ${progress.status || "processing"}`,
            "shared-start": `Sharing images to ${progress.variantId}`,
            "variant-complete": `${progress.variantId} exported`,
            "variant-error": `Failed: ${progress.variantId}`,
            "psd-start": "Building editable master PSD",
            "psd-complete": "Master PSD saved",
            "psd-error": "Master PSD failed",
            "colorbox-start": "Generating Colorbox images",
            "colorbox-file-complete": `Colorbox ready: ${progress.variantId}`,
            "colorbox-file-error": `Colorbox failed: ${progress.variantId}`
        };
        if (labels[progress.type]) status(labels[progress.type], progress.error || `${progress.current || 0}/${progress.total || 0}`, Boolean(progress.error));
    });
    setMode("batch");
    renderAll();
})();
