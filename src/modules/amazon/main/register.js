const fs = require("fs");
const path = require("path");
const os = require("os");
const { randomUUID } = require("crypto");

const {
    app,
    BrowserWindow,
    dialog,
    ipcMain
} = require("electron");

const { scanParentFolder, SUPPORTED_EXTENSIONS } = require("./folderScanner");
const { readImageRecords, validateVirtualBatch } = require("./batchWorkspace");
const { scanBatchImageFolder } = require("./batchImageScanner");
const {
    processVariant,
    createPreviewDataUrl,
    safeFileName
} = require("./imageProcessor");
const { buildAmazonPsd } = require("./psdBuilder");
const { inspectSharingRequest, processSharedAmazonJob } = require("./sharedJob");
const { recordProductionEvent } = require("../../profile/main/service");

const previewCache = new Map();

// Keep a small in-memory snapshot of the just-finished Amazon selection.
// No Colorbox pixels are decoded/copied during Amazon generation.
let amazonIsRunning = false;
let colorboxIsRunning = false;
let pendingColorboxJob = null;

function safeWorkName(value) {
    return String(value || "")
        .trim()
        .replace(/[^a-z0-9_-]+/gi, "_") || "AMAZON";
}

function dialogStatePath() {
    return path.join(app.getPath("userData"), "amazon-dialog-state.json");
}

function readDialogState() {
    try {
        const file = dialogStatePath();
        if (!fs.existsSync(file)) return {};
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
        return {};
    }
}

function writeDialogState(patch) {
    try {
        const file = dialogStatePath();
        const next = { ...readDialogState(), ...patch };
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
    } catch (error) {
        // Remembering folders is convenience-only. Never block the app.
    }
}

function usableDirectory(candidate) {
    if (!candidate) return undefined;
    try {
        return fs.statSync(candidate).isDirectory() ? candidate : undefined;
    } catch (error) {
        return undefined;
    }
}

async function chooseParentDirectories() {
    const state = readDialogState();
    const result = await dialog.showOpenDialog({
        title: "Select Amazon parent folder(s)",
        defaultPath: usableDirectory(state.lastParentLocation),
        properties: ["openDirectory", "multiSelections"]
    });

    if (result.canceled || !result.filePaths.length) return [];

    writeDialogState({
        lastParentLocation: path.dirname(result.filePaths[0])
    });

    return result.filePaths;
}

function normalizePsdFileName(value) {
    let name = String(value || "").trim();

    if (!name) {
        throw new Error("Enter a PSD file name.");
    }

    // User may type the extension or just the base name.
    name = name.replace(/\.psd$/i, "").trim();

    if (!name) {
        throw new Error("Enter a PSD file name before .psd.");
    }

    // Prevent invalid Windows filename characters and accidental paths.
    if (/[<>:"/\\|?*\x00-\x1F]/.test(name)) {
        throw new Error('PSD file name contains an invalid character. Do not use: < > : " / \\ | ? *');
    }

    if (/[. ]$/.test(name)) {
        throw new Error("PSD file name cannot end with a period or space.");
    }

    if (name === "." || name === "..") {
        throw new Error("Invalid PSD file name.");
    }

    const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
    if (reserved.test(name)) {
        throw new Error(`PSD file name "${name}" is reserved by Windows.`);
    }

    return {
        baseName: name,
        fileName: `${name}.psd`
    };
}

async function chooseOutputDirectory() {
    const state = readDialogState();
    const result = await dialog.showOpenDialog({
        title: "Select Amazon output folder",
        defaultPath: usableDirectory(
            state.lastOutputFolder || state.lastParentLocation
        ),
        properties: ["openDirectory"]
    });

    if (result.canceled || !result.filePaths.length) return null;

    writeDialogState({ lastOutputFolder: result.filePaths[0] });
    return result.filePaths[0];
}

ipcMain.handle("amazon:get-app-version", async () => app.getVersion());

ipcMain.handle("amazon:select-parent-folder", async () => {
    const folderPaths = await chooseParentDirectories();
    if (!folderPaths.length) return null;

    const parents = [];
    const errors = [];

    for (const folderPath of folderPaths) {
        try {
            parents.push(scanParentFolder(folderPath));
        } catch (error) {
            errors.push({
                folderPath,
                error: error?.message || String(error)
            });
        }
    }

    if (!parents.length) {
        return {
            error: errors.length
                ? errors.map(item => `${item.folderPath}: ${item.error}`).join("\n")
                : "No parent folders could be scanned."
        };
    }

    return {
        parents,
        totalParents: parents.length,
        errors
    };
});

ipcMain.handle("amazon:select-output-folder", async () => {
    const folderPath = await chooseOutputDirectory();
    return folderPath ? { folderPath } : null;
});

// Paste a folder path or browse for one. This scans supported images into
// the Image Library without creating product groups or renaming source files.
ipcMain.handle("amazon:choose-image-folder", async () => {
    if (amazonIsRunning || colorboxIsRunning) return { error: "Wait for Amazon processing to finish." };
    const state = readDialogState();
    const response = await dialog.showOpenDialog({
        title: "Choose folder containing Amazon source images",
        defaultPath: usableDirectory(state.lastBatchImageFolder) || usableDirectory(state.lastParentLocation),
        properties: ["openDirectory"]
    });
    if (response.canceled || !response.filePaths.length) return null;
    const folderPath = response.filePaths[0];
    writeDialogState({ lastBatchImageFolder: folderPath });
    return { folderPath };
});
ipcMain.handle("amazon:scan-image-folder", async (_event, payload) => {
    if (amazonIsRunning || colorboxIsRunning) return { error: "Wait for Amazon processing to finish." };
    try {
        const result = await scanBatchImageFolder(payload?.folderPath, {
            recursive: payload?.recursive === true, format: payload?.format || "all"
        });
        writeDialogState({ lastBatchImageFolder: result.folderPath });
        return result;
    } catch (error) { return { error: error?.message || String(error) }; }
});

ipcMain.handle("amazon:choose-batch-images", async () => {
    const state = readDialogState();
    const response = await dialog.showOpenDialog({
        title: "Import Amazon source images (multiple files)",
        defaultPath: usableDirectory(state.lastBatchImageFolder) || usableDirectory(state.lastParentLocation),
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Amazon source images", extensions: [...SUPPORTED_EXTENSIONS].map(ext => ext.slice(1)) }]
    });
    if (response.canceled || !response.filePaths.length) return { files: [], errors: [] };
    writeDialogState({ lastBatchImageFolder: path.dirname(response.filePaths[0]) });
    return readImageRecords(response.filePaths);
});

ipcMain.handle("amazon:inspect-batch-images", async (_event, payload) => {
    return readImageRecords(payload?.paths);
});

ipcMain.handle("amazon:preflight-batch", async (_event, payload) => {
    try {
        const psdName = normalizePsdFileName(payload?.psdFileName);
        const checked = await validateVirtualBatch(payload);
        if (!checked.ok) return { ok: false, errors: checked.errors };
        const inspection = await inspectSharingRequest({
            parents: checked.parents, outputFolder: payload.outputFolder
        }, psdName);
        return {
            ok: inspection.ok,
            errors: inspection.errors || [],
            existingFiles: inspection.existingFiles || [],
            sourceCount: inspection.sourceCount || 0,
            sharedCount: inspection.sharedCount || 0,
            totalVariants: inspection.totalVariants || 0,
            jpgCount: inspection.jpgCount || 0
        };
    } catch (error) {
        return { ok: false, errors: [error?.message || String(error)] };
    }
});

ipcMain.handle("amazon:get-file-preview", async (event, payload) => {
    if (colorboxIsRunning) {
        return { ok: false, error: "Preview is paused while the Colorbox step is open." };
    }
    const filePath = payload?.filePath;

    if (!filePath) {
        return { ok: false, error: "No file selected." };
    }

    try {
        const stat = await fs.promises.stat(filePath);
        const cacheKey = `${filePath}|${stat.size}|${stat.mtimeMs}`;

        if (previewCache.has(cacheKey)) {
            return { ok: true, ...previewCache.get(cacheKey) };
        }

        const preview = await createPreviewDataUrl(filePath);
        previewCache.set(cacheKey, preview);

        if (previewCache.size > 80) {
            const oldestKey = previewCache.keys().next().value;
            previewCache.delete(oldestKey);
        }

        return { ok: true, ...preview };
    } catch (error) {
        return {
            ok: false,
            error: error?.message || String(error)
        };
    }
});

async function processAmazonJob(event, payload) {
    const parents = Array.isArray(payload?.parents) ? payload.parents : [];
    const outputFolder = payload?.outputFolder || null;
    let psdName;

    try {
        psdName = normalizePsdFileName(payload?.psdFileName);
    } catch (error) {
        return { ok: false, error: error?.message || String(error) };
    }

    if (!outputFolder) {
        return { ok: false, error: "No output location selected." };
    }

    if (!parents.length) {
        return { ok: false, error: "No parent folders selected for processing." };
    }

    const normalizedParentIds = parents
        .map(parent => String(parent.id || "").trim().toLowerCase())
        .filter(Boolean);

    const duplicateParentIds = normalizedParentIds.filter(
        (id, index, all) => all.indexOf(id) !== index
    );

    if (duplicateParentIds.length) {
        return {
            ok: false,
            error: "Two selected parent folders have the same folder name. Rename one parent folder first so output names do not collide."
        };
    }

    // JPGs and the user-named master PSD are exported directly into the
    // user-selected output folder. No JPG/ or Parent subfolders are created.
    const jpgRootFolder = outputFolder;
    await fs.promises.mkdir(outputFolder, { recursive: true });

    // With a flat JPG output folder, Variant IDs must be unique across ALL
    // selected parents or their output filenames would collide/overwrite.
    const seenVariantIds = new Set();
    const duplicateVariantIdsAcrossParents = new Set();
    for (const parent of parents) {
        for (const variant of Array.isArray(parent?.variants) ? parent.variants : []) {
            const id = String(variant?.id || "").trim().toLowerCase();
            if (!id) continue;
            if (seenVariantIds.has(id)) duplicateVariantIdsAcrossParents.add(id);
            seenVariantIds.add(id);
        }
    }

    if (duplicateVariantIdsAcrossParents.size > 0) {
        return {
            ok: false,
            error: "Duplicate Variant IDs were found across the selected parents. Since JPGs are now saved directly in one output folder, every Variant ID must be unique. Duplicates: " +
                Array.from(duplicateVariantIdsAcrossParents).join(", ")
        };
    }

    const workRoot = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "amazon-multi-")
    );

    const allResults = [];
    const parentResults = [];
    const successfulParentGroups = [];

    try {
        for (let parentIndex = 0; parentIndex < parents.length; parentIndex++) {
            const parent = parents[parentIndex] || {};
            const parentId = String(parent.id || "AMAZON").trim() || "AMAZON";
            const variants = Array.isArray(parent.variants) ? parent.variants : [];

            if (!variants.length) continue;

            const normalizedVariantIds = variants
                .map(variant => String(variant.id || "").trim().toLowerCase())
                .filter(Boolean);

            const duplicateVariantIds = normalizedVariantIds.filter(
                (id, index, all) => all.indexOf(id) !== index
            );

            if (duplicateVariantIds.length) {
                parentResults.push({
                    parentId,
                    ok: false,
                    successful: 0,
                    failed: variants.length,
                    jpgOutputFolder: outputFolder,
                    psdIncludedInMaster: false,
                    error: "Duplicate Variant IDs are not allowed inside the same parent job."
                });
                continue;
            }

            // Flat export: every variant JPG goes directly into the selected
            // output folder, regardless of which Parent folder it came from.
            const jpgOutputFolder = outputFolder;

            const parentWorkFolder = path.join(
                workRoot,
                `${String(parentIndex + 1).padStart(3, "0")}-${safeWorkName(parentId)}`
            );
            await fs.promises.mkdir(parentWorkFolder, { recursive: true });

            const successfulForParent = [];
            const parentVariantResults = [];

            event.sender.send("amazon:processing-progress", {
                type: "parent-start",
                parentId,
                current: parentIndex + 1,
                total: parents.length
            });

            for (let index = 0; index < variants.length; index++) {
                const variant = variants[index] || {};
                const variantId = String(variant.id || "").trim();
                const files = Array.isArray(variant.files) ? variant.files : [];

                event.sender.send("amazon:processing-progress", {
                    type: "variant-start",
                    parentId,
                    variantId,
                    current: index + 1,
                    total: variants.length
                });

                try {
                    if (!variantId) {
                        throw new Error("Variant ID is empty.");
                    }

                    if (!files.length) {
                        throw new Error(`${variantId} has no selected images.`);
                    }

                    if (files.length > 8) {
                        throw new Error(`${variantId} has more than 8 selected images.`);
                    }

                    const processed = await processVariant(
                        { id: variantId, files },
                        jpgOutputFolder,
                        parentWorkFolder,
                        progress => {
                            event.sender.send("amazon:processing-progress", {
                                type: "image-progress",
                                parentId,
                                ...progress
                            });
                        }
                    );

                    successfulForParent.push(processed);

                    const item = {
                        parentId,
                        variantId,
                        ok: true,
                        jpgs: processed.jpgs
                    };
                    parentVariantResults.push(item);
                    allResults.push(item);

                    event.sender.send("amazon:processing-progress", {
                        type: "variant-complete",
                        parentId,
                        variantId,
                        current: index + 1,
                        total: variants.length
                    });
                } catch (error) {
                    const message = error?.message || String(error);
                    const item = {
                        parentId,
                        variantId,
                        ok: false,
                        error: message
                    };

                    parentVariantResults.push(item);
                    allResults.push(item);

                    event.sender.send("amazon:processing-progress", {
                        type: "variant-error",
                        parentId,
                        variantId,
                        error: message
                    });
                }
            }

            if (successfulForParent.length > 0) {
                successfulParentGroups.push({
                    parentId,
                    variants: successfulForParent
                });
            }

            parentResults.push({
                parentId,
                ok: parentVariantResults.some(item => item.ok),
                jpgOutputFolder,
                successful: parentVariantResults.filter(item => item.ok).length,
                failed: parentVariantResults.filter(item => !item.ok).length,
                psdIncludedInMaster: successfulForParent.length > 0
            });

            event.sender.send("amazon:processing-progress", {
                type: "parent-complete",
                parentId,
                current: parentIndex + 1,
                total: parents.length
            });
        }

        let masterPsdPath = null;
        let masterPsdError = null;

        if (successfulParentGroups.length > 0) {
            masterPsdPath = path.join(outputFolder, psdName.fileName);

            event.sender.send("amazon:processing-progress", {
                type: "psd-start",
                output: masterPsdPath
            });

            try {
                await fs.promises.unlink(masterPsdPath).catch(error => {
                    if (error.code !== "ENOENT") throw error;
                });

                await buildAmazonPsd(
                    psdName.baseName,
                    successfulParentGroups,
                    masterPsdPath
                );

                event.sender.send("amazon:processing-progress", {
                    type: "psd-complete",
                    output: masterPsdPath
                });
            } catch (error) {
                masterPsdError = error?.message || String(error);
                masterPsdPath = null;

                event.sender.send("amazon:processing-progress", {
                    type: "psd-error",
                    error: masterPsdError
                });
            }
        }

        const successful = allResults.filter(item => item.ok).length;
        const failed = allResults.length - successful;

        return {
            ok: true,
            successful,
            failed,
            results: allResults,
            parentResults,
            outputFolder,
            jpgRootFolder,
            masterPsdPath,
            masterPsdFileName: psdName.fileName,
            masterPsdError
        };
    } finally {
        await fs.promises.rm(workRoot, { recursive: true, force: true })
            .catch(() => {});
    }
}

// Sharing preflight is separate from execution, so users can inspect ALL
// filename collisions and explicitly approve any existing outputs beforehand.
ipcMain.handle("amazon:preflight-sharing", async (_event, payload) => {
    try {
        const psdName = normalizePsdFileName(payload?.psdFileName);
        const inspected = await inspectSharingRequest(payload || {}, psdName);
        return {
            ok: inspected.ok,
            errors: inspected.errors || [],
            existingFiles: inspected.existingFiles || [],
            sourceCount: inspected.sourceCount || 0,
            sharedCount: inspected.sharedCount || 0,
            totalVariants: inspected.totalVariants || 0,
            jpgCount: inspected.jpgCount || 0
        };
    } catch (error) {
        return { ok: false, errors: [error?.message || String(error)] };
    }
});

// Colorbox is a SEPARATE IPC step invoked only after processAmazonJob resolves.
ipcMain.handle("amazon:start-processing", async (event, payload) => {
    if (amazonIsRunning || colorboxIsRunning) {
        return { ok: false, error: "Another Amazon/Colorbox operation is still running." };
    }
    amazonIsRunning = true;
    pendingColorboxJob = null;
    try {
        const isBatchWorkspace = payload?.mode === "batch";
        const hasSharing = (payload?.parents || []).some(parent =>
            (parent.variants || []).some(variant => Array.isArray(variant.sharedIds) && variant.sharedIds.length > 0)
        );
        let result;
        if (isBatchWorkspace) {
            // Never trust a renderer-only preflight: validate all real files and
            // output collisions again immediately before publishing.
            const psdName = normalizePsdFileName(payload?.psdFileName);
            const checked = await validateVirtualBatch(payload);
            if (!checked.ok) return { ok: false, error: checked.errors.join("\n") };
            const virtualPayload = { ...payload, parents: checked.parents };
            const inspection = await inspectSharingRequest(virtualPayload, psdName);
            if (!inspection.ok) {
                return { ok: false, error: (inspection.errors || []).join("\n") || "Batch Workspace preflight failed." };
            }
            result = await processSharedAmazonJob(event, virtualPayload, psdName, inspection);
        } else if (hasSharing) {
            const psdName = normalizePsdFileName(payload?.psdFileName);
            const inspection = await inspectSharingRequest(payload, psdName);
            if (!inspection.ok) {
                return { ok: false, error: (inspection.errors || []).join("\n") || "Sharing preflight failed." };
            }
            result = await processSharedAmazonJob(event, payload, psdName, inspection);
        } else {
            // The original non-sharing Amazon pipeline is unchanged.
            result = await processAmazonJob(event, payload);
        }
        if (!result?.ok) return result;

        const successfulBrands = (result.parentResults || [])
            .filter(item => Number(item?.successful) > 0)
            .map(item => item.parentId)
            .filter(Boolean);
        const jpgCount = (result.results || [])
            .filter(item => item?.ok && Array.isArray(item.jpgs))
            .reduce((sum, item) => sum + item.jpgs.length, 0);
        const cleanBatch = result.failed === 0 && !result.masterPsdError;
        const renderedSourceCount = result.sourceSuccessful ?? result.successful;
        const progression = result.successful > 0
            ? await recordProductionEvent({
                kind: "amazon",
                label: String(result.masterPsdFileName || "Amazon batch").replace(/\.psd$/i, ""),
                subtitle: result.sharingEnabled
                    ? `${renderedSourceCount} source set(s) · ${result.sharedSuccessful} shared ID(s) · ${successfulBrands.length} brand(s)`
                    : `${result.successful} variant${result.successful === 1 ? "" : "s"} · ${successfulBrands.length} brand${successfulBrands.length === 1 ? "" : "s"}`,
                brandNames: successfulBrands,
                itemCount: result.successful,
                amazonVariants: result.successful,
                outputFiles: jpgCount + (result.masterPsdPath ? 1 : 0),
                outputPath: result.outputFolder,
                status: cleanBatch ? "success" : "partial",
                qcPerfect: cleanBatch,
                xp: (renderedSourceCount * 10) + (cleanBatch ? 15 : 0) + (result.masterPsdPath ? 20 : 0)
            })
            : null;
        result.progression = progression;

        // Colorbox must use the FIRST EXPORTED AMAZON JPG, not the original
        // source file. This guarantees the Colorbox has the exact same final
        // 1001x1001 composition, product size, placement, crop handling and
        // white background as Amazon image #1 for that variant.
        const items = (result.results || [])
            .filter(item => item?.ok && Array.isArray(item.jpgs) && item.jpgs[0])
            .map(item => ({
                parentId: item.parentId,
                variantId: item.variantId,
                sourcePath: item.jpgs[0],
                sourceName: path.basename(item.jpgs[0])
            }));

        // Protect the generated Amazon JPGs themselves. The Colorbox output
        // uses a different filename (variant-idclr.jpg), so choosing the same
        // folder is still safe.
        // Protect ALL Amazon exports, not only image #1, against accidental
        // Colorbox replacement when both output folders are the same.
        const protectedSourcePaths = (result.results || [])
            .filter(item => item?.ok && Array.isArray(item.jpgs))
            .flatMap(item => item.jpgs);

        if (!items.length) return { ...result, colorboxEligibleCount: 0 };

        const id = randomUUID();
        pendingColorboxJob = {
            id,
            ownerId: event.sender.id,
            items,
            protectedSourcePaths,
            masterPsdError: result.masterPsdError || null,
            masterPsdPath: result.masterPsdPath || null,
            jpgRootFolder: result.jpgRootFolder,
            successful: result.successful,
            failed: result.failed
        };
        return { ...result, colorboxJobId: id, colorboxEligibleCount: items.length };
    } catch (error) {
        return { ok: false, error: error?.message || String(error) };
    } finally {
        amazonIsRunning = false;
    }
});

function sendColorboxProgress(event, data) {
    if (!event.sender.isDestroyed()) event.sender.send("amazon:processing-progress", data);
}

async function showColorboxMessage(event, options) {
    const owner = BrowserWindow.fromWebContents(event.sender);
    return owner && !owner.isDestroyed()
        ? dialog.showMessageBox(owner, options)
        : dialog.showMessageBox(options);
}

async function chooseColorboxDirectory(event) {
    const state = readDialogState();
    const options = {
        title: "Choose Colorbox save folder - same as Amazon image 1",
        defaultPath: usableDirectory(state.lastColorboxFolder) ||
            usableDirectory(state.lastOutputFolder) || usableDirectory(state.lastParentLocation),
        buttonLabel: "Save Colorboxes Here",
        properties: ["openDirectory"]
    };
    const owner = BrowserWindow.fromWebContents(event.sender);
    const selected = owner && !owner.isDestroyed()
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
    if (selected.canceled || !selected.filePaths.length) return null;
    writeDialogState({ lastColorboxFolder: selected.filePaths[0] });
    return selected.filePaths[0];
}

ipcMain.handle("amazon:offer-colorbox", async (event, payload) => {
    if (amazonIsRunning || colorboxIsRunning) {
        return { ok: false, error: "Wait for the current operation to finish." };
    }
    const job = pendingColorboxJob;
    if (!job || job.ownerId !== event.sender.id || payload?.jobId !== job.id) {
        return { ok: false, error: "No matching completed Amazon job is available for Colorbox." };
    }

    colorboxIsRunning = true;
    try {
        const detail = [
            `Successful Amazon variants: ${job.successful}. Failed: ${job.failed}.`,
            job.masterPsdError ? "The master PSD reported an error. Successful variants can still be used." :
                "Amazon JPGs and the master PSD have finished generating.",
            "",
            `Colorbox will use the FIRST EXPORTED AMAZON JPG of each of ${job.items.length} successful variants.`,
            "It is copied from Amazon image #1 exactly as generated — same canvas size, product size, placement and crop result.",
            "No original PSD/JPG source is used for Colorbox anymore.",
            "Output: lowercase-variant-idclr.jpg. The Amazon JPG is copied without resizing or re-rendering.",
            "You will choose a separate save folder next."
        ].join("\n");
        const answer = await showColorboxMessage(event, {
            type: "question",
            title: "Amazon finished - optional Colorbox",
            message: "Generate Colorbox images now?",
            detail,
            buttons: ["Generate Colorbox", "Skip"],
            defaultId: 1,
            cancelId: 1,
            noLink: true
        });
        if (answer.response !== 0) return { ok: true, skipped: true, reason: "user-skipped" };

        const folder = await chooseColorboxDirectory(event);
        if (!folder) return { ok: true, skipped: true, reason: "folder-canceled" };

        // No Colorbox module, image decode or copy is needed before this point.
        const { prepareColorboxPlan, exportColorboxes } = require("./colorboxExporter");
        const plan = await prepareColorboxPlan(job.items, folder, job.protectedSourcePaths);
        let overwrite = false;
        if (plan.existingCount > 0) {
            const answer = await showColorboxMessage(event, {
                type: "question",
                title: "Existing Colorbox files",
                message: `${plan.existingCount} Colorbox file(s) already exist.`,
                detail: "Replace only the matching Colorbox output files, keep them, or cancel. Original input files are never overwritten.",
                buttons: ["Replace Existing", "Keep Existing", "Cancel"],
                defaultId: 1,
                cancelId: 2,
                noLink: true
            });
            if (answer.response === 2) return { ok: true, skipped: true, reason: "conflict-canceled" };
            overwrite = answer.response === 0;
        }
        const result = await exportColorboxes(plan, { overwrite }, data => sendColorboxProgress(event, data));
        const colorboxProgression = result.successful > 0
            ? await recordProductionEvent({
                kind: "colorbox",
                label: "Colorbox export",
                subtitle: `${result.successful} new Colorbox image${result.successful === 1 ? "" : "s"}`,
                brandNames: Array.from(new Set(job.items.map(item => item.parentId).filter(Boolean))),
                itemCount: result.successful,
                colorboxes: result.successful,
                outputFiles: result.successful,
                outputPath: result.outputFolder,
                status: result.failed ? "partial" : "success",
                countsAsJob: false,
                xp: result.successful * 5
            })
            : null;
        return { ...result, skipped: false, skippedFiles: result.skipped, progression: colorboxProgression };
    } catch (error) {
        return { ok: false, error: error?.message || String(error) };
    } finally {
        if (pendingColorboxJob?.id === job.id) pendingColorboxJob = null;
        colorboxIsRunning = false;
    }
});
