"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { pathToFileURL } = require("url");
const {
    inspectSource, pathKey, outputPaths, stagePath,
    pathExists, commitStagedFile
} = require("./files");
const {
    removeBackgroundInPhotoshop,
    createShadowPsdInPhotoshop
} = require("./photoshopBridge");

const ERROR_LABELS = {
    remove: "Remove BG Failed",
    shadow: "Shadow Failed"
};

async function analyzePng(filePath) {
    const image = sharp(filePath, { limitInputPixels: 268402689 });
    const metadata = await image.metadata();
    if (metadata.format !== "png" || !metadata.width || !metadata.height) {
        throw new Error("Photoshop did not generate a valid PNG image.");
    }
    const stats = await sharp(filePath).ensureAlpha().stats();
    const alpha = stats.channels[3];
    if (!alpha || alpha.max === 0 || alpha.mean === 0) {
        throw new Error("PNG contains no visible product pixels.");
    }
    if (alpha.min === 255 || alpha.mean > 254.5) {
        throw new Error("PNG has no meaningful transparent background. Check the Photoshop Remove Background result.");
    }
    return { width: metadata.width, height: metadata.height, hasTransparency: true };
}

async function sourceHasTransparency(sourcePath) {
    const ext = path.extname(sourcePath).toLowerCase();
    // PSD/PSB need their visible Photoshop composite inspected; a file's
    // metadata alone does not represent which PSD layers are visible.
    if ([".psd", ".psb", ".jpg", ".jpeg", ".bmp", ".tga", ".heic", ".heif"].includes(ext)) return false;
    try {
        const image = sharp(sourcePath);
        const meta = await image.metadata();
        if (!meta.hasAlpha) return false;
        const stats = await image.ensureAlpha().stats();
        return !!stats.channels[3] && stats.channels[3].min < 255 &&
            stats.channels[3].max > 0 && stats.channels[3].mean < 254.5;
    } catch (error) {
        // Let Photoshop try to open valid files not supported by Sharp.
        return false;
    }
}

async function validatePsd(filePath) {
    const handle = await fs.promises.open(filePath, "r");
    try {
        const header = Buffer.alloc(4);
        const result = await handle.read(header, 0, 4, 0);
        const stat = await handle.stat();
        if (result.bytesRead !== 4 || header.toString("ascii") !== "8BPS" || stat.size < 30) {
            throw new Error("Photoshop did not generate a valid PSD file.");
        }
    } finally {
        await handle.close();
    }
}

class RemoveBgProcessor {
    constructor(deps = {}) {
        this.items = new Map();
        this.active = false;
        this.removeInPhotoshop = deps.removeInPhotoshop || removeBackgroundInPhotoshop;
        this.addShadowInPhotoshop = deps.addShadowInPhotoshop || createShadowPsdInPhotoshop;
    }

    async add(paths) {
        if (this.active) throw new Error("Cannot add files while a batch is processing.");
        const added = [];
        const rejected = [];
        const skipped = [];
        const queuedOutputs = new Map();
        for (const state of this.items.values()) queuedOutputs.set(pathKey(state.png), state.path);
        const supplied = Array.isArray(paths) ? paths.slice(0, 500) : [];
        for (const filePath of supplied) {
            try {
                const file = await inspectSource(filePath);
                const key = pathKey(file.path);
                if (this.items.has(key)) {
                    skipped.push(file.name);
                    continue;
                }
                const outputCollision = queuedOutputs.get(pathKey(file.png));
                if (outputCollision && pathKey(outputCollision) !== key) {
                    throw new Error(`Output-name conflict with ${path.basename(outputCollision)}. Remove one of these sources from the queue.`);
                }
                // A previously exported, transparent same-folder PNG can be
                // reused for step 2 after an application restart. No Photoshop
                // background removal, rewriting, or shadow creation occurs on
                // import. Restrict recovery to a non-stale, valid cutout;
                // users must still visually approve it in the QC preview.
                const recovered = await this.hasReusablePng(file);
                const state = {
                    ...file,
                    status: recovered ? "PNG Ready" : "Original",
                    message: recovered
                        ? "Existing transparent PNG loaded from disk. Inspect PNG Result before Add Shadow."
                        : "Ready for background removal.",
                    pngReady: recovered,
                    shadowReady: false
                };
                this.items.set(key, state);
                queuedOutputs.set(pathKey(file.png), file.path);
                added.push(this.publicState(state));
            } catch (error) {
                rejected.push({ name: path.basename(String(filePath || "Unknown file")), reason: error.message });
            }
        }
        return { added, rejected, skipped };
    }

    async hasReusablePng(file) {
        if (!(await pathExists(file.png))) return false;
        try {
            const stat = await fs.promises.stat(file.png);
            if (!stat.isFile() || !stat.size) return false;
            // Don't accidentally reuse an old cutout after the source photo
            // was edited. Same-file transparent PNGs are always eligible.
            if (pathKey(file.path) !== pathKey(file.png) &&
                stat.mtimeMs + 2000 < file.modifiedMs) return false;
            await analyzePng(file.png);
            return true;
        } catch (_) {
            // A corrupt / opaque / unreadable output is not a valid cutout.
            return false;
        }
    }

    getState() {
        return {
            ok: true,
            active: this.active,
            items: Array.from(this.items.values(), item => this.publicState(item))
        };
    }

    publicState(item) {
        return {
            path: item.path, name: item.name, extension: item.extension,
            size: item.size, modifiedMs: item.modifiedMs,
            pngPath: item.pngReady ? item.png : null,
            psdPath: item.shadowReady ? item.psd : null,
            originalUrl: pathToFileURL(item.originalBackupPath || item.path).href,
            originalPreviewPath: item.originalBackupPath || item.path,
            pngUrl: item.pngReady ? pathToFileURL(item.png).href : null,
            status: item.status, message: item.message
        };
    }

    removeFromQueue(paths) {
        if (this.active) throw new Error("Cannot change the queue while a batch is processing.");
        for (const filePath of (Array.isArray(paths) ? paths : [])) {
            if (typeof filePath === "string") this.items.delete(pathKey(filePath));
        }
        return { ok: true };
    }

    async batch(phase, paths, overwrite, progress = () => {}) {
        if (this.active) return { ok: false, error: "Another background/shadow batch is processing." };
        if (phase !== "remove" && phase !== "shadow") return { ok: false, error: "Unknown processing phase." };
        this.active = true;
        try {
            const unique = new Set();
            const items = [];
            for (const filePath of (Array.isArray(paths) ? paths : [])) {
                if (typeof filePath !== "string") continue;
                const key = pathKey(filePath);
                if (unique.has(key)) continue;
                unique.add(key);
                const item = this.items.get(key);
                if (!item) continue;
                if (phase === "remove" && item.pngReady) continue;
                if (phase === "shadow" && (!item.pngReady || item.shadowReady)) continue;
                items.push(item);
            }
            const results = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                item.status = "Processing...";
                item.message = phase === "remove" ? "Removing background..." : "Creating editable shadow PSD...";
                progress({ phase, status: "processing", path: item.path, message: item.message, current: i + 1, total: items.length });
                try {
                    const output = phase === "remove"
                        ? await this.removeOne(item, !!overwrite, message => progress({ phase, status: "stage", path: item.path, message, current: i + 1, total: items.length }))
                        : await this.shadowOne(item, !!overwrite, message => progress({ phase, status: "stage", path: item.path, message, current: i + 1, total: items.length }));
                    item.status = phase === "remove" ? "PNG Ready" : "Shadow Ready";
                    item.message = output.backupPath
                        ? `Ready. Previous file backed up in GWS Backups.`
                        : phase === "remove" ? "Transparent PNG ready for visual QC." : "PSD saved with Main and Shadow layers.";
                    if (phase === "remove") item.pngReady = true;
                    else item.shadowReady = true;
                    const destination = phase === "remove" ? item.png : item.psd;
                    if (output.backupPath && pathKey(item.path) === pathKey(destination)) {
                        item.originalBackupPath = output.backupPath;
                    }
                    const value = { ok: true, ...this.publicState(item) };
                    results.push(value);
                    progress({ phase, status: "done", path: item.path, result: value, current: i + 1, total: items.length });
                } catch (error) {
                    item.status = ERROR_LABELS[phase];
                    item.message = error && error.message ? error.message : String(error);
                    if (phase === "remove") { item.pngReady = false; item.shadowReady = false; }
                    // Preserve the approved PNG when PSD creation fails.
                    const value = { ok: false, ...this.publicState(item), error: item.message };
                    results.push(value);
                    progress({ phase, status: "failed", path: item.path, result: value, current: i + 1, total: items.length });
                }
            }
            return {
                ok: true,
                phase,
                success: results.filter(x => x.ok).length,
                failed: results.filter(x => !x.ok).length,
                results
            };
        } finally {
            this.active = false;
        }
    }

    async removeOne(item, overwrite, onStage) {
        const output = item.png;
        const inputIsOutput = pathKey(item.path) === pathKey(output);
        const alreadyTransparent = await sourceHasTransparency(item.path);

        // A transparent source PNG IS the desired PNG result. Do not overwrite
        // or re-segment it, even if the overwrite setting is enabled.
        if (inputIsOutput && alreadyTransparent) {
            onStage("Checking existing transparent PNG...");
            await analyzePng(item.path);
            return { destination: output, backupPath: null };
        }
        // When the source itself is an opaque PNG, source.png IS the desired
        // output name. Automatically back it up rather than failing this file
        // or silently discarding the source. Other collisions require opt-in.
        const allowReplace = overwrite || inputIsOutput;
        if (await pathExists(output) && !allowReplace) {
            throw new Error(`${path.basename(output)} already exists. Enable 'Back up and replace existing files' to replace it safely.`);
        }
        const stage = stagePath(output);
        try {
            if (alreadyTransparent && ![".psd", ".psb"].includes(item.extension)) {
                onStage("Preserving the source's existing transparent pixels...");
                await sharp(item.path).png().toFile(stage);
            } else {
                onStage("Photoshop Remove Background is processing the product...");
                await this.removeInPhotoshop(item.path, stage);
            }
            onStage("Validating transparent PNG and preparing same-folder export...");
            await analyzePng(stage);
            return await commitStagedFile(stage, output, allowReplace);
        } finally {
            await fs.promises.rm(stage, { force: true }).catch(() => {});
        }
    }

    async shadowOne(item, overwrite, onStage) {
        if (!item.pngReady) throw new Error("Remove Background must succeed before Add Shadow.");
        // Source PSD/PSB with the same destination filename must be backed up
        // automatically so every accepted source can complete both stages.
        const allowReplace = overwrite || pathKey(item.psd) === pathKey(item.path);
        if (await pathExists(item.psd) && !allowReplace) {
            throw new Error(`${path.basename(item.psd)} already exists. Enable 'Back up and replace existing files' to replace it safely.`);
        }
        onStage("Checking approved PNG (background removal will NOT run again)...");
        await analyzePng(item.png);
        const stage = stagePath(item.psd);
        try {
            onStage("Photoshop is making Main (Smart Object) and the lower-half Shadow layer...");
            await this.addShadowInPhotoshop(item.png, stage);
            onStage("Verifying editable PSD output...");
            await validatePsd(stage);
            return await commitStagedFile(stage, item.psd, allowReplace);
        } finally {
            await fs.promises.rm(stage, { force: true }).catch(() => {});
        }
    }
}

module.exports = { RemoveBgProcessor, analyzePng, sourceHasTransparency, validatePsd };
