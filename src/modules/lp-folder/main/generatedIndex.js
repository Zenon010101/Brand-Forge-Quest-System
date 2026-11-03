"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHash } = require("crypto");

// Older releases wrote a hidden manifest beside the customer's LP assets.
// Keep reading it for migration, but never create another file in that folder.
const INDEX_NAME = ".brandforge-lp-generated.jsonl";
const MAX_INDEX_BYTES = 2 * 1024 * 1024;

function stateRoot() {
    // Explicit override is also useful for isolated automated tests.
    if (process.env.BRANDFORGE_LP_STATE_DIR) return path.resolve(process.env.BRANDFORGE_LP_STATE_DIR);
    if (process.versions.electron) {
        try {
            const electron = require("electron");
            if (electron.app && electron.app.isReady()) {
                return path.join(electron.app.getPath("userData"), "lp-folder-state");
            }
        } catch (_) { /* use per-user directory fallback */ }
    }
    const base = process.env.LOCALAPPDATA || (process.platform === "win32"
        ? path.join(os.homedir(), "AppData", "Local")
        : path.join(os.homedir(), ".local", "share"));
    return path.join(base, "BrandForge", "lp-folder-state");
}

function folderKey(folder) {
    return createHash("sha256").update(path.resolve(folder).replace(/\\/g, "/").toLowerCase()).digest("hex");
}

function indexPath(folder) {
    return path.join(stateRoot(), "index", `${folderKey(folder)}.jsonl`);
}

function backupFolder(folder) {
    return path.join(stateRoot(), "backups", folderKey(folder));
}

async function readNames(file) {
    const names = new Set();
    try {
        const stat = await fs.promises.stat(file);
        if (stat.size > MAX_INDEX_BYTES) return names;
        const raw = await fs.promises.readFile(file, "utf8");
        for (const line of raw.split(/\r?\n/)) {
            if (!line.trim()) continue;
            try {
                const parsed = JSON.parse(line);
                if (!Array.isArray(parsed.files)) continue;
                for (const name of parsed.files) {
                    if (typeof name === "string" && name === path.basename(name)) names.add(name.toLowerCase());
                }
            } catch (_) { /* interrupted append: ignore malformed line */ }
        }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    return names;
}

async function recordGeneratedPaths(folder, paths) {
    const files = [...new Set(paths.map(file => path.basename(file)))];
    if (!files.length) return;
    const target = indexPath(folder);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.appendFile(target, JSON.stringify({
        version: 2, timestamp: new Date().toISOString(), files
    }) + "\n", "utf8");
}

async function generatedNames(folder) {
    const names = await readNames(indexPath(folder));
    const legacy = path.join(folder, INDEX_NAME);
    const oldNames = await readNames(legacy);
    for (const name of oldNames) names.add(name);
    // Once verified in local application data, remove the old BrandForge-only
    // helper index from the LP folder. Original product images are never touched.
    try {
        const exists = await fs.promises.stat(legacy).then(s => s.isFile(), e => {
            if (e.code === "ENOENT") return false;
            throw e;
        });
        if (exists) {
            if (oldNames.size) await recordGeneratedPaths(folder, [...oldNames]);
            await fs.promises.rm(legacy);
        }
    } catch (_) {
        // Read-only/shared-drive permissions must not prevent scanning inputs.
        // The legacy records are still respected for the current scan.
    }
    return names;
}

module.exports = { INDEX_NAME, generatedNames, recordGeneratedPaths, stateRoot, folderKey, indexPath, backupFolder };
