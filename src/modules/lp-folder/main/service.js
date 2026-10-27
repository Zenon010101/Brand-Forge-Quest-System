"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { scanFolder, createLayout } = require("./planner");
const { previewImage, buildLayeredPsd } = require("./photoshop");
const { publishLP, familyRegex } = require("./output");

class LPFolderService {
    constructor({ builder = buildLayeredPsd, preview = previewImage, publisher = publishLP } = {}) {
        this.snapshot = null;
        this.busy = false;
        this.builder = builder;
        this.previewer = preview;
        this.publisher = publisher;
        this.lastOutput = null;
        this.lastJPEGPaths = [];
    }
    getState() { return this.snapshot ? { ...this.snapshot, lastOutput: this.lastOutput, lastJPEGPaths: this.lastJPEGPaths } : null; }
    async chooseFolder(folder) {
        if (this.busy) throw new Error("PSD generation is in progress. Wait for the current export to finish.");
        const snapshot = await scanFolder(folder);
        this.lastOutput = null;
        this.lastJPEGPaths = [];
        this.snapshot = snapshot;
        return this.getState();
    }
    requireEntry(file) {
        if (!this.snapshot) throw new Error("Select an LP source folder first.");
        const entry = this.snapshot.images.find(i => i.path.toLowerCase() === String(file).toLowerCase());
        if (!entry) throw new Error("Image does not belong to the currently selected LP folder.");
        return entry;
    }
    async preview(payload) {
        const entry = this.requireEntry(payload?.filePath);
        return { filePath: entry.path, dataUrl: await this.previewer(entry, payload?.maxEdge),
            width: entry.width, height: entry.height };
    }
    layout(payload) {
        if (!this.snapshot) throw new Error("Select an LP source folder first.");
        return createLayout(this.snapshot, payload?.orderedPaths, payload?.singlePath, payload?.outputBaseName);
    }
    async generate(payload, progress = () => {}) {
        if (this.busy) throw new Error("The LP Folder Generator is already processing another job.");
        const layout = this.layout(payload);
        const original = [layout.single, ...layout.sections];
        for (const entry of original) {
            const now = await fs.promises.stat(entry.path);
            if (!now.isFile() || now.size !== entry.bytes || now.mtimeMs !== entry.mtimeMs) {
                throw new Error(`${entry.name} changed since folder scan. Refresh the folder before generating.`);
            }
        }
        const action = payload?.existingAction || "version";
        if (!["version", "replace", "cancel"].includes(action)) throw new Error("Invalid save behavior.");
        const folder = await fs.promises.realpath(this.snapshot.folder);
        if (action === "cancel" && (await fs.promises.readdir(folder)).some(name => familyRegex(layout.baseName).test(name))) {
            throw new Error(`An ${layout.baseName} Photoshop/JPEG output already exists. Choose Save New Version or Back Up + Replace.`);
        }
        this.busy = true;
        let work = null;
        try {
            work = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-lp-folder-"));
            progress({ stage: "planning", message: `1000 × ${layout.height.toLocaleString()} px · ${layout.sections.length + 1} image layers` });
            const staged = await this.builder(layout, work, progress);
            if (!staged || !Array.isArray(staged.jpegParts) ||
                staged.jpegParts.reduce((sum, part) => sum + (Number(part.height) || 0), 0) !== layout.height) {
                throw new Error("JPEG export does not cover the entire landing page height. No files were published.");
            }
            progress({ stage: "saving", message: `Saving editable ${layout.format.toUpperCase()} and JPEG${staged.jpegParts.length === 1 ? "" : " parts"} beside the LP images…` });
            const saved = await this.publisher(staged, folder, layout.baseName, layout.format, action);
            this.lastOutput = saved.outputPath;
            this.lastJPEGPaths = saved.jpegPaths;
            progress({ stage: "done", message: `Saved ${path.basename(saved.outputPath)} and ${saved.jpegPaths.length} JPEG${saved.jpegPaths.length === 1 ? "" : " files"}${saved.trackingWarning ? ` · ${saved.trackingWarning}` : ""}` });
            return { ok: true, ...saved, width: layout.width, height: layout.height, format: layout.format,
                layerCount: layout.sections.length + 1, single: layout.single.name, sourceFolder: folder };
        } finally {
            if (work) await fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
            this.busy = false;
        }
    }
}

module.exports = { LPFolderService };
