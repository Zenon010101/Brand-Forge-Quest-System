"use strict";

const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const { recordGeneratedPaths } = require("./generatedIndex");

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function statOrNull(file) {
    try { return await fs.promises.lstat(file); }
    catch (e) { if (e.code === "ENOENT") return null; throw e; }
}
async function fingerprint(file) {
    const hash = createHash("sha256");
    let size = 0;
    for await (const buf of fs.createReadStream(file)) { hash.update(buf); size += buf.length; }
    return { size, hash: hash.digest("hex") };
}
async function matches(file, expected) {
    const delays = [0, 300, 900, 1800];
    for (let i = 0; i < delays.length; i++) {
        if (delays[i]) await pause(delays[i]);
        try {
            const now = await fingerprint(file);
            if (now.size === expected.size && now.hash === expected.hash) return true;
        } catch (_) { /* shared-drive file availability may lag the write */ }
    }
    return false;
}
async function verifiedCopy(source, target, expected, exclusive = false) {
    if (exclusive) {
        const f = await fs.promises.open(target, "wx");
        await f.close();
    }
    for (let attempt = 0; attempt < 3; attempt++) {
        await fs.promises.copyFile(source, target);
        if (await matches(target, expected)) return;
        await pause(300 * (attempt + 1));
    }
    throw new Error(`${path.basename(target)}: written bytes did not match the Photoshop output after retries.`);
}
async function nextFreePath(folder, stem, ext) {
    const base = path.join(folder, `${stem}.${ext}`);
    if (!await statOrNull(base)) return base;
    for (let n = 2; n < 1000; n++) {
        const p = path.join(folder, `${stem}_v${n}.${ext}`);
        if (!await statOrNull(p)) return p;
    }
    throw new Error("Too many existing LP output versions.");
}

async function publish(workPsd, folder, stem, format, behavior = "version") {
    if (!["version", "replace", "cancel"].includes(behavior)) throw new Error("Invalid overwrite policy.");
    const resolvedFolder = await fs.promises.realpath(folder);
    const base = path.join(resolvedFolder, `${stem}.${format}`);
    const target = behavior === "version" ? await nextFreePath(resolvedFolder, stem, format) : base;
    const existing = await statOrNull(target);
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error("Output path is not a regular file; refusing to overwrite.");
    if (existing && behavior === "cancel") throw new Error("Output exists. Choose Save New Version or Back Up + Replace.");
    const expected = await fingerprint(workPsd);
    if (expected.size < 1000) throw new Error("Staged PSD/PSB is empty.");
    let backupPath = null;
    let original = null;
    if (existing) {
        if (behavior !== "replace") throw new Error("Output appeared during publishing. Choose another version.");
        const backups = path.join(resolvedFolder, ".brandforge-lp-backups");
        await fs.promises.mkdir(backups, { recursive: true });
        backupPath = path.join(backups, `${path.basename(target)}.${new Date().toISOString().replace(/[:.]/g,"-")}.${process.pid}.bak`);
        original = await fingerprint(target);
        await fs.promises.copyFile(target, backupPath, fs.constants.COPYFILE_EXCL);
        if (!await matches(backupPath, original)) {
            await fs.promises.rm(backupPath, { force: true }).catch(() => {});
            throw new Error("Cannot verify the original output backup; existing PSD left unchanged.");
        }
    }
    let touched = false;
    try {
        // New files get an exclusive CREATE_NEW reservation to guard against
        // another process creating the same name after preflight.
        if (!existing) {
            const f = await fs.promises.open(target, "wx");
            touched = true;
            await f.close();
        } else { touched = true; }
        await verifiedCopy(workPsd, target, expected);
    } catch (error) {
        if (touched) {
            try {
                if (backupPath) await verifiedCopy(backupPath, target, original);
                else await fs.promises.rm(target, { force: true });
            } catch (rollback) {
                throw new Error(`${error.message} ROLLBACK FAILED: ${rollback.message}. Backup retained at ${backupPath || "not available"}`);
            }
        }
        throw error;
    }
    return { outputPath: target, backupPath, size: expected.size };
}

// Publish a layered PSD/PSB and all its JPEG exports as one logical job.
// A broken/shared-drive write must not leave a new PSD without its JPEG, or
// replace a good old LP with half of the newly generated outputs.
function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function familyRegex(label) {
    return new RegExp(`^${escapeRegex(label)}(?:_\\d+)?\\.(?:psd|psb|jpe?g)$`, "i");
}
function sourceItems(staged, folder, label, format) {
    const jpgs = staged.jpegParts;
    const items = [{ input: staged.psdPath, target: path.join(folder, `${label}.${format}`), kind: "psd" }];
    for (let i = 0; i < jpgs.length; i++) {
        const postfix = jpgs.length === 1 ? "" : `_${String(i + 1).padStart(2, "0")}`;
        items.push({ input: jpgs[i].path, target: path.join(folder, `${label}${postfix}.jpg`),
            kind: "jpeg", top: jpgs[i].top, height: jpgs[i].height });
    }
    return items;
}
async function validateStagedLP(staged, format) {
    if (!staged || !staged.psdPath || !Array.isArray(staged.jpegParts) || !staged.jpegParts.length) {
        throw new Error("Photoshop did not return both editable and JPEG LP outputs.");
    }
    const psd = await fingerprint(staged.psdPath);
    if (psd.size < 1000) throw new Error("Staged Photoshop document is empty.");
    const sharp = require("sharp");
    let nextTop = 0;
    for (const part of staged.jpegParts) {
        if (part.top !== nextTop || !Number.isInteger(part.height) || part.height < 1 || part.height > 60000) {
            throw new Error("JPEG parts are missing or out of order.");
        }
        const meta = await sharp(part.path, { limitInputPixels: 400000000 }).metadata();
        if (meta.format !== "jpeg" || meta.width !== 1000 || meta.height !== part.height) {
            throw new Error(`${path.basename(part.path)} is not a valid full-resolution LP JPEG.`);
        }
        nextTop += part.height;
    }
    return { size: psd.size, height: nextTop, format };
}
async function publishLP(staged, folder, stem, format, behavior = "version") {
    if (!["psd", "psb"].includes(format) || !["version", "replace", "cancel"].includes(behavior)) {
        throw new Error("Invalid LP format or overwrite policy.");
    }
    const validated = await validateStagedLP(staged, format);
    const resolved = await fs.promises.realpath(folder);
    const existingNames = await fs.promises.readdir(resolved);
    let label = stem;
    if (behavior === "version") {
        let found = false;
        for (let n = 1; n <= 999; n++) {
            const candidate = n === 1 ? stem : `${stem}_v${n}`;
            if (!existingNames.some(name => familyRegex(candidate).test(name))) {
                label = candidate;
                found = true;
                break;
            }
        }
        if (!found) throw new Error("Too many LP output versions exist in this folder.");
    } else if (behavior === "cancel" && existingNames.some(name => familyRegex(stem).test(name))) {
        throw new Error("An LP Photoshop/JPEG output exists. Choose Save New Version or Back Up + Replace.");
    }
    const items = sourceItems(staged, resolved, label, format);
    if (new Set(items.map(f => f.target.toLowerCase())).size !== items.length) {
        throw new Error("Generated LP output filenames would overlap.");
    }
    // Inspect every member of this version's output family, including older
    // JPEG strips no longer needed when a shorter LP replaces a taller one.
    const related = existingNames.filter(name => familyRegex(label).test(name));
    if (related.length && behavior === "version") {
        throw new Error("LP export version was created by another process; retry to choose a new version.");
    }
    const original = new Map();
    for (const name of related) {
        const target = path.join(resolved, name);
        const stat = await statOrNull(target);
        if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
            throw new Error(`${name}: existing LP output is not a regular file; nothing was replaced.`);
        }
        original.set(target.toLowerCase(), { target, expected: await fingerprint(target), backup: null });
    }
    const expectedFiles = [];
    for (const item of items) {
        const expected = await fingerprint(item.input);
        if (expected.size < 100) throw new Error(`Missing or empty staged LP output: ${path.basename(item.input)}`);
        expectedFiles.push({ ...item, expected });
        const existed = await statOrNull(item.target);
        if (existed && (!existed.isFile() || existed.isSymbolicLink())) {
            throw new Error(`Output destination is not a regular file: ${path.basename(item.target)}`);
        }
        if (existed && behavior !== "replace") {
            throw new Error(`${path.basename(item.target)} already exists; no LP files were published.`);
        }
    }
    const backups = {};
    if (original.size) {
        const backupDir = path.join(resolved, ".brandforge-lp-backups");
        await fs.promises.mkdir(backupDir, { recursive: true });
        const { randomBytes } = require("crypto");
        for (const entry of original.values()) {
            const backup = path.join(backupDir, `${path.basename(entry.target)}.${Date.now()}-${process.pid}-${randomBytes(4).toString("hex")}.bak`);
            await fs.promises.copyFile(entry.target, backup, fs.constants.COPYFILE_EXCL);
            if (!await matches(backup, entry.expected)) {
                throw new Error(`${path.basename(entry.target)}: cannot verify backup; existing LP is unchanged.`);
            }
            entry.backup = backup;
            backups[path.basename(entry.target)] = backup;
        }
    }
    const touched = new Set();
    try {
        for (const item of expectedFiles) {
            const old = original.get(item.target.toLowerCase());
            if (!old) {
                const handle = await fs.promises.open(item.target, "wx");
                touched.add(item.target);
                await handle.close();
            } else {
                // Do not overwrite if another process changed an existing LP
                // after it was backed up.
                if (!await matches(old.target, old.expected)) {
                    throw new Error(`${path.basename(item.target)} changed during publishing. Retry.`);
                }
                touched.add(old.target);
            }
            await verifiedCopy(item.input, item.target, item.expected);
        }
        // Remove obsolete files from the replaced output family only after
        // every new Photoshop/JPEG file has been verified. All are backed up.
        const used = new Set(items.map(item => item.target.toLowerCase()));
        for (const entry of original.values()) {
            if (!used.has(entry.target.toLowerCase())) {
                touched.add(entry.target);
                await fs.promises.rm(entry.target);
            }
        }
    } catch (error) {
        const failures = [];
        for (const target of [...touched].reverse()) {
            const old = original.get(target.toLowerCase());
            try {
                if (old) await verifiedCopy(old.backup, old.target, old.expected);
                else await fs.promises.rm(target, { force: true });
            } catch (rollbackError) { failures.push(`${path.basename(target)}: ${rollbackError.message}`); }
        }
        if (failures.length) {
            throw new Error(`${error.message} ROLLBACK FAILED: ${failures.join("; ")}. Check .brandforge-lp-backups before retrying.`);
        }
        throw error;
    }
    const jpegPaths = items.filter(i => i.kind === "jpeg").map(i => i.target);
    const outputPaths = [items[0].target, ...jpegPaths];
    // Track completed custom-named LPs so a later folder scan never imports
    // the generated PSD/JPEG as another source image. A tracking write failure
    // does not invalidate a pair of already verified exports.
    let trackingWarning = null;
    try { await recordGeneratedPaths(resolved, outputPaths); }
    catch (error) { trackingWarning = `LP saved, but could not register outputs for future folder scans: ${error.message}`; }
    return { outputPath: items[0].target, jpegPath: jpegPaths[0], jpegPaths,
        outputPaths, backupPath: backups[path.basename(items[0].target)] || null,
        backupPaths: backups, size: validated.size, jpegCount: jpegPaths.length, trackingWarning };
}

module.exports = { publish, publishLP, fingerprint, nextFreePath, matches, validateStagedLP, familyRegex };
