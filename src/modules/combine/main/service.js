"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { inspectBatch, inspectOne } = require("./assets");
const { buildCombineLayout } = require("./planner");
const { previewImage, createCombineFiles } = require("./photoshop");
const { publishCombine, familyRegex } = require("./publish");

class CombineService {
    constructor({ builder = createCombineFiles, publisher = publishCombine, preview = previewImage } = {}) {
        this.images = new Map();
        this.busy = false;
        this.outputFolder = null;
        this.lastOutput = null;
        this.builder = builder;
        this.publisher = publisher;
        this.previewer = preview;
    }
    getState() { return { outputFolder: this.outputFolder, lastOutput: this.lastOutput, busy: this.busy,
        images: Array.from(this.images.values()) }; }
    async addFiles(paths) {
        if (this.busy) throw new Error("Combine generation is in progress.");
        const result = await inspectBatch(paths || []);
        let added = 0;
        for (const file of result.images) {
            if (this.images.has(file.path.toLowerCase())) continue;
            this.images.set(file.path.toLowerCase(), file);
            added++;
        }
        return { ...result, added, state: this.getState() };
    }
    reset() {
        if (this.busy) throw new Error("Combine generation is in progress.");
        this.images.clear();
        this.lastOutput = null;
        return this.getState();
    }
    setOutputFolder(folder) {
        if (this.busy) throw new Error("Combine generation is in progress.");
        this.outputFolder = folder;
        return this.getState();
    }
    getImage(p) {
        const entry = this.images.get(String(p || "").toLowerCase());
        if (!entry) throw new Error("This image is not in the current Combine upload list. Add it first.");
        return entry;
    }
    layout(payload) {
        if (!payload || !payload.singlePath) throw new Error("Upload your Single image.");
        const resolve = p => this.getImage(p);
        const single = resolve(payload.singlePath);
        const lineup = (payload.lineup || []).map(item => {
            if (!item || typeof item !== "object") throw new Error("Invalid Line Up image entry.");
            return { ...resolve(item.path), colorName: String(item.colorName || "").trim() };
        });
        const details = (payload.details || []).map(p => resolve(typeof p === "string" ? p : p?.path));
        for (const group of [lineup, details]) {
            const seen = new Set();
            for (const entry of group) {
                if (seen.has(entry.path.toLowerCase())) throw new Error(`Duplicate image in same Combine section: ${entry.name}`);
                seen.add(entry.path.toLowerCase());
            }
        }
        return buildCombineLayout({ single, lineup, details, outputName: payload.outputName });
    }
    async preview(payload) {
        const entry = this.getImage(payload?.filePath);
        return { filePath: entry.path, width: entry.width, height: entry.height,
            dataUrl: await this.previewer(entry, payload?.maxEdge || 800) };
    }
    async generate(payload, progress = () => {}) {
        if (this.busy) throw new Error("Combine Generator is already processing.");
        const layout = this.layout(payload);
        const folder = this.outputFolder;
        if (!folder) throw new Error("Select an output folder for the Combine PSD and JPEG.");
        const resolved = await fs.promises.realpath(folder);
        if (!(await fs.promises.stat(resolved)).isDirectory()) throw new Error("Output location is not a directory.");
        const behavior = payload?.existingAction || "version";
        if (!["version", "replace", "cancel"].includes(behavior)) throw new Error("Invalid output overwrite behavior.");
        const currentInputs = [layout.single, ...layout.lineup, ...layout.details];
        // Protect original images, including when they are saved in the output
        // directory. Never let a custom output name overwrite any input.
        for (const entry of currentInputs) {
            const now = await fs.promises.lstat(entry.path);
            if (!now.isFile() || now.size !== entry.bytes || now.mtimeMs !== entry.mtimeMs) {
                throw new Error(`${entry.name} changed after import. Re-add the updated image before generation.`);
            }
            const sourceFolder = await fs.promises.realpath(path.dirname(entry.path));
            if (sourceFolder.toLowerCase() === resolved.toLowerCase() &&
                familyRegex(layout.name).test(entry.name)) {
                throw new Error(`${entry.name} is an input file and matches the output name. Choose another output filename.`);
            }
        }
        this.busy = true;
        let work;
        try {
            work = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-combine-"));
            progress({ stage: "planning", message: `600 x ${layout.height}px, ${layout.sourceCount} editable image layers` });
            const staged = await this.builder(layout, work, progress);
            const covered = staged.jpegParts.reduce((sum, part) => sum + Number(part.height || 0), 0);
            if (covered !== layout.height) throw new Error("JPEG parts do not cover the full Combine height.");
            progress({ stage: "saving", message: "Publishing editable PSD/PSB and JPEG to selected folder..." });
            const saved = await this.publisher(staged, resolved, layout.name, layout.format, behavior);
            this.lastOutput = saved.outputPath;
            progress({ stage: "done", message: `Saved ${path.basename(saved.outputPath)} and ${saved.jpegPaths.length} JPEG output(s)` });
            return { ok: true, ...saved, width: layout.width, height: layout.height,
                sourceCount: layout.sourceCount, lineupCount: layout.lineup.length,
                detailCount: layout.details.length, format: layout.format };
        } finally {
            if (work) await fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
            this.busy = false;
        }
    }
}
module.exports = { CombineService };
