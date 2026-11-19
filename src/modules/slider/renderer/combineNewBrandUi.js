"use strict";

// This workflow lives inside the Slider Maker. It never edits, reorders,
// uploads, or cleans the source Slider files; only the reviewed Combine list.
(() => {
    const el = id => document.getElementById(id);
    const panel = el("sliderCombinePanel");
    const api = sliderApi;
    const combine = { items: [], single: null, outputFolder: null, busy: false, imported: false };
    let reviewDragId = null, nextManualImageId = 1;

    function showProgress(message, isError = false) {
        const node = el("sliderCombineProgress");
        node.textContent = String(message || "Ready.");
        node.style.borderColor = isError ? "var(--danger)" : "var(--border)";
    }
    function updatePaths() {
        el("sliderCombineSinglePath").textContent = combine.single?.name || "No Single selected";
        el("sliderCombineSinglePath").title = combine.single?.path || "";
        el("sliderCombineOutputPath").textContent = combine.outputFolder || "Choose where to save";
        el("sliderCombineOutputPath").title = combine.outputFolder || "";
    }
    function sourceUrlByPath() {
        const map = new Map();
        for (const entry of [...state.creative, ...state.detail]) {
            if (entry?.path) map.set(entry.path.toLowerCase(), entry.url);
        }
        for (const row of state.lineupRows) {
            for (let n = 1; n <= 4; n++) {
                const entry = row[`photo${n}`];
                if (entry?.path) map.set(entry.path.toLowerCase(), entry.url);
            }
        }
        return map;
    }
    function setCombinedBusy(busy) {
        combine.busy = busy;
        state.busy = busy;
        panel.querySelectorAll("button,input,select").forEach(control => control.disabled = busy);
        el("sliderCombineOpen").disabled = busy;
        renderCounters();
        if (!busy) renderReview();
        document.dispatchEvent(new CustomEvent("brandforge:project-busy", { detail: { busy } }));
    }
    function resetReview(message) {
        el("sliderCombineReviewed").checked = false;
        if (message) showProgress(message);
    }
    function bySection(section) { return combine.items.filter(item => item.section === section); }
    function moveInsideSection(item, direction) {
        const group = bySection(item.section);
        const index = group.findIndex(x => x.id === item.id);
        const to = index + direction;
        if (to < 0 || to >= group.length) return;
        [group[index], group[to]] = [group[to], group[index]];
        const other = bySection(item.section === "lineup" ? "details" : "lineup");
        combine.items = item.section === "lineup" ? [...group, ...other] : [...other, ...group];
        resetReview("Order updated. Review before generating.");
        renderReview();
    }
    function button(title, onclick) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "mini-btn secondary";
        b.textContent = title;
        b.disabled = combine.busy;
        b.onclick = onclick;
        return b;
    }
    function makeRow(item, groupIndex) {
        const row = document.createElement("div"); row.className = "slider-combine-row";
        const preview = fileThumb({ name: item.name, extension: (item.name.match(/\.[^.]+$/) || [""])[0],
            url: item.url || sourceUrlByPath().get(item.path.toLowerCase()) || "" });
        const handle = document.createElement("div");
        handle.className = "review-drag-handle";
        handle.textContent = "⋮⋮ Drag image to reorder or move to another section";
        handle.draggable = !combine.busy;
        handle.addEventListener("dragstart", event => {
            if (combine.busy) { event.preventDefault(); return; }
            reviewDragId = item.id;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", item.id);
            row.classList.add("dragging");
        });
        handle.addEventListener("dragend", () => {
            reviewDragId = null; row.classList.remove("dragging");
            document.querySelectorAll(".slider-combine-row.drag-over, .slider-combine-list.drag-over")
                .forEach(node => node.classList.remove("drag-over"));
        });
        row.appendChild(handle);
        row.appendChild(preview);
        const info = document.createElement("div");
        const name = document.createElement("div"); name.className = "row-name"; name.textContent = item.name;
        const reason = document.createElement("div"); reason.className = "row-hint"; reason.textContent = item.reason || "Reviewed image";
        info.append(name, reason);
        const actions = document.createElement("div"); actions.className = "row-buttons";
        actions.append(button("Up", () => moveInsideSection(item, -1)));
        actions.append(button("Down", () => moveInsideSection(item, +1)));
        const destination = item.section === "lineup" ? "details" : "lineup";
        actions.append(button(`Move to ${destination === "lineup" ? "Line Up" : "Details"}`, () => {
            window.BrandForgeSliderDnD.moveReviewedItem(combine.items, item.id, destination);
            resetReview("Image classification updated. Review before generating.");
            renderReview();
        }));
        info.appendChild(actions);
        if (item.section === "lineup") {
            const form = document.createElement("div"); form.className = "row-edit";
            const caption = document.createElement("input"); caption.type = "text";
            caption.placeholder = "Color name (optional if already in photo)";
            caption.value = item.colorName || "";
            caption.maxLength = 120;
            caption.oninput = () => { item.colorName = caption.value; resetReview(); };
            const mode = document.createElement("select");
            [["single","1 variant"],["dual","2 horizontal"],["vertical","2 vertical"]].forEach(([value,text]) => {
                const option = document.createElement("option"); option.value = value; option.textContent = text; mode.appendChild(option);
            });
            mode.value = item.rowMode || "single";
            mode.onchange = () => { item.rowMode = mode.value; resetReview(); renderReview(); };
            form.append(caption, mode);
            if (item.rowMode === "dual" || item.rowMode === "vertical") {
                const second = document.createElement("input"); second.type = "text";
                second.className = "row-label-right";
                second.placeholder = item.rowMode === "vertical" ? "BOTTOM color name" : "RIGHT color name";
                second.value = item.colorNameRight || ""; second.maxLength = 120;
                second.oninput = () => { item.colorNameRight = second.value; resetReview(); };
                form.appendChild(second);
                if (item.rowMode === "vertical") {
                    for (const [key,label] of [["captionTopY", "TOP caption Y (0 to 1)"], ["captionBottomY", "BOTTOM caption Y (0 to 1)"]]) {
                        const input = document.createElement("input"); input.type = "number";
                        input.step = "0.01"; input.min = "0"; input.max = "1";
                        input.title = label; input.value = String(item[key]);
                        input.oninput = () => { item[key] = Number(input.value); resetReview(); };
                        form.appendChild(input);
                    }
                }
            }
            info.appendChild(form);
        }
        row.appendChild(info);
        row.addEventListener("dragover", event => {
            if (!reviewDragId || combine.busy) return;
            event.preventDefault(); event.dataTransfer.dropEffect = "move";
            row.classList.add("drag-over");
        });
        row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
        row.addEventListener("drop", event => {
            if (!reviewDragId || combine.busy) return;
            event.preventDefault(); event.stopPropagation(); row.classList.remove("drag-over");
            document.querySelectorAll(".slider-combine-list.drag-over")
                .forEach(node => node.classList.remove("drag-over"));
            if (window.BrandForgeSliderDnD.moveReviewedItem(combine.items, reviewDragId, item.section, item.id)) {
                resetReview("Image order/classification changed. Check the updated order before exporting.");
                renderReview();
            }
            reviewDragId = null;
        });
        return row;
    }
    function renderReview() {
        const line = bySection("lineup"), detail = bySection("details");
        el("sliderCombineLineupCount").textContent = String(line.length);
        el("sliderCombineDetailCount").textContent = String(detail.length);
        el("sliderCombineSummary").textContent = combine.imported
            ? `${line.length} Line Up + ${detail.length} Details. Classification is based on Slider sections, not OCR. Correct and reorder before exporting.`
            : "Import existing Slider images first. Single is uploaded separately.";
        const lists = [["sliderCombineLineupList", line], ["sliderCombineDetailList", detail]];
        for (const [id, entries] of lists) {
            const container = el(id); container.replaceChildren();
            if (!entries.length) {
                const empty = document.createElement("div"); empty.className = "row-hint";
                empty.textContent = "No images in this section."; container.appendChild(empty);
            } else entries.forEach((item, i) => container.appendChild(makeRow(item, i)));
        }
    }
    async function addDroppedToReview(event, section) {
        const incoming = Array.from(event.dataTransfer?.files || []);
        const paths = incoming.map(file => {
            try { return api.getPathForFile(file); } catch (_error) { return ""; }
        }).filter(Boolean);
        if (!paths.length) throw new Error("Drop local image files from Windows Explorer.");
        const result = await api.describeDroppedFiles(paths);
        if (!result?.files?.length) throw new Error(result?.rejected?.join("; ") || "No supported image files were dropped.");
        for (const file of result.files) {
            combine.items.push({
                id: `manual-review-${nextManualImageId++}`,
                path: file.path, name: file.name, url: file.url,
                section, colorName: "", colorNameRight: "", rowMode: "single",
                captionTopY: 0.4, captionBottomY: 0.85,
                reason: "Manually dropped into " + (section === "lineup" ? "Line Up" : "Details")
            });
        }
        combine.items = [...bySection("lineup"), ...bySection("details")];
        combine.imported = true;
        resetReview(`Added ${result.files.length} ${section} image(s). Review order and captions.`);
        renderReview();
        if (result.rejected?.length) showProgress(`Skipped: ${result.rejected.join("; ")}`, true);
    }
    function attachReviewDrop(listId, section) {
        const list = el(listId);
        list.addEventListener("dragover", event => {
            if (combine.busy) return;
            if (reviewDragId || Array.from(event.dataTransfer?.types || []).includes("Files")) {
                event.preventDefault();
                event.dataTransfer.dropEffect = reviewDragId ? "move" : "copy";
                list.classList.add(reviewDragId ? "drag-over" : "file-drag-over");
            }
        });
        list.addEventListener("dragleave", event => {
            if (!list.contains(event.relatedTarget)) list.classList.remove("drag-over", "file-drag-over");
        });
        list.addEventListener("drop", async event => {
            if (combine.busy) return;
            const isFile = Array.from(event.dataTransfer?.types || []).includes("Files");
            if (!reviewDragId && !isFile) return;
            event.preventDefault(); event.stopPropagation();
            list.classList.remove("drag-over", "file-drag-over");
            if (reviewDragId) {
                const id = reviewDragId; reviewDragId = null;
                if (window.BrandForgeSliderDnD.moveReviewedItem(combine.items, id, section)) {
                    resetReview("Moved image to end of " + section + ". Review before exporting.");
                    renderReview();
                }
            } else {
                try { await addDroppedToReview(event, section); }
                catch (error) { showProgress(error.message || String(error), true); }
            }
        });
    }
    attachReviewDrop("sliderCombineLineupList", "lineup");
    attachReviewDrop("sliderCombineDetailList", "details");

    // Single accepts drag-and-drop as well as the existing Choose Single picker.
    const singleTarget = el("sliderCombineSinglePath");
    singleTarget.title = "Drop one Single image here from Windows Explorer";
    singleTarget.addEventListener("dragover", event => {
        if (combine.busy || !Array.from(event.dataTransfer?.types || []).includes("Files")) return;
        event.preventDefault(); singleTarget.classList.add("file-drag-over");
    });
    singleTarget.addEventListener("dragleave", () => singleTarget.classList.remove("file-drag-over"));
    singleTarget.addEventListener("drop", async event => {
        if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
        event.preventDefault(); event.stopPropagation(); singleTarget.classList.remove("file-drag-over");
        if (combine.busy) return;
        try {
            const paths = Array.from(event.dataTransfer.files).map(file => api.getPathForFile(file)).filter(Boolean);
            const result = await api.describeDroppedFiles(paths);
            if (!result.files?.length) throw new Error(result.rejected?.join("; ") || "No supported Single image.");
            combine.single = result.files[0]; updatePaths();
            resetReview("Single selected by drag-and-drop. Review before exporting.");
        } catch (error) { showProgress(error.message || String(error), true); }
    });

    async function importFromSlider() {
        if (combine.busy) return;
        if (combine.items.some(item => String(item.id).startsWith("manual-review-")) &&
            !window.confirm("Re-import Slider images? This replaces images manually dropped into the review.")) return;
        const selected = await api.suggestNewBrandCombine(buildJob());
        const included = selected.items.filter(item =>
            item.section === "lineup" ? el("sliderCombineUseLineup").checked : el("sliderCombineUseDetails").checked);
        combine.items = included;
        combine.imported = true;
        resetReview(`Imported ${included.length} images. Please review Line Up and Details.`);
        renderReview();
    }
    el("sliderCombineOpen").onclick = async () => {
        panel.hidden = false;
        if (!el("sliderCombineName").value.trim()) {
            const code = el("productCode").value.trim();
            if (code) el("sliderCombineName").value = `${code}_COMBINE`;
        }
        if (!combine.imported) await importFromSlider();
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    el("sliderCombineClose").onclick = () => { if (!combine.busy) panel.hidden = true; };
    el("sliderCombineDetect").onclick = () => importFromSlider().catch(error => showProgress(error.message, true));
    el("sliderCombineSingleBtn").onclick = async () => {
        try { const file = await api.chooseNewBrandSingle(); if (file) { combine.single = file; updatePaths(); resetReview("Single selected. Review and generate."); } }
        catch (error) { showProgress(error.message, true); }
    };
    el("sliderCombineSingleClear").onclick = () => { combine.single = null; updatePaths(); resetReview(); };
    el("sliderCombineOutputBtn").onclick = async () => {
        try { const result = await api.chooseNewBrandOutput(); if (result) { combine.outputFolder = result.folderPath; updatePaths(); } }
        catch (error) { showProgress(error.message, true); }
    };
    el("sliderCombineOpenFolder").onclick = async () => {
        if (!combine.outputFolder) return;
        try { await api.openNewBrandOutput(combine.outputFolder); }
        catch (error) { showProgress(error.message, true); }
    };
    el("sliderCombineGenerate").onclick = async () => {
        if (combine.busy) return;
        if (!el("sliderCombineReviewed").checked) {
            showProgress("Review the Line Up and Details first, then check the review confirmation.", true); return;
        }
        if (!combine.single && !combine.items.length) { showProgress("Upload a Single or import Slider images first.", true); return; }
        if (!combine.outputFolder) {
            const result = await api.chooseNewBrandOutput();
            if (!result) { showProgress("Select an output folder to continue.", true); return; }
            combine.outputFolder = result.folderPath; updatePaths();
        }
        const name = el("sliderCombineName").value.trim();
        if (!name) { showProgress("Enter an output name.", true); return; }
        const payload = {
            outputName: name, brandName: el("brandName").value.trim(),
            outputFolder: combine.outputFolder, singlePath: combine.single?.path || null,
            items: combine.items.map(({path,section,colorName,colorNameRight,rowMode,captionTopY,captionBottomY}) =>
                ({path,section,colorName,colorNameRight,rowMode,captionTopY,captionBottomY})),
            publicBaseUrl: el("sliderCombinePublicUrl").value.trim(),
            includePsd: el("sliderCombinePsd").checked
        };
        setCombinedBusy(true);
        el("sliderCombineResults").replaceChildren();
        showProgress("Building New Brand Combine...");
        try {
            const result = await api.generateNewBrandCombine(payload);
            if (!result?.ok) throw new Error(result?.error || "Combine generation failed.");
            const outputs = [`HTML: ${result.htmlPath}`, ...result.jpegPaths.map(p => `JPEG: ${p}`)];
            if (result.psdPath) outputs.push(`Layered PSD/PSB: ${result.psdPath}`);
            if (result.psdWarning) outputs.push(`Warning: ${result.psdWarning}`);
            el("sliderCombineResults").textContent = outputs.join("\n");
            el("sliderCombineResults").style.whiteSpace = "pre-wrap";
            showProgress(result.psdWarning ? "JPEG + HTML saved (Photoshop warning)." : "Combine files saved successfully.");
        } catch (error) { showProgress(`FAILED: ${error.message || error}`, true); }
        finally { setCombinedBusy(false); }
    };
    api.onNewBrandCombineProgress(update => {
        if (update && combine.busy) showProgress(`${update.stage || "Working"}: ${update.message || ""}`,
            update.stage === "error");
    });
    api.getNewBrandCombineSettings().then(settings => {
        if (settings?.outputFolder) { combine.outputFolder = settings.outputFolder; updatePaths(); }
    }).catch(() => {});
    updatePaths();
    renderReview();
})();
