"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { randomUUID } = require("crypto");
const { scanParentFolder } = require("./folderScanner");
const { processVariant } = require("./imageProcessor");
const { buildAmazonPsd } = require("./psdBuilder");
const { buildSharingPlan, outputName, idKey } = require("../shared/sharingPlan");
const { preflightDestinations, publishGroup } = require("./sharedExporter");

function selectedSources(parents) {
    return parents.flatMap(parent => (parent.variants || [])
        .flatMap(variant => (variant.files || []).map(file => file.path)));
}

function scanPhysicalSources(parents) {
    const ids = [];
    const paths = [];
    for (const parent of parents) {
        if (!parent.folderPath) continue;
        const scanned = scanParentFolder(parent.folderPath);
        ids.push(...scanned.variants.map(variant => variant.id));
        paths.push(...scanned.variants.flatMap(variant => variant.files.map(file => file.path)));
    }
    return { ids, paths };
}

async function inspectSharingRequest(payload, psdName) {
    const parents = Array.isArray(payload?.parents) ? payload.parents : [];
    if (!parents.length) {
        return { ok: false, errors: ["No selected Amazon source variants."] };
    }
    const parentKeys = parents.map(parent => idKey(parent.id));
    if (new Set(parentKeys).size !== parents.length) {
        return { ok: false, errors: ["Two selected Parent folders have the same name."] };
    }
    try {
        // The real disk scan prevents a new shared ID from shadowing an unselected
        // physical Variant ID. The renderer also checks this immediately.
        const physical = scanPhysicalSources(parents);
        const plan = buildSharingPlan(parents, {
            reservedVariantIds: physical.ids.concat(payload.reservedVariantIds || [])
        });
        // Protect all scanned source images, including unselected candidates
        // such as 1.jpg that sit alongside a chosen 1.psd.
        const preflight = await preflightDestinations(
            plan, payload.outputFolder, psdName.fileName,
            physical.paths.concat(selectedSources(parents))
        );
        return { ...preflight, plan, psdName };
    } catch (error) {
        return { ok: false, errors: [`Amazon sharing preflight failed: ${error.message || String(error)}`] };
    }
}

async function processSharedAmazonJob(event, payload, psdName, inspection) {
    const parents = payload.parents;
    const outputFolder = payload.outputFolder;
    const existingFiles = inspection.existingFiles || [];
    const confirmed = new Set((payload.confirmedExistingFiles || []).map(idKey));
    const unexpected = existingFiles.filter(name => !confirmed.has(idKey(name)));
    if (unexpected.length) {
        return {
            ok: false,
            error: `${unexpected.length} existing Amazon output file(s) need explicit overwrite approval: ${unexpected.slice(0, 8).join(", ")}. Run preflight again.`
        };
    }

    const emit = data => {
        // The Amazon module is rendered inside an iframe. Send progress to the
        // calling frame, not just its containing BrowserWindow.
        try {
            if (event.senderFrame?.send) event.senderFrame.send("amazon:processing-progress", data);
            else if (!event.sender.isDestroyed?.()) event.sender.send("amazon:processing-progress", data);
        } catch (error) {
            // Closing/reloading the renderer must not stop an in-progress batch.
        }
    };
    let stageRoot = null;
    let workRoot = null;
    let retainStage = false;
    const allResults = [];
    const parentResults = [];
    const successfulParentGroups = [];
    let sourceSuccessful = 0;
    let masterPsdPath = null;
    let masterPsdError = null;

    try {
        // Local staging avoids syncing temporary files and works with Google Drive
        // and other virtual/mapped output filesystems that reject hard links.
        stageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "amazon-sharing-stage-"));
        workRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "amazon-sharing-work-"));
        const jpgStage = path.join(stageRoot, "jpgs");
        const backupFolder = path.join(stageRoot, "backups");
        await fs.promises.mkdir(jpgStage);
        const publishOptions = { outputFolder, backupFolder, confirmedExistingPaths: payload.confirmedExistingFiles || [] };

        for (let parentIndex = 0; parentIndex < parents.length; parentIndex++) {
            const parent = parents[parentIndex];
            const parentId = parent.id;
            const variants = parent.variants || [];
            const successfulForParent = [];
            const parentVariantResults = [];
            emit({ type: "parent-start", parentId, current: parentIndex + 1, total: parents.length });
            const parentWorkFolder = path.join(workRoot, String(parentIndex + 1));
            await fs.promises.mkdir(parentWorkFolder);

            const complete = (variantId, role, jpgs, sourceId, count, total) => {
                const item = { parentId, variantId, role, sourceId: sourceId || null, ok: true, jpgs };
                allResults.push(item);
                parentVariantResults.push(item);
                emit({ type: "variant-complete", parentId, variantId, role, current: count, total });
            };
            const fail = (variantId, role, error, sourceId) => {
                const message = error?.message || String(error);
                const item = { parentId, variantId, role, sourceId: sourceId || null, ok: false, error: message };
                allResults.push(item);
                parentVariantResults.push(item);
                if (error?.retainStage) retainStage = true;
                emit({ type: "variant-error", parentId, variantId, role, error: message });
            };
            const plannedCount = variants.reduce((sum, variant) => sum + 1 + (variant.sharedIds || []).length, 0);
            let current = 0;

            for (const variant of variants) {
                const variantId = variant.id;
                const sharedIds = variant.sharedIds || [];
                const sourcePosition = ++current;
                emit({ type: "variant-start", parentId, variantId, current, total: plannedCount });
                let processed = null;
                let sourceStageJpgs = [];
                try {
                    processed = await processVariant(
                        { id: variantId, files: variant.files },
                        jpgStage, parentWorkFolder,
                        progress => emit({ type: "image-progress", parentId, ...progress })
                    );
                    sourceStageJpgs = [...processed.jpgs];
                    const pairs = sourceStageJpgs.map((staged, index) => ({
                        staged, name: outputName(variantId, index + 1)
                    }));
                    const jpgs = await publishGroup(pairs, publishOptions);
                    processed.jpgs = jpgs;
                    successfulForParent.push(processed);
                    sourceSuccessful++;
                    complete(variantId, "source", jpgs, null, sourcePosition, plannedCount);
                } catch (error) {
                    fail(variantId, "source", error);
                }

                for (const sharedId of sharedIds) {
                    ++current;
                    emit({ type: "shared-start", parentId, variantId: sharedId, sourceId: variantId, current, total: plannedCount });
                    if (!processed || !allResults.some(r => r.parentId === parentId && r.variantId === variantId && r.ok)) {
                        fail(sharedId, "shared", new Error(`Source ${variantId} failed; no images were copied.`), variantId);
                        continue;
                    }
                    try {
                        // Copy the FINISHED JPG bytes. Photoshop extraction, trimming and
                        // 801/921 rendering were already performed exactly once.
                        // Reuse original LOCAL rendered JPGs, not the synced final
                        // files on G:; no additional image processing or G: reads.
                        const pairs = sourceStageJpgs.map((staged, index) => ({
                            staged, name: outputName(sharedId, index + 1)
                        }));
                        const jpgs = await publishGroup(pairs, publishOptions);
                        const layers = processed.layers.map((layer, index) => ({
                            pngPath: layer.pngPath,
                            layerName: outputName(sharedId, index + 1).replace(/\.jpg$/i, "")
                        }));
                        successfulForParent.push({ variantId: sharedId, layers, jpgs });
                        complete(sharedId, "shared", jpgs, variantId, current, plannedCount);
                    } catch (error) {
                        fail(sharedId, "shared", error, variantId);
                    }
                }
            }

            if (successfulForParent.length) {
                successfulParentGroups.push({ parentId, variants: successfulForParent });
            }
            parentResults.push({
                parentId,
                ok: parentVariantResults.some(result => result.ok),
                jpgOutputFolder: outputFolder,
                successful: parentVariantResults.filter(result => result.ok).length,
                failed: parentVariantResults.filter(result => !result.ok).length,
                psdIncludedInMaster: successfulForParent.length > 0
            });
            emit({ type: "parent-complete", parentId, current: parentIndex + 1, total: parents.length });
        }

        if (successfulParentGroups.length) {
            const stagedPsd = path.join(stageRoot, `${randomUUID()}.psd`);
            const finalPsd = path.join(outputFolder, psdName.fileName);
            emit({ type: "psd-start", output: finalPsd });
            try {
                await buildAmazonPsd(psdName.baseName, successfulParentGroups, stagedPsd);
                await publishGroup([{ staged: stagedPsd, name: psdName.fileName }], publishOptions);
                masterPsdPath = finalPsd;
                emit({ type: "psd-complete", output: masterPsdPath });
            } catch (error) {
                if (error?.retainStage) retainStage = true;
                masterPsdError = error?.message || String(error);
                emit({ type: "psd-error", error: masterPsdError });
            }
        }

        return {
            ok: true,
            successful: allResults.filter(r => r.ok).length,
            failed: allResults.filter(r => !r.ok).length,
            sourceSuccessful,
            sharedSuccessful: allResults.filter(r => r.ok && r.role === "shared").length,
            results: allResults,
            parentResults,
            outputFolder,
            jpgRootFolder: outputFolder,
            masterPsdPath,
            masterPsdFileName: psdName.fileName,
            masterPsdError,
            sharingEnabled: true
        };
    } finally {
        if (workRoot) await fs.promises.rm(workRoot, { recursive: true, force: true }).catch(() => {});
        if (stageRoot && !retainStage) await fs.promises.rm(stageRoot, { recursive: true, force: true }).catch(() => {});
    }
}

module.exports = { inspectSharingRequest, processSharedAmazonJob };
