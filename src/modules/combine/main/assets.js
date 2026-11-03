"use strict";
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { parsePhotoshopHeader } = require("../../lp-folder/main/planner");

const EXTENSIONS = new Set([
    ".jpg", ".jpeg", ".jpe", ".jfif", ".png", ".webp", ".tif", ".tiff",
    ".bmp", ".gif", ".psd", ".psb", ".avif", ".heic", ".heif",
    ".tga", ".svg", ".jp2", ".j2k", ".exr", ".hdr", ".ppm", ".pgm"
]);
const PHOTOSHOP = new Set([".psd", ".psb"]);
const MAX_FILES = 300;
const MAX_FILE_BYTES = 2 * 1024 ** 3;
async function inspectOne(file) {
    const resolved = path.resolve(String(file));
    const ext = path.extname(resolved).toLowerCase();
    if (!EXTENSIONS.has(ext)) throw new Error("Not a supported image file type.");
    const stat = await fs.promises.lstat(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Source must be a regular image file.");
    if (!stat.size || stat.size > MAX_FILE_BYTES) throw new Error("Image is empty or exceeds 2 GB.");
    let info;
    if (PHOTOSHOP.has(ext)) {
        const fileHandle = await fs.promises.open(resolved, "r");
        try {
            const header = Buffer.alloc(26);
            const result = await fileHandle.read(header, 0, 26, 0);
            info = parsePhotoshopHeader(header.subarray(0, result.bytesRead), resolved);
        } finally { await fileHandle.close(); }
    } else {
        const meta = await sharp(resolved, { failOn: "error", animated: false, limitInputPixels: 400000000 }).metadata();
        let { width, height } = meta;
        if ([5, 6, 7, 8].includes(meta.orientation)) [width, height] = [height, width];
        if (!width || !height) throw new Error("Image has no readable dimensions.");
        info = { width, height };
    }
    return { path: resolved, name: path.basename(resolved), extension: ext,
        width: info.width, height: info.height, bytes: stat.size, mtimeMs: stat.mtimeMs,
        isPhotoshop: PHOTOSHOP.has(ext) };
}
async function inspectBatch(paths) {
    if (!Array.isArray(paths) || paths.length > MAX_FILES) throw new Error(`Choose up to ${MAX_FILES} image files per import.`);
    const items = [], failed = [], seen = new Set();
    for (const p of paths) {
        if (typeof p !== "string" || !p.trim()) continue;
        const key = path.resolve(p).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        try { items.push(await inspectOne(p)); }
        catch (error) { failed.push({ path: p, error: error.message }); }
    }
    return { images: items, failed };
}

// Read the visible product rectangle without physically cropping source files.
// Transparent borders are removed from measurement; on opaque white images
// only near-pure-white pixels are treated as blank. Other backgrounds are kept
// intact to prevent inadvertently removing white/light product details.
async function visibleBounds(source) {
    const meta = await sharp(source, { animated: false, limitInputPixels: 400000000 }).rotate().metadata();
    let width = meta.width, height = meta.height;
    if ([5, 6, 7, 8].includes(meta.orientation)) [width, height] = [height, width];
    if (!width || !height) throw new Error("Missing image dimensions");
    const { data, info } = await sharp(source, { animated: false, limitInputPixels: 400000000 })
        .rotate().resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true })
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let alphaOnEdge = 0;
    let whiteOnEdge = 0;
    let borderCount = 0;
    const get = (x, y) => (y * info.width + x) * info.channels;
    const white = i => data[i] >= 250 && data[i + 1] >= 250 && data[i + 2] >= 250;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        if (x && x !== info.width - 1 && y && y !== info.height - 1) continue;
        const i = get(x, y); borderCount++;
        if (data[i + 3] <= 245) alphaOnEdge++;
        if (white(i)) whiteOnEdge++;
    }
    const useAlpha = alphaOnEdge > borderCount * .02;
    const useWhite = !useAlpha && whiteOnEdge > borderCount * .78;
    if (!useAlpha && !useWhite) return { left: 0, top: 0, width, height, mode: "full" };
    let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const i = get(x, y);
        const content = useAlpha ? data[i + 3] > 6 : !white(i);
        if (!content) continue;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (maxX < 0) return { left: 0, top: 0, width, height, mode: "full" };
    const sx = width / info.width, sy = height / info.height;
    // Additional safety margin prevents antialiased fringe/details being cut.
    const safe = 3;
    const left = Math.max(0, Math.floor((minX - safe) * sx));
    const top = Math.max(0, Math.floor((minY - safe) * sy));
    const right = Math.min(width, Math.ceil((maxX + safe + 1) * sx));
    const bottom = Math.min(height, Math.ceil((maxY + safe + 1) * sy));
    return { left, top, width: right - left, height: bottom - top, mode: useAlpha ? "alpha" : "white" };
}
module.exports = { EXTENSIONS, PHOTOSHOP, inspectBatch, inspectOne, visibleBounds };
