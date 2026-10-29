"use strict";

// Folder-path import for the MANUAL Amazon Image Library. It does not create
// Product Groups or alter input files.
const fs = require("fs");
const path = require("path");
const { naturalSort, SUPPORTED_EXTENSIONS, sourceTypeFromExtension } = require("./folderScanner");
const { matchesExtension, findFilter } = require("../shared/imageFilters");
const { MAX_POOL_FILES } = require("./batchWorkspace");

const MAX_SCANNED_FOLDERS = 350;
const MAX_NESTING_DEPTH = 12;

function normalizedFolderPath(value) {
    let result = String(value || "").trim();
    if (result.length > 1 && ((result.startsWith('"') && result.endsWith('"')) ||
        (result.startsWith("'") && result.endsWith("'")))) result = result.slice(1, -1).trim();
    if (!path.isAbsolute(result)) throw new Error("Enter an absolute image-folder path (e.g. G:\\Products\\Images).");
    return path.normalize(result);
}
async function scanBatchImageFolder(rawPath, options = {}) {
    const folderPath = normalizedFolderPath(rawPath);
    const recursive = options.recursive === true;
    const format = String(options.format || "all").toLowerCase();
    if (!findFilter(format)) throw new Error("Unknown source-image file type filter.");
    const directory = await fs.promises.stat(folderPath);
    if (!directory.isDirectory()) throw new Error("Image path must refer to a folder.");

    const candidates = [];
    const folders = [{ directory: folderPath, depth: 0 }];
    const warnings = [];
    let visited = 0;
    while (folders.length) {
        const current = folders.shift();
        if (++visited > MAX_SCANNED_FOLDERS) {
            throw new Error(`Folder scan exceeds ${MAX_SCANNED_FOLDERS} directories. Choose a smaller folder or turn off Include subfolders.`);
        }
        let entries;
        try { entries = await fs.promises.readdir(current.directory, { withFileTypes: true }); }
        catch (error) {
            if (current.depth === 0) throw error;
            warnings.push(`Cannot open ${current.directory}: ${error.message || String(error)}`);
            continue;
        }
        entries.sort((a, b) => naturalSort(a.name, b.name));
        for (const entry of entries) {
            if (entry.name.startsWith(".") || entry.name.startsWith("~$") || entry.name.toLowerCase() === "thumbs.db") continue;
            const target = path.join(current.directory, entry.name);
            if (entry.isDirectory() && recursive) {
                if (current.depth >= MAX_NESTING_DEPTH) {
                    warnings.push(`Nested folders beyond depth ${MAX_NESTING_DEPTH} were skipped under ${target}.`);
                } else folders.push({ directory: target, depth: current.depth + 1 });
            } else if (entry.isFile()) {
                const extension = path.extname(entry.name).toLowerCase();
                if (!SUPPORTED_EXTENSIONS.has(extension) || !matchesExtension(extension, format)) continue;
                candidates.push(target);
                if (candidates.length > MAX_POOL_FILES) {
                    throw new Error(`More than ${MAX_POOL_FILES} images match this scan. Choose a smaller folder or a specific file type.`);
                }
            }
        }
    }
    // Stable filename/relative-path order on every scan; individual user picks
    // are handled separately, and never re-sorted before assignment.
    candidates.sort((a, b) => naturalSort(path.relative(folderPath, a), path.relative(folderPath, b)));
    const files = new Array(candidates.length);
    const errors = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(12, candidates.length) }, async () => {
        while (cursor < candidates.length) {
            const index = cursor++;
            const candidate = candidates[index];
            try {
                const info = await fs.promises.stat(candidate);
                if (!info.isFile() || !info.size) throw new Error("empty or unavailable image file");
                const extension = path.extname(candidate).toLowerCase();
                files[index] = {
                    path: candidate, name: path.basename(candidate),
                    relativePath: path.relative(folderPath, candidate),
                    extension, sourceType: sourceTypeFromExtension(extension),
                    size: info.size, modifiedMs: info.mtimeMs
                };
            } catch (error) { errors.push(`${path.relative(folderPath, candidate)}: ${error.message || String(error)}`); }
        }
    });
    await Promise.all(workers);
    return { folderPath, recursive, format, files: files.filter(Boolean),
        errors, warnings, scannedFolders: visited };
}
module.exports = { scanBatchImageFolder, normalizedFolderPath, MAX_SCANNED_FOLDERS };
