"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

// Colorbox is deliberately separate from amazonRules.js/imageProcessor.js.
// A Colorbox uses the FIRST EXPORTED AMAZON JPG for each successful variant.
// It is copied byte-for-byte into the user-selected Colorbox folder under the
// clr filename, so its dimensions/composition exactly match Amazon image #1.
// This file never resizes, trims, crops, positions or re-renders the image.

function pathKey(value) {
    return path.resolve(String(value)).replace(/\\/g, "/").toLowerCase();
}

function colorboxFilename(variantId) {
    const id = String(variantId || "").trim();
    if (!id || /[<>:"/\\|?*\x00-\x1f]/.test(id) || /[. ]$/.test(id) ||
        id === "." || id === "..") {
        throw new Error("Invalid Variant ID for Colorbox filename: " + id);
    }
    // Existing Colorbox convention: lowercase Variant ID + clr.jpg.
    return id.toLowerCase() + "clr.jpg";
}

async function canonicalKey(filePath) {
    try {
        return pathKey(await fs.promises.realpath(filePath));
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
        // Resolve the existing parent too, to catch directory junctions.
        try {
            const parent = await fs.promises.realpath(path.dirname(filePath));
            return pathKey(path.join(parent, path.basename(filePath)));
        } catch (parentError) {
            return pathKey(filePath);
        }
    }
}

async function existingStat(filePath) {
    try {
        return await fs.promises.lstat(filePath);
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
}

async function prepareColorboxPlan(items, outputFolder, protectedSourcePaths = []) {
    if (!Array.isArray(items) || !items.length) {
        throw new Error("No successful Amazon variants are available for Colorbox.");
    }
    if (!outputFolder || !path.isAbsolute(outputFolder)) {
        throw new Error("Choose a valid Colorbox output folder.");
    }
    const directoryStat = await fs.promises.stat(outputFolder);
    if (!directoryStat.isDirectory()) throw new Error("Colorbox destination is not a folder.");

    const sourcePaths = new Set([
        ...protectedSourcePaths,
        ...items.map(item => item.sourcePath)
    ].filter(Boolean));
    const protectedKeys = new Set();
    for (const sourcePath of sourcePaths) {
        protectedKeys.add(pathKey(sourcePath));
        protectedKeys.add(await canonicalKey(sourcePath));
    }

    const entries = [];
    const targets = new Map();
    for (const item of items) {
        const entry = { ...item, outputPath: null, exists: false, error: null };
        try {
            if (!item.sourcePath || !path.isAbsolute(item.sourcePath)) {
                throw new Error("First exported Amazon JPG path is missing or invalid.");
            }
            entry.outputPath = path.join(outputFolder, colorboxFilename(item.variantId));
            const targetKey = await canonicalKey(entry.outputPath);
            if (protectedKeys.has(pathKey(entry.outputPath)) || protectedKeys.has(targetKey)) {
                throw new Error("Destination is an original input file. Choose a different Colorbox folder.");
            }
            const stat = await existingStat(entry.outputPath);
            if (stat && (!stat.isFile() || stat.isSymbolicLink())) {
                throw new Error("Destination already exists and is not a regular file.");
            }
            entry.exists = Boolean(stat);
            const group = targets.get(pathKey(entry.outputPath)) || [];
            group.push(entry);
            targets.set(pathKey(entry.outputPath), group);
        } catch (error) {
            entry.error = error.message || String(error);
        }
        entries.push(entry);
    }
    for (const group of targets.values()) {
        if (group.length < 2) continue;
        const origins = group.map(item => item.parentId + " / " + item.variantId).join(", ");
        for (const entry of group) {
            entry.error = "Colorbox filename collision across variants: " + origins +
                ". Nothing will be overwritten for these duplicate names.";
        }
    }
    return {
        outputFolder,
        entries,
        protectedKeys: Array.from(protectedKeys),
        existingCount: entries.filter(entry => !entry.error && entry.exists).length
    };
}

function imageDimensions(metadata) {
    // Animated/multipage sources use one image/frame, never a vertical strip.
    return { width: metadata.width, height: metadata.pageHeight || metadata.height };
}

async function writeNativeSizeJpeg(sourcePath, stagedOutput) {
    // Colorbox source is already the finished Amazon image #1 JPEG.
    // Copy it byte-for-byte: no Sharp pipeline, no Photoshop, no resize,
    // no recompression and no metadata/pixel changes.
    const sourceStat = await fs.promises.stat(sourcePath);
    if (!sourceStat.isFile() || sourceStat.size === 0) {
        throw new Error("Amazon image #1 is not a readable non-empty file: " + sourcePath);
    }

    const extension = path.extname(sourcePath).toLowerCase();
    if (extension !== ".jpg" && extension !== ".jpeg") {
        throw new Error("Colorbox source must be the exported Amazon JPG: " + sourcePath);
    }

    await fs.promises.copyFile(sourcePath, stagedOutput, fs.constants.COPYFILE_EXCL);

    // Read metadata only to report/verify dimensions; the file itself is never rewritten.
    const sharp = require("sharp");
    const metadata = await sharp(sourcePath).metadata();
    const copied = await sharp(stagedOutput).metadata();

    if (!(metadata.width > 0 && metadata.height > 0)) {
        throw new Error("Cannot determine Amazon image #1 dimensions.");
    }
    if (copied.width !== metadata.width || copied.height !== metadata.height) {
        throw new Error(
            "Colorbox size check failed. Amazon image #1: " + metadata.width + "x" + metadata.height +
            "; Colorbox: " + copied.width + "x" + copied.height + ". Output was not published."
        );
    }

    return {
        width: metadata.width,
        height: metadata.height,
        mode: "amazon-first-jpg-byte-copy"
    };
}

async function publishStagedFile(staged, destination, overwrite, protectedKeys) {
    const key = await canonicalKey(destination);
    if (protectedKeys.has(key) || protectedKeys.has(pathKey(destination))) {
        throw new Error("Refusing to overwrite an original source file.");
    }
    const stat = await existingStat(destination);
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) {
        throw new Error("Output destination is not a regular file.");
    }
    if (!overwrite) {
        // Exclusive create also protects against a file appearing after the prompt.
        await fs.promises.copyFile(staged, destination, fs.constants.COPYFILE_EXCL);
        return;
    }
    // The staged JPEG is fully written and size-checked first. rename replaces
    // a regular file only after success; it never writes into the old file.
    await fs.promises.rename(staged, destination);
}

async function exportColorboxes(plan, options = {}, onProgress = () => {}) {
    if (!plan || !Array.isArray(plan.entries)) throw new Error("Invalid Colorbox export plan.");
    const overwrite = options.overwrite === true;
    const protectedKeys = new Set(plan.protectedKeys || []);
    const results = [];
    let stageRoot = null;
    let workRoot = null;
    const emit = data => {
        try { onProgress(data); } catch (error) { /* A closed UI cannot corrupt output. */ }
    };

    emit({ type: "colorbox-start", total: plan.entries.length, outputFolder: plan.outputFolder });
    try {
        stageRoot = await fs.promises.mkdtemp(path.join(plan.outputFolder, ".colorbox-stage-"));
        workRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "amazon-colorbox-"));
        for (let index = 0; index < plan.entries.length; index++) {
            const entry = plan.entries[index];
            const base = {
                parentId: entry.parentId,
                variantId: entry.variantId,
                sourcePath: entry.sourcePath,
                outputPath: entry.outputPath,
                current: index + 1,
                total: plan.entries.length
            };
            try {
                if (entry.error) throw new Error(entry.error);
                if (!overwrite && await existingStat(entry.outputPath)) {
                    results.push({ ...base, ok: true, skipped: true, reason: "Existing Colorbox kept." });
                    emit({ type: "colorbox-file-skipped", ...base });
                    continue;
                }
                emit({ type: "colorbox-file-start", ...base });
                const workFolder = path.join(workRoot, String(index + 1));
                await fs.promises.mkdir(workFolder);
                const staged = path.join(stageRoot, String(index + 1) + ".jpg");
                const size = await writeNativeSizeJpeg(entry.sourcePath, staged);
                await publishStagedFile(staged, entry.outputPath, overwrite, protectedKeys);
                results.push({ ...base, ...size, ok: true, skipped: false });
                emit({ type: "colorbox-file-complete", ...base, ...size });
            } catch (error) {
                if (error.code === "EEXIST" && !overwrite) {
                    results.push({ ...base, ok: true, skipped: true, reason: "Existing Colorbox kept." });
                    emit({ type: "colorbox-file-skipped", ...base });
                } else {
                    const message = error.message || String(error);
                    results.push({ ...base, ok: false, skipped: false, error: message });
                    emit({ type: "colorbox-file-error", ...base, error: message });
                }
            }
        }
    } finally {
        if (stageRoot) await fs.promises.rm(stageRoot, { recursive: true, force: true }).catch(() => {});
        if (workRoot) await fs.promises.rm(workRoot, { recursive: true, force: true }).catch(() => {});
    }
    const result = {
        ok: true,
        outputFolder: plan.outputFolder,
        successful: results.filter(item => item.ok && !item.skipped).length,
        failed: results.filter(item => !item.ok).length,
        skipped: results.filter(item => item.skipped).length,
        results
    };
    emit({ type: "colorbox-complete", ...result });
    return result;
}

module.exports = { colorboxFilename, prepareColorboxPlan, exportColorboxes };
