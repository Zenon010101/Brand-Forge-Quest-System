"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const sharp = require("sharp");
const { randomUUID } = require("crypto");
const { checkImageFile, uniqueSourceOrder, validateProjectCode, assembleLayout } = require("./planner");
const { analyzePart, prepareSingle } = require("./analyzer");
const { buildLandingPsd } = require("./photoshopBridge");

class LandingPageService {
    constructor({ analysis = analyzePart, buildPsd = buildLandingPsd } = {}) {
        this.analyzePart = analysis;
        this.buildPsd = buildPsd;
        this.session = null;
        this.active = false;
    }

    async dispose() {
        if (this.active) return;
        const old = this.session;
        this.session = null;
        if (old) await fs.promises.rm(old.workDir, { recursive: true, force: true }).catch(() => {});
    }

    async analyze(payload, progress = () => {}) {
        if (this.active) throw new Error("Landing Page analysis / export is already running.");
        const screenshotPaths = uniqueSourceOrder(payload?.screenshots);
        const singlePath = payload?.singlePath ? checkImageFile(payload.singlePath) : null;
        if (singlePath && screenshotPaths.some(s => s === singlePath)) throw new Error("The Single cannot also appear in the LP screenshot queue.");
        this.active = true;
        let temp = null;
        try {
            temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-lp-"));
            const parts = [];
            for (let index = 0; index < screenshotPaths.length; index++) {
                const part = await this.analyzePart(screenshotPaths[index], index, temp, {
                    tesseractPath: String(payload?.tesseractPath || "").slice(0, 400)
                }, detail => progress({ stage: "analyzing", current: index + 1, total: screenshotPaths.length, message: detail }));
                parts.push(part);
            }
            const layout = assembleLayout(parts);
            const single = await prepareSingle(singlePath, temp);
            const previous = this.session;
            const session = {
                id: randomUUID(), createdAt: new Date().toISOString(), workDir: temp,
                singlePath, singleFile: single, layout, sources: screenshotPaths,
                sourceStats: await Promise.all(screenshotPaths.map(async source => {
                    const s = await fs.promises.stat(source);
                    return { size: s.size, mtimeMs: s.mtimeMs };
                }))
            };
            this.session = session;
            if (previous) await fs.promises.rm(previous.workDir, { recursive: true, force: true }).catch(() => {});
            return this.publicSession();
        } catch (error) {
            if (temp) await fs.promises.rm(temp, { recursive: true, force: true }).catch(() => {});
            throw error;
        } finally { this.active = false; }
    }

    publicSession() {
        const s = this.session;
        if (!s) return null;
        return {
            sessionId: s.id, createdAt: s.createdAt, singlePath: s.singlePath,
            width: s.layout.width, height: s.layout.height, format: s.layout.format,
            warnings: s.layout.warnings,
            parts: s.layout.parts.map(p => ({
                source: p.source, name: p.name, originalWidth: p.originalWidth,
                originalHeight: p.originalHeight, width: p.width, height: p.height,
                y: p.y, group: p.group, warnings: p.warnings, counts: p.counts,
                text: p.text.map(t => ({ name: t.name, text: t.text, x: t.x, y: t.y,
                    width: t.width, height: t.height, confidence: t.confidence, editable: t.editable })),
                images: p.images.map(i => ({ name: i.name, left: i.left, top: i.top, width: i.width, height: i.height }))
            }))
        };
    }

    async preview(payload) {
        const file = typeof payload?.filePath === "string" ? path.resolve(payload.filePath) : "";
        const allowed = this.session
            ? [...this.session.sources, this.session.singlePath, this.session.singleFile,
                ...this.session.layout.parts.map(p => p.normalizedPath)].filter(Boolean)
            : [];
        if (!allowed.includes(file)) checkImageFile(file);
        const maxEdge = Math.max(200, Math.min(1800, Number(payload?.maxEdge) || 1100));
        const inputMetadata = await sharp(file).metadata();
        const swap = [5, 6, 7, 8].includes(inputMetadata.orientation);
        const sourceWidth = swap ? inputMetadata.height : inputMetadata.width;
        const sourceHeight = swap ? inputMetadata.width : inputMetadata.height;
        const normalizedHeight = Math.max(1, Math.round(sourceHeight * 1000 / sourceWidth));
        let image, top = 0, height = normalizedHeight;
        if (payload?.mode === "detail") {
            top = Math.max(0, Math.min(normalizedHeight - 1, Math.floor(Number(payload.top) || 0)));
            height = Math.min(Math.max(400, Math.min(2400, Number(payload.height) || 1800)), normalizedHeight - top);
            image = await sharp(file, { limitInputPixels: 240000000 }).rotate()
                .resize({ width: 1000, height: normalizedHeight, fit: "fill" })
                .extract({ left: 0, top, width: 1000, height }).png().toBuffer();
        } else {
            image = await sharp(file, { limitInputPixels: 240000000 }).rotate()
                .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
                .png().toBuffer();
        }
        return { ok: true, dataUrl: `data:image/png;base64,${image.toString("base64")}`,
            mode: payload?.mode === "detail" ? "detail" : "full", top, height, normalizedHeight };
    }

    async generate(payload, progress = () => {}) {
        if (this.active) throw new Error("Landing Page analysis / export is already running.");
        const s = this.session;
        if (!s || payload?.sessionId !== s.id) throw new Error("Analysis is missing or outdated. Click Analyze Landing Page again.");
        const code = validateProjectCode(payload?.productCode);
        if (!payload?.outputFolder || typeof payload.outputFolder !== "string") throw new Error("Choose an output folder.");
        const root = await fs.promises.realpath(path.resolve(payload.outputFolder));
        if (!(await fs.promises.stat(root)).isDirectory()) throw new Error("Output location is not a directory.");
        const finalDir = path.join(root, code);
        const extension = s.layout.format;
        const fontLatin = String(payload?.fontLatin || "ArialMT").trim().slice(0, 100);
        const fontJapanese = String(payload?.fontJapanese || "YuGothic-Regular").trim().slice(0, 100);
        const overwrite = !!payload?.overwrite;
        for (let i = 0; i < s.sources.length; i++) {
            const now = await fs.promises.stat(s.sources[i]);
            if (now.size !== s.sourceStats[i].size || now.mtimeMs !== s.sourceStats[i].mtimeMs) {
                throw new Error(`Source screenshot changed since analysis: ${path.basename(s.sources[i])}. Re-analyze the project.`);
            }
        }
        const destinations = [path.join(finalDir, `${code}.${extension}`), path.join(finalDir, "manifest.json")];
        if (!overwrite && destinations.some(target => fs.existsSync(target))) {
            throw new Error("Output PSD/manifest already exists. Enable 'Back up + replace existing outputs' or choose another product code.");
        }
        this.active = true;
        let stagingRoot = null;
        try {
            stagingRoot = await fs.promises.mkdtemp(path.join(root, ".brandforge-lp-staging-"));
            const stagedDir = path.join(stagingRoot, code);
            const extractedDir = path.join(stagedDir, "extracted");
            const ocrDir = path.join(stagedDir, "ocr");
            await fs.promises.mkdir(extractedDir, { recursive: true });
            await fs.promises.mkdir(ocrDir, { recursive: true });
            const stagingPsd = path.join(stagedDir, `${code}.${extension}`);
            progress({ stage: "photoshop", message: `Building ${extension.toUpperCase()} with editable text, raster fallback and source groups…` });
            await this.buildPsd(s.layout, stagingPsd, {
                code, singlePath: s.singleFile, hasSingle: !!s.singlePath, fontLatin, fontJapanese
            });
            const manifest = {
                schema: "brandforge.lp.v1", productCode: code, createdAt: new Date().toISOString(),
                single: s.singlePath ? { source: s.singlePath, provided: true } : { source: null, provided: false, reserved: "1000x1000" },
                canvas: { width: s.layout.width, height: s.layout.height, format: extension, singleHeight: 1000 },
                fonts: { latin: fontLatin, japanese: fontJapanese, note: "Approximate fonts. OCR recognition may require manual corrections." },
                screenshotOrder: s.sources,
                warnings: [...s.layout.warnings], parts: [],
                counts: { editableText: 0, reviewText: 0, separateImages: 0, rasterParts: s.layout.parts.length }
            };
            for (const p of s.layout.parts) {
                const prefix = `part${String(p.partIndex + 1).padStart(2, "0")}`;
                const normalizedFile = `${prefix}_normalized_reference.png`;
                const backgroundFile = `${prefix}_background.png`;
                await fs.promises.copyFile(p.normalizedPath, path.join(extractedDir, normalizedFile));
                await fs.promises.copyFile(p.basePath, path.join(extractedDir, backgroundFile));
                const images = [];
                for (const img of p.images) {
                    const name = path.basename(img.file);
                    await fs.promises.copyFile(img.file, path.join(extractedDir, name));
                    images.push({ ...img, file: `extracted/${name}` });
                }
                const ocrFile = `${prefix}.json`;
                await fs.promises.copyFile(p.ocrPath, path.join(ocrDir, ocrFile));
                const { editableText, reviewText, separateImages } = p.counts;
                manifest.counts.editableText += editableText;
                manifest.counts.reviewText += reviewText;
                manifest.counts.separateImages += separateImages;
                manifest.warnings.push(...p.warnings.map(w => `${p.name}: ${w}`));
                manifest.parts.push({
                    source: p.source, sourceSize: p.sourceSize, originalDimensions: { width: p.originalWidth, height: p.originalHeight },
                    normalizedDimensions: { width: p.width, height: p.height }, group: p.group, y: p.y,
                    normalizedReference: `extracted/${normalizedFile}`, background: `extracted/${backgroundFile}`,
                    ocr: `ocr/${ocrFile}`, textBlocks: p.text, imageBlocks: images, warnings: p.warnings,
                    rasterFallback: true
                });
            }
            await fs.promises.writeFile(path.join(stagedDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
            progress({ stage: "publishing", message: "Saving PSD and supporting files with overwrite protection…" });
            const backupFolder = await publishDirectory(stagedDir, finalDir, overwrite);
            await fs.promises.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
            const result = {
                ok: true, psdPath: path.join(finalDir, `${code}.${extension}`),
                manifestPath: path.join(finalDir, "manifest.json"),
                outputFolder: finalDir, backupFolder,
                counts: manifest.counts, warnings: manifest.warnings,
                width: manifest.canvas.width, height: manifest.canvas.height, format: extension
            };
            // Only clean temp input analyses after successful publishing.
            await fs.promises.rm(s.workDir, { recursive: true, force: true }).catch(() => {});
            this.session = null;
            return result;
        } catch (error) { throw error; }
        finally {
            this.active = false;
            if (stagingRoot) await fs.promises.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
        }
    }
}

async function listFilesRecursive(root, current = "") {
    const result = [];
    for (const entry of await fs.promises.readdir(path.join(root, current), { withFileTypes: true })) {
        const relative = path.join(current, entry.name);
        if (entry.isDirectory()) result.push(...await listFilesRecursive(root, relative));
        else if (entry.isFile()) result.push(relative);
        else throw new Error("Staged output contains an unsupported symlink or special file.");
    }
    return result;
}

async function publishDirectory(source, destination, overwrite) {
    const relativeFiles = await listFilesRecursive(source);
    const conflicts = relativeFiles.filter(rel => fs.existsSync(path.join(destination, rel)));
    if (conflicts.length && !overwrite) {
        throw new Error(`Output already exists: ${conflicts[0]}. Enable Back up + replace before generating.`);
    }
    const backupBase = path.join(destination, "backups", `lp-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 6)}`);
    const moved = [], created = [];
    try {
        await fs.promises.mkdir(destination, { recursive: true });
        for (const rel of relativeFiles) {
            const target = path.join(destination, rel);
            await fs.promises.mkdir(path.dirname(target), { recursive: true });
            if (fs.existsSync(target)) {
                const backup = path.join(backupBase, rel);
                await fs.promises.mkdir(path.dirname(backup), { recursive: true });
                await fs.promises.rename(target, backup);
                moved.push({ target, backup });
            }
            await fs.promises.rename(path.join(source, rel), target);
            created.push(target);
        }
        return moved.length ? backupBase : null;
    } catch (error) {
        for (const target of created.reverse()) await fs.promises.rm(target, { force: true }).catch(() => {});
        for (const item of moved.reverse()) await fs.promises.rename(item.backup, item.target).catch(() => {});
        throw new Error(`Publishing failed; restored previous exports where possible: ${error.message}`);
    }
}

module.exports = { LandingPageService, publishDirectory };
