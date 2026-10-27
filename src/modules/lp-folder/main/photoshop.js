"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const { runPhotoshopJSX } = require("../../landing-page/main/photoshopBridge");
const { PHOTOSHOP_SOURCES } = require("./planner");

function jsx(value) { return JSON.stringify(String(value).replace(/\\/g, "/")); }

async function makeEntryFile(entry, workDir, index) {
    if (PHOTOSHOP_SOURCES.has(entry.extension)) return entry.path;
    const target = path.join(workDir, `section_${String(index).padStart(3, "0")}.png`);
    // Sharp handles EXIF rotation and format conversion. PNG is temporary only.
    // No source image is modified. Each raster is an embedded Smart Object.
    await sharp(entry.path, { animated: false, failOn: "error", limitInputPixels: 400000000 })
        .rotate()
        .resize(entry.placedWidth, entry.placedHeight, { fit: "fill", kernel: sharp.kernel.lanczos3 })
        .png({ compressionLevel: 6 })
        .toFile(target);
    return target;
}

// Baseline JPEG supports a maximum dimension of 65,535 pixels. Export tall
// landing pages as contiguous JPEG strips instead of cropping or failing.
const MAX_JPEG_PART_HEIGHT = 60000;
function planJPEGParts(height, workspace) {
    if (!Number.isInteger(height) || height < 1 || height > 300000) throw new Error("Invalid LP JPEG height.");
    const count = Math.ceil(height / MAX_JPEG_PART_HEIGHT);
    const parts = [];
    for (let i = 0; i < count; i++) {
        const top = i * MAX_JPEG_PART_HEIGHT;
        parts.push({ path: path.join(workspace, count === 1 ? "result.jpg" : `result_${String(i + 1).padStart(2, "0")}.jpg`),
            top, height: Math.min(MAX_JPEG_PART_HEIGHT, height - top) });
    }
    return parts;
}

async function buildLayeredPsd(layout, workspace, onProgress = () => {}) {
    if (process.platform !== "win32") throw new Error("PSD generation requires Adobe Photoshop on Windows.");
    const parts = [];
    onProgress({ stage: "preparing", message: "Preparing image Smart Objects…" });
    const single = { ...layout.single, input: await makeEntryFile(layout.single, workspace, 0), layerName: "Single" };
    for (let i = 0; i < layout.sections.length; i++) {
        const item = layout.sections[i];
        const input = await makeEntryFile(item, workspace, i + 1);
        parts.push({ ...item, input, layerName: item.layer });
        onProgress({ stage: "preparing", completed: i + 1, total: layout.sections.length,
            message: `Prepared ${i + 1}/${layout.sections.length} LP images` });
    }
    const outputPath = path.join(workspace, `result.${layout.format}`);
    const jpegParts = planJPEGParts(layout.height, workspace);
    const template = await fs.promises.readFile(path.join(__dirname, "../jsx/compose.jsx"), "utf8");
    const data = { width: layout.width, height: layout.height, format: layout.format,
        baseName: layout.baseName, single, sections: parts, jpegParts };
    const script = `var FOLDER_LP_JOB = ${JSON.stringify(data)};\nvar FOLDER_LP_DEST = ${jsx(outputPath)};\n` +
        template.replace(/^\s*#target\s+photoshop[^\n]*\n?/i, "");
    onProgress({ stage: "photoshop", message: `Creating editable ${layout.format.toUpperCase()} and ${jpegParts.length} high-quality JPEG${jpegParts.length === 1 ? "" : " parts"} in Photoshop…` });
    await runPhotoshopJSX(script, "LP Folder Generator", Math.min(1800000, 240000 + (parts.length + 1) * 40000));
    const stat = await fs.promises.stat(outputPath);
    if (!stat.isFile() || stat.size < 1000) throw new Error("Photoshop did not create a valid layered PSD/PSB.");
    // Stage and inspect both formats before allowing the publisher to touch
    // anything inside the source folder. The JPEG pixels come from Photoshop's
    // flattened view; the separately saved PSD/PSB stays fully layered.
    const sharpMeta = await Promise.all(jpegParts.map(async (part) => {
        const meta = await sharp(part.path, { limitInputPixels: 400000000 }).metadata();
        if (meta.format !== "jpeg" || meta.width !== layout.width || meta.height !== part.height) {
            throw new Error(`Photoshop JPEG output has incorrect dimensions: ${path.basename(part.path)}.`);
        }
        return meta;
    }));
    if (sharpMeta.length !== jpegParts.length) throw new Error("Not all JPEG outputs were created.");
    return { psdPath: outputPath, jpegParts };
}

async function previewImage(entry, maxEdge = 1300) {
    const edge = Math.max(300, Math.min(1800, Number(maxEdge) || 1300));
    if (!PHOTOSHOP_SOURCES.has(entry.extension)) {
        const buffer = await sharp(entry.path, { animated: false, limitInputPixels: 400000000 }).rotate()
            .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }).png().toBuffer();
        return `data:image/png;base64,${buffer.toString("base64")}`;
    }
    if (process.platform !== "win32") throw new Error("PSD/PSB previews require Photoshop on Windows.");
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-lp-preview-"));
    const file = path.join(root, "preview.png");
    try {
        const scriptTemplate = await fs.promises.readFile(path.join(__dirname, "../jsx/previewPhotoshop.jsx"), "utf8");
        const script = `var FOLDER_LP_SOURCE = ${jsx(entry.path)};\nvar FOLDER_LP_PREVIEW = ${jsx(file)};\nvar FOLDER_LP_MAX_EDGE = ${edge};\n` +
            scriptTemplate.replace(/^\s*#target\s+photoshop[^\n]*\n?/i, "");
        await runPhotoshopJSX(script, "LP image preview", 120000);
        const bytes = await fs.promises.readFile(file);
        if (bytes.length < 80) throw new Error("Photoshop produced an empty PSD preview.");
        return `data:image/png;base64,${bytes.toString("base64")}`;
    } finally { await fs.promises.rm(root, { recursive: true, force: true }).catch(() => {}); }
}

module.exports = { makeEntryFile, buildLayeredPsd, previewImage, planJPEGParts, MAX_JPEG_PART_HEIGHT };
