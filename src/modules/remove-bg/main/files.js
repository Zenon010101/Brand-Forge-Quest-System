"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Photoshop may open further formats, but only accept well-known raster formats
// here so vector, multi-page and camera-raw files cannot silently yield bad exports.
const SUPPORTED_EXTENSIONS = new Set([
    ".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff",
    ".bmp", ".gif", ".psd", ".psb", ".tga", ".heic", ".heif"
]);

function outputPaths(inputPath) {
    const source = path.resolve(inputPath);
    const stem = path.parse(source).name;
    return {
        png: path.join(path.dirname(source), `${stem}.png`),
        psd: path.join(path.dirname(source), `${stem}.psd`)
    };
}

function pathKey(filePath) {
    const normalized = path.normalize(path.resolve(filePath));
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function inspectSource(filePath) {
    if (typeof filePath !== "string" || !filePath.trim() || !path.isAbsolute(filePath)) {
        throw new Error("Select an image from your computer first.");
    }
    const absolute = path.resolve(filePath);
    const extension = path.extname(absolute).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
        throw new Error(`Unsupported file type: ${extension || "(none)"}.`);
    }
    const stat = await fs.promises.stat(absolute);
    if (!stat.isFile() || stat.size === 0) throw new Error("Image is empty or is not a regular file.");
    return {
        path: absolute,
        name: path.basename(absolute),
        extension,
        size: stat.size,
        modifiedMs: stat.mtimeMs,
        ...outputPaths(absolute)
    };
}

function stagePath(destination) {
    return path.join(path.dirname(destination),
        `.${path.parse(destination).name}.gws-${crypto.randomUUID()}${path.extname(destination)}`);
}

async function pathExists(filePath) {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
    }
}

/**
 * The Photoshop stage is complete and validated before this is called.
 * Existing outputs (including an opaque PNG input with the same target name)
 * are never silently destroyed. Enabled replacements retain a dated backup.
 */
async function commitStagedFile(stage, destination, overwrite) {
    const exists = await pathExists(destination);
    if (exists && !overwrite) {
        throw new Error(`${path.basename(destination)} already exists. Enable "Back up and replace existing files" to overwrite it safely.`);
    }
    if (!exists) {
        // Exclusive destination creation avoids overwriting a file created
        // between the check and the commit by another program.
        await fs.promises.copyFile(stage, destination, fs.constants.COPYFILE_EXCL);
        await fs.promises.unlink(stage);
        return { destination, backupPath: null };
    }

    const backupDir = path.join(path.dirname(destination), "GWS Backups");
    await fs.promises.mkdir(backupDir, { recursive: true });
    const { name, ext } = path.parse(destination);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `${name}.${timestamp}-${crypto.randomUUID().slice(0, 8)}${ext}`);
    await fs.promises.rename(destination, backupPath);
    try {
        await fs.promises.rename(stage, destination);
        return { destination, backupPath };
    } catch (error) {
        try {
            await fs.promises.rename(backupPath, destination);
        } catch (restoreError) {
            throw new Error(`Save failed and the original is in ${backupPath}. ${restoreError.message}`);
        }
        throw error;
    }
}

module.exports = {
    SUPPORTED_EXTENSIONS,
    inspectSource,
    outputPaths,
    pathKey,
    stagePath,
    pathExists,
    commitStagedFile
};
