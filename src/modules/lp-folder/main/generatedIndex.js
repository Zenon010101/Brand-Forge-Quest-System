"use strict";

const fs = require("fs");
const path = require("path");

// Folder-local record of finished LP exports. This lets custom-named PSD and
// JPEG outputs stay out of the source image queue when the folder is rescanned.
// Append-only records are compatible with mapped/shared drives that do not
// reliably support atomic rename or hard-link operations.
const INDEX_NAME = ".brandforge-lp-generated.jsonl";
const MAX_INDEX_BYTES = 2 * 1024 * 1024;

async function generatedNames(folder) {
    const names = new Set();
    try {
        const stat = await fs.promises.stat(path.join(folder, INDEX_NAME));
        if (stat.size > MAX_INDEX_BYTES) return names;
        const raw = await fs.promises.readFile(path.join(folder, INDEX_NAME), "utf8");
        for (const line of raw.split(/\r?\n/)) {
            if (!line.trim()) continue;
            try {
                const data = JSON.parse(line);
                if (!Array.isArray(data.files)) continue;
                for (const file of data.files) {
                    if (typeof file === "string" && file === path.basename(file)) names.add(file.toLowerCase());
                }
            } catch (_) { /* ignore an incomplete final line after interruption */ }
        }
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    return names;
}

async function recordGeneratedPaths(folder, paths) {
    const files = [...new Set(paths.map(file => path.basename(file)))];
    await fs.promises.appendFile(path.join(folder, INDEX_NAME), JSON.stringify({
        version: 1, timestamp: new Date().toISOString(), files
    }) + "\n", "utf8");
}

module.exports = { INDEX_NAME, generatedNames, recordGeneratedPaths };
