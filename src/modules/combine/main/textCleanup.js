"use strict";

// Non-destructive caption cleanup for downloaded product images. No ML model,
// network access, Python runtime, or destructive source edits are required.
// OCR reuses BrandForge's existing Tesseract / Windows OCR implementation.
// Reconstructions use locally sampled backgrounds; complex photo regions must
// always be QC'd by the user before committing the new PNG.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { inspectOne } = require("./assets");
const { recognize } = require("../../landing-page/main/ocr");
const { photoshopContentAware } = require("./inpaintPhotoshop");

const RASTER = new Set([".png", ".jpg", ".jpeg", ".jpe", ".jfif", ".webp", ".tif", ".tiff", ".bmp", ".gif", ".avif"]);
const MAX_PIXELS = 32_000_000;
const MAX_AREAS = 60;
const MAX_SOURCE_FILES = 120;
const MAX_AREA_FRACTION = 0.28;
const makeKey = file => path.resolve(String(file || "")).toLowerCase();

function orientedDimensions(meta) {
    const rotated = [5, 6, 7, 8].includes(Number(meta.orientation));
    return { width: rotated ? meta.height : meta.width, height: rotated ? meta.width : meta.height };
}
function normalizeAreas(areas, width, height) {
    if (!Array.isArray(areas) || !areas.length) throw new Error("Select at least one caption area for removal.");
    if (areas.length > MAX_AREAS) throw new Error(`Maximum ${MAX_AREAS} text regions per image.`);
    const normalized = areas.map((area, index) => {
        if (!area || typeof area !== "object") throw new Error(`Invalid text region ${index + 1}.`);
        const input = [area.x, area.y, area.width, area.height].map(Number);
        if (!input.every(Number.isFinite) || input[2] < 3 || input[3] < 3) {
            throw new Error(`Invalid text region size at item ${index + 1}.`);
        }
        const pad = Math.max(1, Math.min(8, Math.round(Math.min(input[3] * 0.10, 6))));
        const x0 = Math.max(0, Math.floor(input[0] - pad));
        const y0 = Math.max(0, Math.floor(input[1] - pad));
        const x1 = Math.min(width, Math.ceil(input[0] + input[2] + pad));
        const y1 = Math.min(height, Math.ceil(input[1] + input[3] + pad));
        const w = x1 - x0, h = y1 - y0;
        if (w < 1 || h < 1 || w * h > width * height * MAX_AREA_FRACTION) {
            throw new Error(`Text region ${index + 1} is too large. Draw a tighter area around the caption.`);
        }
        return { x: x0, y: y0, width: w, height: h };
    });
    const total = normalized.reduce((sum, a) => sum + a.width * a.height, 0);
    if (total > width * height * 0.45) throw new Error("Selected areas cover too much of the image. Reduce the removal regions.");
    return normalized;
}
function suggestion(text, confidence, box, height) {
    const str = String(text || "").trim();
    if (!str || str.length > 45 || box.height > height * 0.13) return false;
    if (confidence != null && confidence < 55) return false;
    // Suggest possible caption regions, not logos near the top. User still
    // explicitly approves selections and inspects a preview before saving.
    return box.y > height * 0.48;
}
function boxMeanVar(buffer, width, height, box, mask) {
    const values = [];
    const l = box.x, r = box.x + box.width - 1, t = box.y, b = box.y + box.height - 1;
    const step = Math.max(1, Math.floor(Math.max(box.width, box.height) / 40));
    function push(x, y) {
        if (x < 0 || y < 0 || x >= width || y >= height || mask[y * width + x]) return;
        const i = (y * width + x) * 4;
        if (buffer[i + 3] < 180) return;
        values.push([buffer[i], buffer[i + 1], buffer[i + 2]]);
    }
    for (let x = l; x <= r; x += step) { push(x, t - 2); push(x, b + 2); }
    for (let y = t; y <= b; y += step) { push(l - 2, y); push(r + 2, y); }
    if (!values.length) return { mean: [255, 255, 255], deviation: Infinity };
    const mean = [0, 0, 0];
    values.forEach(v => v.forEach((channel, k) => { mean[k] += channel / values.length; }));
    let deviation = 0;
    values.forEach(v => v.forEach((channel, k) => { deviation += (channel - mean[k]) ** 2 / (3 * values.length); }));
    return { mean, deviation: Math.sqrt(deviation) };
}
function choosePatch(source, width, height, area, mask) {
    const { x, y, width: rw, height: rh } = area;
    if (rw > width * 0.8 || rh > height * 0.8) return null;
    const span = Math.max(110, Math.min(450, Math.max(rw, rh) * 3));
    const step = Math.max(3, Math.floor(Math.min(rw, rh) / 6));
    const minX = Math.max(1, x - span), maxX = Math.min(width - rw - 2, x + span);
    const minY = Math.max(1, y - span), maxY = Math.min(height - rh - 2, y + span);
    let best = null;
    let count = 0;
    const offsets = [0.12, 0.28, 0.5, 0.72, 0.88];
    const edges = [];
    const sample = (dx, dy, tx, ty) => {
        if (tx < 0 || ty < 0 || tx >= width || ty >= height || mask[ty * width + tx]) return;
        edges.push({ dx, dy, target: (ty * width + tx) * 4 });
    };
    for (const f of offsets) {
        const xx = Math.min(rw - 1, Math.floor(f * rw)), yy = Math.min(rh - 1, Math.floor(f * rh));
        sample(xx, -1, x + xx, y - 1);
        sample(xx, rh, x + xx, y + rh);
        sample(-1, yy, x - 1, y + yy);
        sample(rw, yy, x + rw, y + yy);
    }
    if (edges.length < 5) return null;
    for (let cy = minY; cy <= maxY; cy += step) {
        for (let cx = minX; cx <= maxX; cx += step) {
            // No original text, including OTHER approved regions, may be copied
            // into the proposed replacement patch.
            let blocked = false;
            for (const fy of [0, 0.25, 0.5, 0.75, 1]) {
                const row = (cy + Math.round(fy * (rh - 1))) * width;
                for (const fx of [0, 0.25, 0.5, 0.75, 1]) {
                    if (mask[row + cx + Math.round(fx * (rw - 1))]) { blocked = true; break; }
                }
                if (blocked) break;
            }
            if (blocked) continue;
            let score = 0;
            for (const edge of edges) {
                const index = ((cy + edge.dy) * width + cx + edge.dx) * 4;
                for (let channel = 0; channel < 3; channel++) {
                    const diff = source[index + channel] - source[edge.target + channel];
                    score += diff * diff;
                }
            }
            score /= (edges.length * 3);
            score += Math.hypot(cx - x, cy - y) * 0.025;
            count++;
            if (!best || score < best.score) best = { x: cx, y: cy, score };
        }
    }
    return count ? best : null;
}
function reconstructPixels(buffer, width, height, areas) {
    const mask = new Uint8Array(width * height);
    for (const a of areas) {
        for (let y = a.y; y < a.y + a.height; y++) mask.fill(1, y * width + a.x, y * width + a.x + a.width);
    }
    const original = Buffer.from(buffer);
    const methods = [];
    const warnings = [];
    // Work from the same untouched original source for ALL selections.
    for (const [areaIndex, area] of areas.entries()) {
        const stats = boxMeanVar(original, width, height, area, mask);
        const useFlat = stats.deviation < 24;
        const patch = !useFlat ? choosePatch(original, width, height, area, mask) : null;
        let method = useFlat ? "matched flat background" : patch ? "nearby texture patch" : "edge interpolation";
        if (!useFlat && (!patch || patch.score > 850)) {
            warnings.push(`Region ${areaIndex + 1} has a complex background. Inspect the preview carefully; product details may be changed.`);
        }
        const x0 = area.x, y0 = area.y, w = area.width, h = area.height;
        for (let yy = 0; yy < h; yy++) {
            for (let xx = 0; xx < w; xx++) {
                const x = x0 + xx, y = y0 + yy, offset = (y * width + x) * 4;
                if (useFlat) {
                    for (let c = 0; c < 3; c++) buffer[offset + c] = Math.round(stats.mean[c]);
                    // Keep existing source alpha, including transparency.
                } else if (patch) {
                    const from = ((patch.y + yy) * width + patch.x + xx) * 4;
                    const distance = Math.min(xx, yy, w - xx - 1, h - yy - 1);
                    const feather = Math.max(0, Math.min(1, (distance + 1) / 4));
                    let nearest = null;
                    if (distance < 3) {
                        const sampleX = xx < w - xx ? x0 - 1 : x0 + w;
                        const sampleY = yy < h - yy ? y0 - 1 : y0 + h;
                        const sx = Math.max(0, Math.min(width - 1, sampleX));
                        const sy = Math.max(0, Math.min(height - 1, sampleY));
                        const side = Math.min(xx, w - xx - 1) < Math.min(yy, h - yy - 1);
                        const px = side ? sx : x, py = side ? y : sy;
                        const outer = py * width + px;
                        if (!mask[outer]) nearest = outer * 4;
                    }
                    for (let c = 0; c < 4; c++) {
                        buffer[offset + c] = Math.round(nearest == null ? original[from + c] :
                            original[from + c] * feather + original[nearest + c] * (1 - feather));
                    }
                } else {
                    const top = (Math.max(0, y0 - 1) * width + x) * 4;
                    const bottom = (Math.min(height - 1, y0 + h) * width + x) * 4;
                    const left = (y * width + Math.max(0, x0 - 1)) * 4;
                    const right = (y * width + Math.min(width - 1, x0 + w)) * 4;
                    const ty = (yy + 1) / (h + 1), tx = (xx + 1) / (w + 1);
                    const vertWeight = (h / (h + w)), horizWeight = 1 - vertWeight;
                    for (let c = 0; c < 4; c++) {
                        const vertical = original[top + c] * (1 - ty) + original[bottom + c] * ty;
                        const horizontal = original[left + c] * (1 - tx) + original[right + c] * tx;
                        buffer[offset + c] = Math.round(vertical * vertWeight + horizontal * horizWeight);
                    }
                }
            }
        }
        methods.push(method);
    }
    return { methods, warnings };
}
async function renderCleanPng(sourcePath, areas, engine = "local") {
    if (!["local", "photoshop"].includes(engine)) throw new Error("Unknown background-restoration engine.");
    const { data, info } = await sharp(sourcePath, { animated: false, failOn: "error", limitInputPixels: MAX_PIXELS })
        .rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width * info.height > MAX_PIXELS || info.channels !== 4) throw new Error("Text cleanup supports images up to 32 million pixels.");
    const normalized = normalizeAreas(areas, info.width, info.height);
    if (engine === "photoshop") return photoshopContentAware(sourcePath, normalized, info.width, info.height);
    const { methods, warnings } = reconstructPixels(data, info.width, info.height, normalized);
    const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
        .png({ compressionLevel: 7 }).toBuffer();
    return { png, width: info.width, height: info.height, methods, warnings };
}
async function imagePreview(buffer, maxEdge = 850) {
    const input = Buffer.isBuffer(buffer) ? buffer : await fs.promises.readFile(buffer);
    const output = await sharp(input, { animated: false, limitInputPixels: MAX_PIXELS })
        .rotate().resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
        .png().toBuffer();
    return `data:image/png;base64,${output.toString("base64")}`;
}

class TextCleanupService {
    constructor({ ocr = recognize } = {}) {
        this.files = new Map();
        this.ocr = ocr;
        this.busy = false;
    }
    async addFiles(filePaths) {
        const paths = [...new Set((filePaths || []).map(p => path.resolve(String(p))))];
        if (paths.length > MAX_SOURCE_FILES) throw new Error(`Select up to ${MAX_SOURCE_FILES} cleanup images at once.`);
        const images = [], failed = [];
        for (const file of paths) {
            try {
                if (!RASTER.has(path.extname(file).toLowerCase())) throw new Error("Cleanup accepts raster images (JPG/PNG/WEBP/TIFF etc.), not layered PSDs.");
                const entry = await inspectOne(file);
                const meta = await sharp(file, { limitInputPixels: MAX_PIXELS, animated: false }).metadata();
                const size = orientedDimensions(meta);
                if (size.width * size.height > MAX_PIXELS) throw new Error("Image exceeds the 32-megapixel cleanup limit.");
                const item = { ...entry, width: size.width, height: size.height };
                this.files.set(makeKey(file), item);
                images.push(item);
            } catch (error) { failed.push({ path: file, error: error.message }); }
        }
        return { images, failed };
    }
    async getFile(file) {
        const record = this.files.get(makeKey(file));
        if (!record) throw new Error("Select this image in the Text Cleanup panel first.");
        const now = await fs.promises.lstat(record.path);
        if (!now.isFile() || now.isSymbolicLink() || now.size !== record.bytes || now.mtimeMs !== record.mtimeMs) {
            throw new Error("Source file changed since selection. Re-add it before cleanup.");
        }
        return record;
    }
    async scan(filePath) {
        const entry = await this.getFile(filePath);
        const working = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-text-ocr-"));
        try {
            const scanInput = path.join(working, "scan.png");
            const output = await sharp(entry.path, { animated: false, limitInputPixels: MAX_PIXELS })
                .rotate().flatten({ background: "#ffffff" })
                .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
                .png().toFile(scanInput);
            const results = await this.ocr(scanInput, { workDir: working });
            const scaleX = entry.width / output.width, scaleY = entry.height / output.height;
            const regions = (results.blocks || []).slice(0, MAX_AREAS).map((block, i) => {
                const box = {
                    id: `ocr-${i}`, text: String(block.text || "").trim(),
                    x: Math.max(0, Math.round(Number(block.x) * scaleX)),
                    y: Math.max(0, Math.round(Number(block.y) * scaleY)),
                    width: Math.max(3, Math.round(Number(block.width) * scaleX)),
                    height: Math.max(3, Math.round(Number(block.height) * scaleY)),
                    confidence: block.confidence == null ? null : Number(block.confidence)
                };
                box.suggested = suggestion(box.text, box.confidence, box, entry.height);
                return box;
            }).filter(box => box.text && Number.isFinite(box.x) && Number.isFinite(box.y) &&
                Number.isFinite(box.width) && Number.isFinite(box.height) && box.x < entry.width && box.y < entry.height);
            return { filePath: entry.path, width: entry.width, height: entry.height,
                previewDataUrl: await imagePreview(entry.path, 850), regions,
                engine: results.engine || "Unavailable", warning: results.warning || "" };
        } finally { await fs.promises.rm(working, { recursive: true, force: true }).catch(() => {}); }
    }
    async preview({ filePath, areas, engine = "local" }) {
        const entry = await this.getFile(filePath);
        const result = await renderCleanPng(entry.path, areas, engine);
        return { previewDataUrl: await imagePreview(result.png, 850),
            width: result.width, height: result.height, methods: result.methods, warnings: result.warnings };
    }
    async save({ filePath, areas, engine = "local" }) {
        if (this.busy) throw new Error("Text cleanup is already saving an image.");
        this.busy = true;
        try {
            const entry = await this.getFile(filePath);
            const result = await renderCleanPng(entry.path, areas, engine);
            const folder = path.join(path.dirname(entry.path), "COMBINE_CLEANED");
            await fs.promises.mkdir(folder, { recursive: true });
            const base = path.parse(entry.name).name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 110);
            let saved = null;
            for (let i = 1; i <= 500; i++) {
                const name = `${base}_textclean${i === 1 ? "" : `_v${i}`}.png`;
                const candidate = path.join(folder, name);
                try {
                    await fs.promises.writeFile(candidate, result.png, { flag: "wx" });
                    saved = candidate;
                    break;
                } catch (error) { if (error.code !== "EEXIST") throw error; }
            }
            if (!saved) throw new Error("Too many cleaned versions for this image.");
            const size = await sharp(saved).metadata();
            if (size.width !== result.width || size.height !== result.height || size.format !== "png") {
                await fs.promises.unlink(saved).catch(() => {});
                throw new Error("Saved cleaned PNG failed integrity verification.");
            }
            return { ok: true, path: saved, width: result.width, height: result.height,
                methods: result.methods, warnings: result.warnings };
        } finally { this.busy = false; }
    }
}
module.exports = { TextCleanupService, normalizeAreas, suggestion, reconstructPixels, renderCleanPng };
