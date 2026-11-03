"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const { runPhotoshopJSX } = require("../../landing-page/main/photoshopBridge");
const { visibleBounds, PHOTOSHOP } = require("./assets");
const { fitInside } = require("./planner");
const { planJPEGParts } = require("../../lp-folder/main/photoshop");

function scriptString(value) { return JSON.stringify(String(value).replace(/\\/g, "/")); }
async function rasterizePsdSources(files, folder) {
    const unique = [...new Set(files.filter(file => PHOTOSHOP.has(path.extname(file).toLowerCase())))];
    const map = new Map();
    if (!unique.length) return map;
    if (process.platform !== "win32") throw new Error("PSD/PSB input preview requires Photoshop on Windows.");
    const inputs = unique.map((input, index) => ({
        input: input.replace(/\\/g, "/"),
        output: path.join(folder, `psd_preview_${index}.png`).replace(/\\/g, "/")
    }));
    const jsx = await fs.promises.readFile(path.join(__dirname, "../jsx/previewPsd.jsx"), "utf8");
    await runPhotoshopJSX(`var COMBINE_PREVIEWS = ${JSON.stringify(inputs)};\n` +
        jsx.replace(/^\s*#target\s+photoshop[^\n]*\n?/i, ""), "Combine PSD source previews", Math.min(1200000, 180000 + unique.length * 30000));
    for (let i = 0; i < unique.length; i++) {
        await fs.promises.access(inputs[i].output, fs.constants.R_OK);
        map.set(unique[i].toLowerCase(), inputs[i].output);
    }
    return map;
}

async function preparedEntry(entry, index, folder, psdPreviewMap) {
    const source = psdPreviewMap.get(entry.path.toLowerCase()) || entry.path;
    const bounds = await visibleBounds(source);
    const fitted = fitInside({ ...entry, visibleWidth: bounds.width, visibleHeight: bounds.height },
        entry.slotX, entry.slotY, entry.slotWidth, entry.slotHeight);
    const output = path.join(folder, `placed_${String(index).padStart(3, "0")}.png`);
    // Always scale UNIFORMLY. Fit inside the slot with no upscaling:
    // low-resolution sources retain their original visible pixel dimensions.
    await sharp(source, { animated: false, failOn: "error", limitInputPixels: 400000000 })
        .rotate().extract({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height })
        .resize({ width: fitted.placedWidth, height: fitted.placedHeight,
            fit: "inside", withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
        .png({ compressionLevel: 6 }).toFile(output);
    const resultSize = await sharp(output).metadata();
    const placedWidth = resultSize.width, placedHeight = resultSize.height;
    return { ...fitted, placedWidth, placedHeight,
        x: fitted.slotX + Math.floor((fitted.slotWidth - placedWidth) / 2),
        y: fitted.slotY + Math.floor((fitted.slotHeight - placedHeight) / 2),
        input: output.replace(/\\/g, "/"),
        originalPsd: entry.isPhotoshop ? entry.path.replace(/\\/g, "/") : null,
        visibleMode: bounds.mode };
}

async function createCombineFiles(layout, folder, progress = () => {}) {
    if (process.platform !== "win32") throw new Error("Combine PSD/JPEG creation requires Adobe Photoshop on Windows.");
    const ordered = [layout.single, ...layout.lineup, ...layout.details];
    progress({ stage: "preparing", message: "Preparing original images and transparent content bounds..." });
    const previews = await rasterizePsdSources(ordered.map(item => item.path), folder);
    const all = [];
    for (let i = 0; i < ordered.length; i++) {
        all.push(await preparedEntry(ordered[i], i, folder, previews));
        progress({ stage: "preparing", completed: i + 1, total: ordered.length,
            message: `Fitted ${i + 1}/${ordered.length} images without product cropping` });
    }
    const docFile = path.join(folder, `result.${layout.format}`);
    const jpegParts = planJPEGParts(layout.height, folder);
    const job = {
        width: layout.width, height: layout.height, format: layout.format,
        name: layout.name, single: all[0],
        lineup: all.slice(1, 1 + layout.lineup.length),
        details: all.slice(1 + layout.lineup.length),
        detailsHeader: layout.detailsHeader, jpegParts,
        geometry: layout.geometry
    };
    const jsx = await fs.promises.readFile(path.join(__dirname, "../jsx/compose.jsx"), "utf8");
    const code = `var COMBINE_JOB = ${JSON.stringify(job)};\nvar COMBINE_DEST = ${scriptString(docFile)};\n` +
        jsx.replace(/^\s*#target\s+photoshop[^\n]*\n?/i, "");
    progress({ stage: "photoshop", message: `Creating editable ${layout.format.toUpperCase()} and ${jpegParts.length} JPEG output(s)...` });
    await runPhotoshopJSX(code, "BrandForge Combine Generator", Math.min(1800000, 240000 + all.length * 40000));
    const doc = await fs.promises.stat(docFile);
    if (!doc.isFile() || doc.size < 1000) throw new Error("Photoshop did not write a layered PSD/PSB.");
    for (const jpg of jpegParts) {
        const meta = await sharp(jpg.path, { limitInputPixels: 400000000 }).metadata();
        if (meta.format !== "jpeg" || meta.width !== layout.width || meta.height !== jpg.height) {
            throw new Error(`Invalid Combine JPEG ${path.basename(jpg.path)}.`);
        }
    }
    return { psdPath: docFile, jpegParts };
}

async function previewImage(entry, maxEdge = 800) {
    const limit = Math.max(180, Math.min(1400, Number(maxEdge) || 800));
    const folder = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-combine-preview-"));
    try {
        const map = await rasterizePsdSources([entry.path], folder);
        const file = map.get(entry.path.toLowerCase()) || entry.path;
        const bbox = await visibleBounds(file);
        const png = await sharp(file, { animated: false, limitInputPixels: 400000000 }).rotate()
            .extract({ left: bbox.left, top: bbox.top, width: bbox.width, height: bbox.height })
            .resize({ width: limit, height: limit, fit: "inside", withoutEnlargement: true })
            .png().toBuffer();
        return `data:image/png;base64,${png.toString("base64")}`;
    } finally { await fs.promises.rm(folder, { recursive: true, force: true }).catch(() => {}); }
}

module.exports = { createCombineFiles, previewImage, rasterizePsdSources, preparedEntry };
