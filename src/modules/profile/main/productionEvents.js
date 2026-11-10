"use strict";

const path = require("path");

function nonnegative(value) { return Math.max(0, Math.floor(Number(value) || 0)); }
function outputName(file) { return path.parse(String(file || "Production")).name || "Production"; }

// Only completed, published outputs earn EXP. BG/Shadow batches may be partially
// successful; do not reward all-failed or already-processed/no-op batches.
function makeProductionEvent(kind, result, context = {}) {
    if (!result || result.ok !== true) return null;
    if (kind === "landing-page") {
        if (!result.psdPath) return null;
        const count = nonnegative(result.counts?.rasterParts) + (context.hasSingle ? 1 : 0);
        return {
            kind, label: outputName(result.psdPath),
            subtitle: `Screenshot LP · ${nonnegative(result.counts?.rasterParts)} screenshot(s)`,
            itemCount: count, outputFiles: 1, outputPath: result.psdPath,
            status: "success", xp: 20 + 2 * count
        };
    }
    if (kind === "lp-folder") {
        if (!result.outputPath) return null;
        const count = nonnegative(result.layerCount);
        const jpegs = Array.isArray(result.jpegPaths) ? result.jpegPaths.length : 0;
        return {
            kind, label: outputName(result.outputPath),
            subtitle: `Folder LP · ${count} image layer(s) · ${jpegs} JPEG output(s)`,
            itemCount: count, outputFiles: 1 + jpegs, outputPath: result.outputPath,
            status: "success", xp: 20 + 2 * count
        };
    }
    if (kind === "combine") {
        if (!result.outputPath) return null;
        const count = nonnegative(result.sourceCount);
        const jpegs = Array.isArray(result.jpegPaths) ? result.jpegPaths.length : 0;
        return {
            kind, label: outputName(result.outputPath),
            subtitle: `Combine · ${nonnegative(result.lineupCount)} Line Up · ${nonnegative(result.detailCount)} Details`,
            itemCount: count, outputFiles: 1 + jpegs, outputPath: result.outputPath,
            status: "success", xp: 20 + 2 * count
        };
    }
    if (kind === "remove-bg" || kind === "shadow") {
        const successful = nonnegative(result.success);
        if (!successful) return null;
        const failed = nonnegative(result.failed);
        const output = (result.results || []).find(item => item && item.ok === true);
        const firstOutput = kind === "remove-bg" ? output?.pngPath : output?.psdPath;
        return {
            kind, label: kind === "remove-bg" ? "Remove Background" : "Add Shadow",
            subtitle: `${successful} image(s) completed${failed ? ` · ${failed} failed` : ""}`,
            itemCount: successful, outputFiles: successful, outputPath: firstOutput || null,
            status: failed ? "partial" : "success",
            xp: 10 + successful * (kind === "remove-bg" ? 4 : 5)
        };
    }
    throw new Error(`Unsupported production event: ${kind}`);
}

async function recordCompletedProduction(kind, result, context, recorder) {
    const productionEvent = makeProductionEvent(kind, result, context);
    if (!productionEvent) return result;
    try {
        const progression = await recorder(productionEvent);
        return { ...result, progression: progression || null };
    } catch (error) {
        // A history/EXP write failure must not turn a verified Photoshop export
        // into a failed job or cause an unsafe second generation attempt.
        return {
            ...result, progression: null,
            progressionWarning: `Output saved, but History/EXP could not be updated: ${error?.message || String(error)}`
        };
    }
}

module.exports = { makeProductionEvent, recordCompletedProduction };
