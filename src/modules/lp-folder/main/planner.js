"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { generatedNames } = require("./generatedIndex");

const WIDTH = 1000;
const SINGLE_SIZE = 1000;
const PSD_MAX_HEIGHT = 30000;
const DOCUMENT_MAX_HEIGHT = 300000;
const MAX_IMAGES = 250;
// Formats are scanned broadly. A file is used only after its contents are
// successfully inspected by Sharp or the PSD/PSB header parser.
const IMAGE_EXTENSIONS = new Set([
    ".jpg", ".jpeg", ".jpe", ".jfif", ".png", ".webp", ".tif", ".tiff", ".bmp",
    ".gif", ".psd", ".psb", ".avif", ".heif", ".heic",
    ".svg", ".dib", ".exr", ".hdr", ".jp2", ".j2k", ".jxl", ".tga", ".ico", ".ppm", ".pgm", ".pbm"
]);
const PHOTOSHOP_SOURCES = new Set([".psd", ".psb"]);
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function isGeneratedOutput(name, folderName) {
    const suffix = name.toLowerCase();
    const root = path.parse(folderName).name.toLowerCase();
    return new RegExp(`^${escapeRegex(root)}_lp(?:_v\\d+)?(?:_\\d+)?\\.(?:psd|psb|jpg|jpeg|png)$`, "i").test(suffix);
}
function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function naturalSort(entries) {
    return entries.slice().sort((a, b) => collator.compare(a.name, b.name) || a.name.localeCompare(b.name));
}

function parsePhotoshopHeader(buffer, fileName) {
    if (buffer.length < 26 || buffer.toString("ascii", 0, 4) !== "8BPS") throw new Error("Invalid Photoshop signature");
    const version = buffer.readUInt16BE(4);
    const extension = path.extname(fileName).toLowerCase();
    if (version !== (extension === ".psb" ? 2 : 1)) throw new Error("PSD/PSB version does not match extension");
    const height = buffer.readUInt32BE(14);
    const width = buffer.readUInt32BE(18);
    if (!width || !height || width > 300000 || height > 300000) throw new Error("Unsupported Photoshop document dimensions");
    return { width, height, pages: 1, format: extension.slice(1) };
}

async function dimensions(filePath, extension) {
    if (PHOTOSHOP_SOURCES.has(extension)) {
        const fh = await fs.promises.open(filePath, "r");
        try {
            const header = Buffer.alloc(26);
            const r = await fh.read(header, 0, header.length, 0);
            return parsePhotoshopHeader(header.subarray(0, r.bytesRead), filePath);
        } finally { await fh.close(); }
    }
    const meta = await sharp(filePath, { animated: false, failOn: "error", limitInputPixels: 400000000 }).metadata();
    let width = meta.width;
    let height = meta.height;
    if ([5, 6, 7, 8].includes(meta.orientation)) [width, height] = [height, width];
    if (!width || !height) throw new Error("Could not read image dimensions");
    return { width, height, pages: meta.pages || 1, format: meta.format };
}

function findSingle(files, folderName) {
    const byName = files.filter(f => /single/i.test(path.parse(f.name).name));
    const byFolder = files.filter(f => path.parse(f.name).name.toLowerCase() === folderName.toLowerCase());
    // In some production folders the product ID does not match the folder
    // name. Accept an unmistakable, unnumbered product-code basename as a
    // last automatic hint (e.g. AKA-90, APM-90200-JP, DPK100).
    const codeLike = files.filter(f => /^[A-Z]{2,8}[-_]?\d{2,}(?:[-_][A-Z0-9]+)*$/.test(path.parse(f.name).name));
    const matched = byName.length ? byName : byFolder.length ? byFolder : codeLike;
    const method = byName.length ? "filename contains Single" : byFolder.length ? "filename matches folder" : "unambiguous product-code filename";
    if (matched.length === 1) return { singlePath: matched[0].path, warnings: [], method };
    if (matched.length > 1) return {
        singlePath: null, method: null,
        warnings: [`Several possible Single images were found (${matched.map(f => f.name).join(", ")}). Choose one manually.`]
    };
    return { singlePath: null, method: null, warnings: ["Single was not detected. Select a file and click Set as Single."] };
}

async function scanFolder(folder) {
    const abs = path.resolve(folder);
    const stat = await fs.promises.stat(abs);
    if (!stat.isDirectory()) throw new Error("Choose a source folder, not a file.");
    const items = await fs.promises.readdir(abs, { withFileTypes: true });
    const priorExports = await generatedNames(abs);
    const candidates = naturalSort(items.filter(e => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase()) &&
        !e.name.startsWith(".") && !e.name.startsWith("~$") && !isGeneratedOutput(e.name, path.basename(abs)) &&
        !priorExports.has(e.name.toLowerCase()))
        .map(e => ({ name: e.name, path: path.join(abs, e.name) })));
    if (candidates.length > MAX_IMAGES) throw new Error(`Folder has ${candidates.length} images. Maximum ${MAX_IMAGES}; split this LP into smaller projects.`);
    const accepted = [];
    const warnings = [];
    for (const item of candidates) {
        try {
            const fileStat = await fs.promises.stat(item.path);
            if (!fileStat.size) throw new Error("Empty file");
            const ext = path.extname(item.name).toLowerCase();
            const info = await dimensions(item.path, ext);
            accepted.push({ ...item, extension: ext, width: info.width, height: info.height,
                bytes: fileStat.size, mtimeMs: fileStat.mtimeMs,
                type: PHOTOSHOP_SOURCES.has(ext) ? "Photoshop Smart Object" : "Image Smart Object" });
            if (info.pages > 1 && !PHOTOSHOP_SOURCES.has(ext)) warnings.push(`${item.name}: animation/multipage input; only the first frame/page is used.`);
        } catch (error) {
            warnings.push(`${item.name}: not included (${error.message}). Codec may be unavailable; convert to PNG, TIFF, or PSD in Photoshop.`);
        }
    }
    if (!accepted.length) throw new Error(`No readable image files were found in ${abs}. ${warnings.join(" ")}`);
    const detected = findSingle(accepted, path.basename(abs));
    return { folder: abs, folderName: path.basename(abs), suggestedOutputName: `${safeDocumentName(path.basename(abs))}_LP`,
        images: accepted, singlePath: detected.singlePath,
        warnings: [...warnings, ...detected.warnings], detection: detected.method };
}

function safeDocumentName(folder) {
    let val = String(folder || "LandingPage").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").trim();
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(val)) val += "_product";
    return (val || "LandingPage").slice(0, 100);
}

// A designer can rename the output independently of the source folder.
// Extensions are decided automatically by document size and JPEG output.
function normalizeOutputBaseName(raw, folderName) {
    const value = raw == null ? `${safeDocumentName(folderName)}_LP` : String(raw).trim();
    const stem = value.replace(/\.(?:psd|psb|jpe?g)$/i, "");
    if (!stem || stem.length > 120 || /^[.]/.test(stem) || /[. ]$/.test(stem) ||
        /[<>:"\/\\|?*\x00-\x1f]/.test(stem) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(stem)) {
        throw new Error("Invalid LP output filename. Use a name without paths, reserved characters, or trailing dots; maximum 120 characters.");
    }
    return stem;
}

function createLayout(snapshot, orderedPaths, singlePath, outputBaseName) {
    const allowed = new Map(snapshot.images.map(i => [i.path.toLowerCase(), i]));
    if (!singlePath) throw new Error("Assign a Single image before generating the LP.");
    const single = allowed.get(String(singlePath).toLowerCase());
    if (!single) throw new Error("Single must be a readable image from the selected folder.");
    if (!Array.isArray(orderedPaths) || !orderedPaths.length || orderedPaths.length > allowed.size) {
        throw new Error("The LP image list is empty or invalid. Refresh the folder and review the image list.");
    }
    const used = new Set();
    const selected = orderedPaths.map(p => {
        const key = String(p).toLowerCase();
        const item = allowed.get(key);
        if (!item || used.has(key)) throw new Error("The ordered image list includes an invalid or duplicate file.");
        used.add(key);
        return item;
    });
    const singleKey = single.path.toLowerCase();
    if (!used.has(singleKey)) throw new Error("The selected Single is not in the current image queue.");
    const rest = selected.filter(i => i.path.toLowerCase() !== singleKey);
    const fit = Math.min(WIDTH / single.width, SINGLE_SIZE / single.height);
    const sWidth = Math.max(1, Math.round(single.width * fit));
    const sHeight = Math.max(1, Math.round(single.height * fit));
    const singlePlacement = { ...single, x: Math.floor((WIDTH - sWidth) / 2), y: Math.floor((SINGLE_SIZE - sHeight) / 2),
        placedWidth: sWidth, placedHeight: sHeight, group: "01_SINGLE", layer: "Single" };
    let y = SINGLE_SIZE;
    const sections = rest.map((image, index) => {
        const height = Math.max(1, Math.round(image.height / image.width * WIDTH));
        if (height > DOCUMENT_MAX_HEIGHT) throw new Error(`${image.name} is too tall for one Photoshop document.`);
        const section = { ...image, x: 0, y, placedWidth: WIDTH, placedHeight: height,
            group: `${String(index + 2).padStart(2, "0")}_LP_PART_${String(index + 1).padStart(2, "0")}`,
            layer: path.parse(image.name).name.slice(0, 140) };
        y += height;
        return section;
    });
    if (y > DOCUMENT_MAX_HEIGHT) throw new Error(`LP height ${y.toLocaleString()}px exceeds Photoshop's 300,000px limit. Split the page.`);
    const baseName = normalizeOutputBaseName(outputBaseName, snapshot.folderName);
    // The publisher replaces *all* PSD/JPEG members of an existing LP family.
    // Refuse any custom stem that would match a source image, including a JPG
    // strip such as Custom_01.jpg, even when overwrite is enabled.
    const sourceConflict = new RegExp(`^${escapeRegex(baseName)}(?:_\\d+)?\\.(?:psd|psb|jpe?g)$`, "i");
    const collision = snapshot.images.find(image => sourceConflict.test(image.name));
    if (collision) {
        throw new Error(`Output name ${baseName} conflicts with source image ${collision.name}. Choose a different LP filename to protect the originals.`);
    }
    return { width: WIDTH, height: y, format: y > PSD_MAX_HEIGHT ? "psb" : "psd",
        single: singlePlacement, sections, folder: snapshot.folder,
        folderName: snapshot.folderName, baseName };
}

module.exports = { WIDTH, SINGLE_SIZE, PSD_MAX_HEIGHT, DOCUMENT_MAX_HEIGHT, IMAGE_EXTENSIONS,
    PHOTOSHOP_SOURCES, naturalSort, parsePhotoshopHeader, dimensions, findSingle, scanFolder, createLayout,
    safeDocumentName, normalizeOutputBaseName };
