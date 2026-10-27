const sharingRules = window.AmazonSharing;
if (!sharingRules) throw new Error("Amazon Sharing validator is unavailable.");

const amazonApi = window.amazonApp || (() => {
    try { return window.parent && window.parent.amazonApp; } catch (error) { return null; }
})();

if (!amazonApi) {
    throw new Error("Amazon module bridge is unavailable. Restart the unified application.");
}

const selectParentBtn = document.getElementById("selectParentBtn");
const selectOutputBtn = document.getElementById("selectOutputBtn");
const startProcessingBtn = document.getElementById("startProcessingBtn");

const parentPath = document.getElementById("parentPath");
const outputPath = document.getElementById("outputPath");
const psdFileNameInput = document.getElementById("psdFileNameInput");
const scanSummary = document.getElementById("scanSummary");
const sourceTypeFilter = document.getElementById("sourceTypeFilter");
const sourceFilterSummary = document.getElementById("sourceFilterSummary");
const versionLabel = document.getElementById("versionLabel");

const parentCounter = document.getElementById("parentCounter");
const variantCounter = document.getElementById("variantCounter");
const selectedCounter = document.getElementById("selectedCounter");

const variantCount = document.getElementById("variantCount");
const variantList = document.getElementById("variantList");
const checkAllVariantsBtn = document.getElementById("checkAllVariantsBtn");
const uncheckAllVariantsBtn = document.getElementById("uncheckAllVariantsBtn");

const filesTitle = document.getElementById("filesTitle");
const selectedCount = document.getElementById("selectedCount");
const fileList = document.getElementById("fileList");
const checkAllFilesBtn = document.getElementById("checkAllFilesBtn");
const uncheckAllFilesBtn = document.getElementById("uncheckAllFilesBtn");

const previewType = document.getElementById("previewType");
const previewStage = document.getElementById("previewStage");
const previewImage = document.getElementById("previewImage");
const previewName = document.getElementById("previewName");
const previewInfo = document.getElementById("previewInfo");
const previewError = document.getElementById("previewError");

const orderCount = document.getElementById("orderCount");
const orderList = document.getElementById("orderList");

const statusDot = document.getElementById("statusDot");
const appStatus = document.getElementById("appStatus");
const statusSub = document.getElementById("statusSub");

const shareModalBackdrop = document.getElementById("shareModalBackdrop");
const shareModalCloseBtn = document.getElementById("shareModalCloseBtn");
const shareCancelBtn = document.getElementById("shareCancelBtn");
const shareSourceSummary = document.getElementById("shareSourceSummary");
const shareIdsInput = document.getElementById("shareIdsInput");
const shareCountSummary = document.getElementById("shareCountSummary");
const shareValidation = document.getElementById("shareValidation");
const shareOutputPreview = document.getElementById("shareOutputPreview");
const shareApplyBtn = document.getElementById("shareApplyBtn");

let scanData = null;
let activeVariantIndex = -1;
let activePreviewPath = null;
let outputFolder = null;
let psdFileName = "";
let isProcessing = false;
let previewRequestId = 0;
let draggedFilePath = null;
let activeSourceType = "all";
let sharingVariant = null;
let modalValidatedIds = [];

const SOURCE_TYPE_LABELS = Object.freeze({
    all: "All / Anything",
    psd: "PSD / PSB",
    png: "PNG",
    jpg: "JPG / JPEG",
    webp: "WEBP",
    other: "Other supported"
});

function setStatus(title, detail = "", mode = "ready") {
    appStatus.textContent = title;
    statusSub.textContent = detail;
    statusDot.classList.toggle("busy", mode === "busy");
    statusDot.classList.toggle("error", mode === "error");
}

async function initVersion() {
    try {
        const version = await amazonApi.getVersion();
        versionLabel.textContent = `v${version}`;
    } catch (error) {
        versionLabel.textContent = "v1.0.0";
    }
}

function normalizePath(value) {
    return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function sourceTypeForFile(file) {
    const declared = String(file?.sourceType || "").toLowerCase();
    if (["psd", "png", "jpg", "webp", "other"].includes(declared)) {
        return declared;
    }

    const ext = String(file?.extension || "").toLowerCase();
    if (ext === ".psd" || ext === ".psb") return "psd";
    if (ext === ".png") return "png";
    if (ext === ".jpg" || ext === ".jpeg") return "jpg";
    if (ext === ".webp") return "webp";
    return "other";
}

function matchesSourceTypeFilter(file) {
    return activeSourceType === "all" || sourceTypeForFile(file) === activeSourceType;
}

function eligibleFiles(variant) {
    return (variant?.files || []).filter(matchesSourceTypeFilter);
}

function sourceTypeLabel() {
    return SOURCE_TYPE_LABELS[activeSourceType] || SOURCE_TYPE_LABELS.all;
}

function clearSelectionsOutsideSourceFilter() {
    if (!scanData) return;

    scanData.variants.forEach(variant => {
        variant.files.forEach(file => {
            if (!matchesSourceTypeFilter(file)) file.selected = false;
        });

        variant.files = [
            ...variant.files.filter(file => file.selected),
            ...variant.files.filter(file => !file.selected)
        ];
    });
}

function renderSourceFilterSummary() {
    if (!sourceFilterSummary) return;

    if (!scanData) {
        sourceFilterSummary.textContent = activeSourceType === "all"
            ? "All supported source types"
            : `${sourceTypeLabel()} across all folders`;
        return;
    }

    const matchingFiles = scanData.variants.reduce(
        (sum, variant) => sum + eligibleFiles(variant).length,
        0
    );
    const matchingVariants = scanData.variants.filter(variant => eligibleFiles(variant).length > 0).length;

    sourceFilterSummary.textContent = `${sourceTypeLabel()} · ${matchingFiles} file${matchingFiles === 1 ? "" : "s"} · ${matchingVariants} variant${matchingVariants === 1 ? "" : "s"}`;
}

function cloneFile(file) {
    return {
        name: file.name,
        path: file.path,
        extension: file.extension || "",
        sourceType: file.sourceType || sourceTypeForFile(file),
        size: file.size ?? null,
        modifiedMs: file.modifiedMs ?? null,
        selected: false
    };
}

function initializeScan(result) {
    const rawParents = Array.isArray(result?.parents) ? result.parents : [];

    const parents = rawParents.map(parent => {
        const variants = (parent.variants || []).map(variant => {
            const seen = new Set();
            const files = (variant.files || [])
                .filter(file => {
                    const key = normalizePath(file.path);
                    if (!key || seen.has(key)) return false;
                    seen.add(key);
                    return true;
                })
                .map(cloneFile);

            return {
                ...variant,
                parentId: parent.id,
                parentPath: parent.folderPath,
                files,
                sharedIds: []
            };
        });

        return {
            ...parent,
            variants
        };
    });

    scanData = {
        parents,
        variants: parents.flatMap(parent => parent.variants)
    };

    activeVariantIndex = scanData.variants.length ? 0 : -1;
    activePreviewPath = null;
}

function currentVariant() {
    if (!scanData || activeVariantIndex < 0) return null;
    return scanData.variants[activeVariantIndex] || null;
}

function selectedFiles(variant) {
    return (variant?.files || []).filter(file => file.selected && matchesSourceTypeFilter(file));
}

function excludedFiles(variant) {
    return (variant?.files || []).filter(file => !file.selected && matchesSourceTypeFilter(file));
}

function totalSelectedFiles() {
    if (!scanData) return 0;
    return scanData.variants.reduce(
        (sum, variant) => sum + selectedFiles(variant).length,
        0
    );
}

function outputName(variantId, selectedIndex) {
    return selectedIndex === 0
        ? `${variantId}.jpg`
        : `${variantId}_${selectedIndex + 1}.jpg`;
}

function moveArrayItem(array, fromIndex, toIndex) {
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const [item] = array.splice(fromIndex, 1);
    array.splice(toIndex, 0, item);
}

function moveSelectedFile(variant, fromPath, toPath) {
    const selected = selectedFiles(variant);
    const fromIndex = selected.findIndex(file => file.path === fromPath);
    const toIndex = selected.findIndex(file => file.path === toPath);

    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

    moveArrayItem(selected, fromIndex, toIndex);

    const selectedSet = new Set(selected);
    variant.files = [
        ...selected,
        ...variant.files.filter(file => !selectedSet.has(file))
    ];
}

function setFileSelected(variant, file, shouldSelect) {
    if (!variant || !file) return false;

    const alreadySelected = Boolean(file.selected);
    if (alreadySelected === shouldSelect) return true;

    if (shouldSelect && selectedFiles(variant).length >= 8) {
        alert("Maximum is 8 selected images per Variant ID.");
        return false;
    }

    file.selected = shouldSelect;

    variant.files = [
        ...variant.files.filter(item => item.selected),
        ...variant.files.filter(item => !item.selected)
    ];

    return true;
}

function checkAllFilesForVariant(variant) {
    if (!variant || !eligibleFiles(variant).length) return;

    const selected = selectedFiles(variant);
    const available = excludedFiles(variant);
    const room = Math.max(0, 8 - selected.length);
    const added = available.slice(0, room);

    added.forEach(file => { file.selected = true; });

    variant.files = [
        ...variant.files.filter(file => file.selected),
        ...variant.files.filter(file => !file.selected)
    ];
}

function uncheckAllFilesForVariant(variant) {
    if (!variant) return;
    variant.files.forEach(file => { file.selected = false; });
}

function checkAllVariants() {
    if (!scanData) return;
    scanData.variants.forEach(checkAllFilesForVariant);
}

function uncheckAllVariants() {
    if (!scanData) return;
    scanData.variants.forEach(uncheckAllFilesForVariant);
}

function canProcess() {
    return Boolean(
        !isProcessing &&
        scanData &&
        outputFolder &&
        psdFileName.trim() &&
        scanData.variants.some(variant => selectedFiles(variant).length > 0)
    );
}

function renderCounters() {
    const parents = scanData?.parents?.length || 0;
    const variants = (scanData?.variants?.length || 0) + (scanData?.variants || [])
        .reduce((sum, variant) => sum + (variant.sharedIds || []).length, 0);
    const selected = totalSelectedFiles();

    parentCounter.textContent = String(parents);
    variantCounter.textContent = String(variants);
    selectedCounter.textContent = String(selected);

    startProcessingBtn.disabled = !canProcess();
}

function emptyState(text) {
    const div = document.createElement("div");
    div.className = "empty-state";
    div.textContent = text;
    return div;
}

function renderVariants() {
    variantList.innerHTML = "";

    if (!scanData || !scanData.variants.length) {
        variantCount.textContent = "0 variants";
        checkAllVariantsBtn.disabled = true;
        uncheckAllVariantsBtn.disabled = true;
        variantList.appendChild(emptyState("No Variant ID folders were detected."));
        return;
    }

    const totalVariants = scanData.variants.length;
    const totalShared = scanData.variants.reduce((sum, variant) => sum + (variant.sharedIds || []).length, 0);
    variantCount.textContent = `${scanData.parents.length} parent(s) · ${totalVariants} source ID(s) · ${totalShared} shared ID(s)`;

    const anySelected = scanData.variants.some(variant => selectedFiles(variant).length > 0);
    const allFull = scanData.variants.every(variant => {
        const eligible = eligibleFiles(variant);
        if (!eligible.length) return true;
        return selectedFiles(variant).length >= Math.min(8, eligible.length);
    });

    checkAllVariantsBtn.disabled = isProcessing || allFull;
    uncheckAllVariantsBtn.disabled = isProcessing || !anySelected;

    scanData.parents.forEach(parent => {
        const heading = document.createElement("div");
        heading.className = "parent-heading";

        const name = document.createElement("strong");
        name.textContent = parent.id;
        name.title = parent.folderPath;

        const meta = document.createElement("span");
        const sharedWithinParent = parent.variants.reduce((sum, variant) => sum + (variant.sharedIds || []).length, 0);
        meta.textContent = sharedWithinParent ? `${parent.variants.length} source · ${sharedWithinParent} shared` : `${parent.variants.length} variant(s)`;

        heading.appendChild(name);
        heading.appendChild(meta);
        variantList.appendChild(heading);

        parent.variants.forEach(variant => {
            const index = scanData.variants.indexOf(variant);
            const eligible = eligibleFiles(variant);
            const selected = selectedFiles(variant);
            const item = document.createElement("div");
            item.className = "variant-item";
            if (index === activeVariantIndex) item.classList.add("active");
            if ((variant.sharedIds || []).length) item.classList.add("has-sharing");
            if (!eligible.length) item.classList.add("empty");

            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "variant-toggle";
            toggle.disabled = isProcessing || !eligible.length;

            const maxSelectable = Math.min(8, eligible.length);
            if (selected.length === 0) {
                toggle.textContent = "×";
                toggle.title = "Select up to 8 images in this variant";
            } else if (selected.length >= maxSelectable) {
                toggle.textContent = "✓";
                toggle.classList.add("checked");
                toggle.title = "Uncheck all images in this variant";
            } else {
                toggle.textContent = "–";
                toggle.classList.add("partial");
                toggle.title = "Some images selected. Click to uncheck all.";
            }

            toggle.addEventListener("click", event => {
                event.stopPropagation();
                if (selectedFiles(variant).length > 0) {
                    uncheckAllFilesForVariant(variant);
                } else {
                    checkAllFilesForVariant(variant);
                }
                renderAll();
            });

            const main = document.createElement("div");
            main.className = "variant-main";

            const variantName = document.createElement("div");
            variantName.className = "variant-name";
            variantName.textContent = variant.id;

            const variantMeta = document.createElement("div");
            variantMeta.className = "variant-meta";
            if (!eligible.length) {
                variantMeta.textContent = variant.files.length
                    ? `No ${sourceTypeLabel()} files · ${variant.files.length} total`
                    : "Empty folder";
            } else if (activeSourceType === "all") {
                variantMeta.textContent = `${eligible.length} source file${eligible.length === 1 ? "" : "s"}`;
            } else {
                variantMeta.textContent = `${eligible.length} ${sourceTypeLabel()} file${eligible.length === 1 ? "" : "s"} · ${variant.files.length} total`;
            }

            main.appendChild(variantName);
            main.appendChild(variantMeta);

            const pill = document.createElement("div");
            pill.className = "variant-count-pill";
            pill.textContent = `${selected.length}/8`;

            const actions = document.createElement("div");
            actions.className = "variant-actions";
            const shareButton = document.createElement("button");
            shareButton.type = "button";
            shareButton.className = "variant-share-btn";
            shareButton.textContent = (variant.sharedIds || []).length
                ? `Share Images (${variant.sharedIds.length})`
                : "Share Images";
            if ((variant.sharedIds || []).length) shareButton.classList.add("has-shares");
            shareButton.title = "Give this variant's selected image set to other Amazon IDs";
            shareButton.disabled = isProcessing || (!selected.length && !(variant.sharedIds || []).length);
            shareButton.addEventListener("click", event => {
                event.stopPropagation();
                activeVariantIndex = index;
                openSharingModal(variant);
            });
            actions.appendChild(shareButton);
            actions.appendChild(pill);

            item.appendChild(toggle);
            item.appendChild(main);
            item.appendChild(actions);

            item.addEventListener("click", () => {
                activeVariantIndex = index;
                activePreviewPath = null;
                clearPreview("Click a file to preview it.");
                renderAll();
            });

            variantList.appendChild(item);

            (variant.sharedIds || []).forEach(sharedId => {
                const linked = document.createElement("div");
                linked.className = "shared-variant-row";
                const arrow = document.createElement("span");
                arrow.className = "shared-arrow";
                arrow.textContent = "↳";
                const link = document.createElement("span");
                link.className = "shared-link";
                link.textContent = "↔";
                const details = document.createElement("div");
                details.className = "shared-details";
                const id = document.createElement("strong");
                id.textContent = sharedId;
                const meta = document.createElement("small");
                meta.textContent = `Shares ${variant.id} · ${selected.length} images`;
                details.append(id, meta);
                const remove = document.createElement("button");
                remove.type = "button";
                remove.className = "shared-remove";
                remove.textContent = "×";
                remove.title = `Remove sharing for ${sharedId}`;
                remove.disabled = isProcessing;
                remove.addEventListener("click", event => {
                    event.stopPropagation();
                    variant.sharedIds = (variant.sharedIds || []).filter(id => id !== sharedId);
                    renderAll();
                });
                linked.append(arrow, link, details, remove);
                variantList.appendChild(linked);
            });
        });
    });
}

function makeFileRow(variant, file, selectedIndex) {
    const row = document.createElement("div");
    row.className = "file-row";

    if (file.selected) {
        row.classList.add("selected-file");
        row.draggable = !isProcessing;
    }

    if (file.path === activePreviewPath) {
        row.classList.add("previewing");
    }

    const check = document.createElement("button");
    check.type = "button";
    check.className = `file-check ${file.selected ? "checked" : ""}`;
    check.textContent = file.selected ? "✓" : "+";
    check.disabled = isProcessing;
    check.title = file.selected ? "Remove from output" : "Add to output";

    check.addEventListener("click", event => {
        event.stopPropagation();
        if (setFileSelected(variant, file, !file.selected)) {
            renderAll();
        }
    });

    const position = document.createElement("div");
    position.className = "position-number";
    position.textContent = file.selected ? String(selectedIndex + 1) : "—";

    const main = document.createElement("div");
    main.className = "file-main";

    const name = document.createElement("div");
    name.className = "file-name";
    name.textContent = file.name;
    name.title = file.path;

    const ext = document.createElement("div");
    ext.className = "file-ext";
    ext.textContent = file.extension
        ? file.extension.replace(/^\./, "")
        : "FILE";

    main.appendChild(name);
    main.appendChild(ext);

    const generated = document.createElement("div");
    generated.className = `output-name ${file.selected ? "" : "excluded"}`;
    generated.textContent = file.selected
        ? outputName(variant.id, selectedIndex)
        : "Not selected";

    row.appendChild(check);
    row.appendChild(position);
    row.appendChild(main);
    row.appendChild(generated);

    row.addEventListener("click", () => previewFile(file));

    if (file.selected) {
        row.addEventListener("dragstart", event => {
            draggedFilePath = file.path;
            row.classList.add("dragging");
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", file.path);
        });

        row.addEventListener("dragend", () => {
            draggedFilePath = null;
            row.classList.remove("dragging");
            fileList.querySelectorAll(".drag-over").forEach(element => {
                element.classList.remove("drag-over");
            });
        });

        row.addEventListener("dragover", event => {
            if (!draggedFilePath || draggedFilePath === file.path) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            row.classList.add("drag-over");
        });

        row.addEventListener("dragleave", () => {
            row.classList.remove("drag-over");
        });

        row.addEventListener("drop", event => {
            event.preventDefault();
            row.classList.remove("drag-over");

            const fromPath = draggedFilePath || event.dataTransfer.getData("text/plain");
            if (!fromPath) return;

            moveSelectedFile(variant, fromPath, file.path);
            draggedFilePath = null;
            renderAll();
        });
    }

    return row;
}

function renderFiles() {
    fileList.innerHTML = "";
    const variant = currentVariant();

    if (!variant) {
        filesTitle.textContent = "Files";
        selectedCount.textContent = "0 / 8 selected";
        checkAllFilesBtn.disabled = true;
        uncheckAllFilesBtn.disabled = true;
        fileList.appendChild(emptyState("Select a Variant ID to view its files."));
        return;
    }

    const eligible = eligibleFiles(variant);
    const selected = selectedFiles(variant);
    const excluded = excludedFiles(variant);

    filesTitle.textContent = `${variant.parentId} / ${variant.id}`;
    selectedCount.textContent = `${selected.length} / 8 selected`;

    checkAllFilesBtn.disabled = isProcessing || !eligible.length || selected.length >= Math.min(8, eligible.length);
    uncheckAllFilesBtn.disabled = isProcessing || selected.length === 0;

    if (!eligible.length) {
        fileList.appendChild(emptyState(
            variant.files.length
                ? `No ${sourceTypeLabel()} files in this Variant ID.`
                : "This Variant ID folder is empty."
        ));
        return;
    }

    if (selected.length) {
        const label = document.createElement("div");
        label.className = "file-section-label";
        label.textContent = "Selected · drag to reorder";
        fileList.appendChild(label);

        selected.forEach((file, index) => {
            fileList.appendChild(makeFileRow(variant, file, index));
        });
    }

    if (excluded.length) {
        const label = document.createElement("div");
        label.className = "file-section-label";
        label.textContent = selected.length ? "Available files" : "Available files · select up to 8";
        fileList.appendChild(label);

        excluded.forEach(file => {
            fileList.appendChild(makeFileRow(variant, file, -1));
        });
    }
}

function renderOrderList() {
    orderList.innerHTML = "";
    const variant = currentVariant();
    const selected = selectedFiles(variant);

    orderCount.textContent = `${selected.length} / 8`;

    if (!variant || !selected.length) {
        const empty = document.createElement("div");
        empty.className = "empty-order";
        empty.textContent = "No selected images.";
        orderList.appendChild(empty);
        return;
    }

    selected.forEach((file, index) => {
        const row = document.createElement("div");
        row.className = "order-row";

        const number = document.createElement("strong");
        number.textContent = String(index + 1);

        const info = document.createElement("div");
        const output = document.createElement("span");
        output.textContent = outputName(variant.id, index);
        const source = document.createElement("small");
        source.textContent = file.name;
        source.title = file.path;

        info.appendChild(output);
        info.appendChild(source);
        row.appendChild(number);
        row.appendChild(info);
        orderList.appendChild(row);
    });
}

function clearPreview(message = "Click a file to preview it.") {
    previewRequestId++;
    activePreviewPath = null;
    previewImage.src = "";
    previewImage.classList.add("hidden");

    let placeholder = previewStage.querySelector(".preview-placeholder");
    if (!placeholder) {
        placeholder = document.createElement("div");
        placeholder.className = "preview-placeholder";
        previewStage.insertBefore(placeholder, previewImage);
    }

    placeholder.classList.remove("hidden");
    placeholder.textContent = message;
    previewType.textContent = "No file selected";
    previewName.textContent = "—";
    previewInfo.textContent = "—";
    previewError.textContent = "";
}

async function previewFile(file) {
    const requestId = ++previewRequestId;
    activePreviewPath = file.path;
    renderFiles();

    previewName.textContent = file.name;
    previewType.textContent = file.extension
        ? file.extension.replace(/^\./, "").toUpperCase()
        : "FILE";
    previewInfo.textContent = "Loading preview...";
    previewError.textContent = "";

    previewImage.src = "";
    previewImage.classList.add("hidden");

    let placeholder = previewStage.querySelector(".preview-placeholder");
    if (!placeholder) {
        placeholder = document.createElement("div");
        placeholder.className = "preview-placeholder";
        previewStage.insertBefore(placeholder, previewImage);
    }

    placeholder.classList.remove("hidden");
    const ext = String(file.extension || "").toLowerCase();
    placeholder.textContent = ext === ".psd" || ext === ".psb"
        ? "Loading Main layer preview through Photoshop..."
        : "Loading preview...";

    try {
        const result = await amazonApi.getFilePreview(file.path);
        if (requestId !== previewRequestId) return;

        if (!result || !result.ok) {
            throw new Error(result?.error || "Preview failed.");
        }

        previewImage.src = result.dataUrl;
        previewImage.classList.remove("hidden");
        placeholder.classList.add("hidden");

        previewType.textContent = result.format || "Image";
        previewInfo.textContent = result.width && result.height
            ? `${result.width} × ${result.height}`
            : "Preview ready";
        previewError.textContent = "";
    } catch (error) {
        if (requestId !== previewRequestId) return;

        previewImage.src = "";
        previewImage.classList.add("hidden");
        placeholder.classList.remove("hidden");
        placeholder.textContent = "Preview unavailable";
        previewInfo.textContent = "Could not render this file.";
        previewError.textContent = error?.message || String(error);
    }
}

function buildCandidateParents(sourceVariant, candidateSharedIds) {
    const parents = buildProcessingParents();
    if (sourceVariant) {
        for (const parent of parents) {
            for (const variant of parent.variants) {
                if (parent.folderPath === sourceVariant.parentPath && variant.id === sourceVariant.id) {
                    variant.sharedIds = candidateSharedIds;
                }
            }
        }
    }
    return parents;
}

function previewSharingInput() {
    if (!sharingVariant) return;
    const ids = sharingRules.parseSharedIds(shareIdsInput.value);
    const parents = buildCandidateParents(sharingVariant, ids);
    const result = sharingRules.buildSharingPlan(parents, {
        reservedVariantIds: scanData?.variants?.map(variant => variant.id) || []
    });
    modalValidatedIds = result.ok ? ids : [];
    shareApplyBtn.disabled = !result.ok || isProcessing;
    const imageCount = selectedFiles(sharingVariant).length;
    shareCountSummary.textContent = `${ids.length} shared ID(s) · ${ids.length * imageCount} shared JPG(s) · ${result.jpgCount} batch JPG(s) total`;
    shareValidation.classList.toggle("invalid", !result.ok);
    shareValidation.textContent = result.ok
        ? (ids.length ? `All ${ids.length} IDs pass validation. Final output files will be checked for overwrite conflicts before processing.` : "No shared IDs. Apply to remove any existing sharing.")
        : result.errors.slice(0, 10).join("\n");
    const lines = ids.slice(0, 7).flatMap(id => {
        return imageCount > 1
            ? [`${sharingRules.outputName(id, 1)}  ...  ${sharingRules.outputName(id, imageCount)}`]
            : [`${sharingRules.outputName(id, 1)}`];
    });
    if (ids.length > 7) lines.push(`... plus ${ids.length - 7} more IDs`);
    shareOutputPreview.textContent = lines.length ? lines.join("\n") : "No shared JPGs. Only the source ID will be exported.";
}

function openSharingModal(variant) {
    if (isProcessing || !variant) return;
    sharingVariant = variant;
    shareSourceSummary.textContent = `${variant.parentId} / ${variant.id} · ${selectedFiles(variant).length} selected source image(s) · inherits original image order and sizing`;
    shareIdsInput.value = (variant.sharedIds || []).join("\n");
    shareModalBackdrop.classList.remove("hidden");
    previewSharingInput();
    shareIdsInput.focus();
}

function closeSharingModal() {
    sharingVariant = null;
    modalValidatedIds = [];
    shareModalBackdrop.classList.add("hidden");
}

function applySharing() {
    if (!sharingVariant || isProcessing) return;
    previewSharingInput();
    if (shareApplyBtn.disabled) return;
    const variant = sharingVariant;
    variant.sharedIds = [...modalValidatedIds];
    closeSharingModal();
    activeVariantIndex = scanData.variants.indexOf(variant);
    renderAll();
    setStatus("Sharing updated", `${variant.id} → ${variant.sharedIds.length} shared Variant ID(s). Images are still processed only once.`);
}

function renderAll() {
    renderSourceFilterSummary();
    renderCounters();
    renderVariants();
    renderFiles();
    renderOrderList();
    renderCounters();
}

async function selectParents() {
    if (isProcessing) return;

    selectParentBtn.disabled = true;
    setStatus("Scanning parent folders", "Reading Parent → Variant folder structure...", "busy");

    try {
        const result = await amazonApi.selectParentFolders();
        if (!result) {
            setStatus("Ready", "No folders selected.");
            return;
        }

        if (result.error) {
            throw new Error(result.error);
        }

        initializeScan(result);

        const parentNames = scanData.parents.map(parent => parent.id);
        const parentPaths = scanData.parents.map(parent => parent.folderPath);
        const withFiles = scanData.variants.filter(variant => variant.files.length > 0).length;
        const empty = scanData.variants.length - withFiles;

        parentPath.textContent = parentNames.join(" · ");
        parentPath.title = parentPaths.join("\n");
        scanSummary.textContent = `${scanData.parents.length} parent folder${scanData.parents.length === 1 ? "" : "s"} · ${withFiles} variants with files · ${empty} empty`;

        if (Array.isArray(result.errors) && result.errors.length) {
            alert(
                "Some folders could not be scanned:\n\n" +
                result.errors.map(item => `${item.folderPath}\n${item.error}`).join("\n\n")
            );
        }

        clearPreview();
        renderAll();
        setStatus("Folders scanned", "0 / 8 selected initially. Choose files for each Variant ID.");
    } catch (error) {
        console.error(error);
        alert(`Could not scan parent folders:\n\n${error?.message || error}`);
        setStatus("Scan failed", error?.message || String(error), "error");
    } finally {
        selectParentBtn.disabled = false;
    }
}

async function chooseOutput() {
    if (isProcessing) return;
    const result = await amazonApi.selectOutputFolder();
    if (!result) return;

    outputFolder = result.folderPath;
    outputPath.textContent = outputFolder;
    outputPath.title = outputFolder;
    renderCounters();
}

function setProcessingState(processing) {
    isProcessing = processing;
    selectParentBtn.disabled = processing;
    selectOutputBtn.disabled = processing;
    sourceTypeFilter.disabled = processing;
    psdFileNameInput.disabled = processing;
    renderAll();
}

function buildProcessingParents() {
    if (!scanData) return [];

    return scanData.parents
        .map(parent => ({
            id: parent.id,
            folderPath: parent.folderPath,
            variants: parent.variants
                .filter(variant => selectedFiles(variant).length > 0)
                .map(variant => ({
                    id: variant.id,
                    sharedIds: [...(variant.sharedIds || [])],
                    files: selectedFiles(variant).map(file => ({
                        name: file.name,
                        path: file.path,
                        extension: file.extension || "",
                        sourceType: sourceTypeForFile(file)
                    }))
                }))
        }))
        .filter(parent => parent.variants.length > 0);
}

async function startProcessing() {
    if (isProcessing) return;

    const orphaned = (scanData?.variants || []).filter(variant =>
        (variant.sharedIds || []).length && !selectedFiles(variant).length
    );
    if (orphaned.length) {
        alert(`These source IDs have sharing attached but no selected images:\n${orphaned.map(v => v.id).join("\n")}\n\nChoose source images or remove sharing first.`);
        return;
    }
    const parents = buildProcessingParents();

    if (!parents.length) {
        alert("Select at least one image in at least one Variant ID.");
        return;
    }

    if (!outputFolder) {
        alert("Select the output folder first.");
        return;
    }

    psdFileName = psdFileNameInput.value.trim();
    if (!psdFileName) {
        alert("Enter the PSD file name first.");
        psdFileNameInput.focus();
        return;
    }

    setProcessingState(true);
    setStatus("Starting Amazon processing", "Preparing selected Parent / Variant jobs...", "busy");

    try {
        const reservedVariantIds = scanData.variants.map(variant => variant.id);
        const hasSharing = parents.some(parent => parent.variants.some(variant => variant.sharedIds.length));
        let confirmedExistingFiles = [];
        if (hasSharing) {
            const inspection = await amazonApi.preflightSharing({
                parents, outputFolder, psdFileName, reservedVariantIds
            });
            if (!inspection?.ok) {
                throw new Error((inspection?.errors || ["Could not validate shared IDs."]).join("\n"));
            }
            if (inspection.existingFiles.length) {
                const files = inspection.existingFiles;
                const message = `${files.length} Amazon output file(s) already exist and will be replaced if you continue.\n\n` +
                    files.slice(0, 18).join("\n") +
                    (files.length > 18 ? `\n... and ${files.length - 18} more` : "") +
                    "\n\nContinue and replace these files? A backup will be used if a file group fails.";
                if (!confirm(message)) {
                    setStatus("Amazon processing canceled", "Existing files were not modified.");
                    return;
                }
                confirmedExistingFiles = [...files];
            }
            setStatus("Sharing validated", `${inspection.sourceCount} unique source sets → ${inspection.totalVariants} IDs · ${inspection.jpgCount} JPGs`, "busy");
        }
        const result = await amazonApi.startProcessing({
            parents,
            outputFolder,
            psdFileName,
            reservedVariantIds,
            confirmedExistingFiles
        });

        if (!result || !result.ok) {
            throw new Error(result?.error || "Processing failed.");
        }

        let message =
            `Amazon processing finished.\n\n` +
            `Successful variants: ${result.successful}\n` +
            `Failed variants: ${result.failed}\n` +
            (result.sharingEnabled ? `Unique image sets processed: ${result.sourceSuccessful}\nShared IDs exported: ${result.sharedSuccessful}\n` : "") +
            `\n` +
            `Output folder:\n${result.outputFolder || result.jpgRootFolder}`;

        if (result.masterPsdPath) {
            message += `\n\nMaster PSD:\n${result.masterPsdPath}`;
        } else if (result.masterPsdError) {
            message += `\n\nMASTER PSD ERROR:\n${result.masterPsdError}`;
        }

        const failures = (result.results || []).filter(item => !item.ok);
        if (failures.length) {
            message += "\n\nVARIANT ERRORS:";
            failures.forEach(failure => {
                message += `\n\n${failure.parentId} / ${failure.variantId}\n${failure.error}`;
            });
        }

        // Amazon has fully finished, including PSD save and its temp cleanup.
        // Keep the selection locked while the independent optional step runs.
        let colorbox = null;
        if (result.colorboxJobId && result.colorboxEligibleCount > 0) {
            setStatus("Amazon finished", "Choose whether to export Colorbox images next.");
            try {
                colorbox = await amazonApi.offerColorbox(result.colorboxJobId);
                if (!colorbox || !colorbox.ok) {
                    throw new Error(colorbox?.error || "Colorbox export did not return a result.");
                }
            } catch (error) {
                // Never relabel a successful Amazon job as a failed Amazon job.
                colorbox = { ok: false, error: error?.message || String(error) };
            }
        }

        if (colorbox?.skipped === true) {
            message += "\n\nColorbox: skipped. Amazon outputs were not changed.";
        } else if (colorbox?.ok) {
            message += `\n\nCOLORBOX\nSaved: ${colorbox.successful}\nFailed: ${colorbox.failed}` +
                `\nExisting files kept: ${colorbox.skippedFiles || 0}\nFolder:\n${colorbox.outputFolder}`;
            for (const failure of (colorbox.results || []).filter(item => !item.ok)) {
                message += `\n\n${failure.parentId} / ${failure.variantId}\n${failure.error}`;
            }
        } else if (colorbox) {
            message += `\n\nCOLORBOX ERROR:\n${colorbox.error}\nAmazon outputs were not changed.`;
        }

        const amazonXp = result.progression?.xpEarned || 0;
        const colorboxXp = colorbox?.progression?.xpEarned || 0;
        const totalXp = amazonXp + colorboxXp;
        if (totalXp > 0) {
            message += `\n\n+${totalXp} EXP`;
            if (result.progression?.levelUp || colorbox?.progression?.levelUp) {
                const level = colorbox?.progression?.profile?.level?.level || result.progression?.profile?.level?.level;
                if (level) message += `\nLEVEL UP! LV. ${level}`;
            }
        }

        alert(message);
        const colorboxFailed = colorbox && colorbox.skipped !== true && (!colorbox.ok || colorbox.failed > 0);
        if (result.failed > 0 || result.masterPsdError) {
            setStatus("Finished with Amazon errors", "See the result summary for the affected variants/PSD.", "error");
        } else if (colorboxFailed) {
            setStatus("Amazon complete - Colorbox needs attention", colorbox.error || "Some Colorboxes could not be exported.", "error");
        } else if (colorbox?.ok && colorbox.skipped !== true) {
            setStatus("Amazon + Colorbox complete", `${colorbox.successful} Colorbox file(s) saved to ${colorbox.outputFolder}`);
        } else {
            setStatus("Amazon complete", result.masterPsdPath || result.jpgRootFolder);
        }
    } catch (error) {
        console.error(error);
        alert(`Processing error:\n\n${error?.message || error}`);
        setStatus("Processing failed", error?.message || String(error), "error");
    } finally {
        setProcessingState(false);
    }
}

amazonApi.onProcessingProgress(progress => {
    if (!progress) return;

    if (progress.type === "colorbox-start") {
        setStatus("Exporting Colorbox", `${progress.total} original first image(s). No resizing.`, "busy");
        return;
    }
    if (progress.type === "colorbox-file-start") {
        setStatus(`Colorbox ${progress.current} / ${progress.total}`, progress.variantId + " - original source size", "busy");
        return;
    }
    if (progress.type === "colorbox-file-complete") {
        setStatus(`Colorbox saved: ${progress.variantId}`, `${progress.width} x ${progress.height} - original dimensions`, "busy");
        return;
    }
    if (progress.type === "colorbox-file-skipped") {
        setStatus(`Colorbox kept: ${progress.variantId}`, "Existing output was not replaced.", "busy");
        return;
    }
    if (progress.type === "colorbox-file-error") {
        setStatus(`Colorbox failed: ${progress.variantId}`, progress.error, "error");
        return;
    }
    if (progress.type === "colorbox-complete") {
        setStatus("Colorbox step finished", `${progress.successful} saved, ${progress.failed} failed, ${progress.skipped} kept.`);
        return;
    }

    if (progress.type === "parent-start") {
        setStatus(
            `Parent ${progress.parentId}`,
            `${progress.current} / ${progress.total} parent folders`,
            "busy"
        );
        return;
    }

    if (progress.type === "shared-start") {
        setStatus(`Sharing images → ${progress.variantId}`, `Copying finished JPGs from ${progress.sourceId} · ${progress.current}/${progress.total}`, "busy");
        return;
    }
    if (progress.type === "variant-start") {
        setStatus(
            `Processing ${progress.variantId}`,
            `${progress.current} / ${progress.total} variants in ${progress.parentId}`,
            "busy"
        );
        return;
    }

    if (progress.type === "image-progress") {
        const pos = progress.outputPosition || "?";
        const labels = {
            loading: `Loading image ${pos}`,
            "extracting-psd-no-shadow": "PSD: hiding second top-level layer and exporting PNG",
            "background-already-transparent": "Background already transparent — preserving source",
            "removing-background": `Removing background for image ${pos}`,
            "photoshop-fallback": "Opening source through Photoshop",
            "cut-detection": `Detecting cut sides for image ${pos}`,
            "trimming-first": "Preparing visible content for 801 × 801 main area",
            rendering: `Rendering image ${pos}`,
            complete: `Exported ${progress.output || `image ${pos}`}`
        };

        setStatus(
            progress.variantId || "Processing image",
            labels[progress.status] || progress.status || "Working...",
            "busy"
        );
        return;
    }

    if (progress.type === "variant-error") {
        setStatus(`${progress.variantId} failed`, progress.error || "Variant error", "error");
        return;
    }

    if (progress.type === "psd-start") {
        const name = progress.output
            ? String(progress.output).split(/[\\/]/).pop()
            : "master PSD";
        setStatus(`Building ${name}`, progress.output || "Photoshop is building the master PSD...", "busy");
        return;
    }

    if (progress.type === "psd-complete") {
        const name = progress.output
            ? String(progress.output).split(/[\\/]/).pop()
            : "master PSD";
        setStatus("Master PSD complete", progress.output || `${name} created.`);
        return;
    }

    if (progress.type === "psd-error") {
        setStatus("Master PSD failed", progress.error || "PSD build error", "error");
    }
});

checkAllVariantsBtn.addEventListener("click", () => {
    if (isProcessing) return;
    checkAllVariants();
    renderAll();
});

uncheckAllVariantsBtn.addEventListener("click", () => {
    if (isProcessing) return;
    uncheckAllVariants();
    renderAll();
});

checkAllFilesBtn.addEventListener("click", () => {
    if (isProcessing) return;
    const variant = currentVariant();
    if (!variant) return;
    checkAllFilesForVariant(variant);
    renderAll();
});

uncheckAllFilesBtn.addEventListener("click", () => {
    if (isProcessing) return;
    const variant = currentVariant();
    if (!variant) return;
    uncheckAllFilesForVariant(variant);
    renderAll();
});


sourceTypeFilter.addEventListener("change", () => {
    if (isProcessing) return;

    activeSourceType = sourceTypeFilter.value || "all";
    clearSelectionsOutsideSourceFilter();

    if (activePreviewPath && scanData) {
        const previewFileRecord = scanData.variants
            .flatMap(variant => variant.files)
            .find(file => file.path === activePreviewPath);
        if (previewFileRecord && !matchesSourceTypeFilter(previewFileRecord)) {
            clearPreview("Click a file to preview it.");
        }
    }

    renderAll();
    setStatus(
        "Source filter updated",
        `${sourceTypeLabel()} now applies to every Parent / Variant folder.`
    );
});

shareIdsInput.addEventListener("input", previewSharingInput);
shareApplyBtn.addEventListener("click", applySharing);
shareCancelBtn.addEventListener("click", closeSharingModal);
shareModalCloseBtn.addEventListener("click", closeSharingModal);
shareModalBackdrop.addEventListener("click", event => {
    if (event.target === shareModalBackdrop) closeSharingModal();
});
document.addEventListener("keydown", event => {
    if (event.key === "Escape" && sharingVariant) closeSharingModal();
});

selectParentBtn.addEventListener("click", selectParents);
psdFileNameInput.addEventListener("input", () => {
    psdFileName = psdFileNameInput.value.trim();
    renderCounters();
});

selectOutputBtn.addEventListener("click", chooseOutput);
startProcessingBtn.addEventListener("click", startProcessing);

initVersion();
clearPreview();
renderAll();
