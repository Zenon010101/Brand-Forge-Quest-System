"use strict";

const path = require("path");
const fs = require("fs");

const CANVAS_WIDTH = 1000;
const SINGLE_HEIGHT = 1000;
const PSD_HEIGHT_LIMIT = 30000;
const PHOTOSHOP_HEIGHT_LIMIT = 300000;
const RASTER_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp", ".gif", ".avif"]);

function validateProjectCode(value) {
    const code = String(value || "").trim().replace(/\.(?:psd|psb)$/i, "");
    if (!code || code.length > 90 || /[<>:"/\\|?*\x00-\x1f]/.test(code) || /[. ]$/.test(code) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(code) || code === "." || code === "..") {
        throw new Error("Enter a valid product code (1-90 characters; no Windows filename special characters).");
    }
    return code;
}

function checkImageFile(filePath) {
    if (typeof filePath !== "string" || !filePath.trim()) throw new Error("Choose an image file.");
    const absolute = path.resolve(filePath);
    if (!RASTER_EXTENSIONS.has(path.extname(absolute).toLowerCase())) {
        throw new Error(`Unsupported screenshot format: ${path.basename(absolute)}`);
    }
    const stat = fs.statSync(absolute);
    if (!stat.isFile() || !stat.size) throw new Error(`File is empty or not an image: ${absolute}`);
    if (stat.size > 350 * 1024 * 1024) throw new Error(`File exceeds 350 MB: ${path.basename(absolute)}`);
    return absolute;
}

function uniqueSourceOrder(paths) {
    if (!Array.isArray(paths) || !paths.length) throw new Error("Add at least one Landing Page screenshot.");
    if (paths.length > 75) throw new Error("Maximum 75 screenshot parts per landing page.");
    const seen = new Set();
    return paths.map(file => {
        const absolute = checkImageFile(file);
        const key = process.platform === "win32" ? absolute.toLowerCase() : absolute;
        if (seen.has(key)) throw new Error(`Duplicate screenshot: ${path.basename(absolute)}`);
        seen.add(key);
        return absolute;
    });
}

function assembleLayout(parts) {
    let y = SINGLE_HEIGHT;
    const result = parts.map((part, index) => {
        const width = Number(part.width);
        const height = Number(part.height);
        if (width !== CANVAS_WIDTH || !Number.isSafeInteger(height) || height < 1) {
            throw new Error(`Invalid normalized dimensions for screenshot ${index + 1}.`);
        }
        const row = { ...part, partIndex: index, y, group: `${String(index + 2).padStart(2, "0")}_LP_PART_${String(index + 1).padStart(2, "0")}` };
        y += height;
        return row;
    });
    if (y > PHOTOSHOP_HEIGHT_LIMIT) {
        throw new Error(`Total height ${y.toLocaleString()} px exceeds Photoshop's ${PHOTOSHOP_HEIGHT_LIMIT.toLocaleString()} px maximum. Split the landing page into two projects.`);
    }
    const format = y > PSD_HEIGHT_LIMIT ? "psb" : "psd";
    return {
        width: CANVAS_WIDTH, height: y, singleHeight: SINGLE_HEIGHT, parts: result,
        format,
        warnings: format === "psb" ? [`Document height ${y}px exceeds Photoshop's standard PSD limit (${PSD_HEIGHT_LIMIT}px); output will be an editable .psb Large Document Format file.`] : []
    };
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

module.exports = {
    CANVAS_WIDTH, SINGLE_HEIGHT, PSD_HEIGHT_LIMIT, PHOTOSHOP_HEIGHT_LIMIT,
    RASTER_EXTENSIONS, validateProjectCode, checkImageFile, uniqueSourceOrder, assembleLayout, clamp
};
