"use strict";

// Optional Amazon extras. No source PSD or marker is ever opened or modified.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { SUPPORTED_EXTENSIONS, sourceTypeFromExtension } = require("./folderScanner");
const { validId } = require("../shared/sharingPlan");
const { publishGroup, canonicalPath } = require("./sharedExporter");
const { discoverProject } = require("../../project-location/main/projectPaths");

const normalized = value => path.resolve(String(value || "")).replace(/\\/g, "/").toLowerCase();
const cleanName = value => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function verifyCreativeImage(creativePath) {
    if (!creativePath) return null;
    if (typeof creativePath !== "string" || !path.isAbsolute(creativePath)) {
        throw new Error("Creative: select an absolute file path.");
    }
    const extension = path.extname(creativePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
        throw new Error(`Creative: unsupported image type ${extension || "(none)"}.`);
    }
    const stat = await fs.promises.stat(creativePath);
    if (!stat.isFile() || !stat.size) throw new Error("Creative: source image is empty or missing.");
    return { path: creativePath, name: path.basename(creativePath), extension,
        sourceType: sourceTypeFromExtension(extension) };
}

function withAssignedMains(parents) {
    return (parents || []).map(parent => ({ ...parent, variants: (parent.variants || []).map(variant => {
        if (!variant.mainPath) return variant;
        const files = variant.files || [];
        const index = files.findIndex(file => normalized(file.path) === normalized(variant.mainPath));
        if (index < 0) throw new Error(`${variant.id}: assigned Main Image #1 is not in this ID's selected images.`);
        return { ...variant, files: [files[index], ...files.filter((_, i) => i !== index)] };
    }) }));
}
async function withCreativeSecond(parents, creativePath) {
    const mainAssigned = withAssignedMains(parents);
    const creative = await verifyCreativeImage(creativePath);
    if (!creative) return mainAssigned;
    return mainAssigned.map(parent => ({ ...parent, variants: (parent.variants || []).map(variant => {
        const files = variant.files || [];
        if (files.length > 7) {
            throw new Error(`${variant.id}: Creative takes Amazon image #2. Select at most 7 original images (1 main + 6 others).`);
        }
        if (!files.length) return variant;
        if (files.some(file => normalized(file.path) === normalized(creative.path))) {
            throw new Error(`${variant.id}: Creative was already selected. Remove the duplicate from this ID and keep the Creative option enabled.`);
        }
        return { ...variant, files: [files[0], creative, ...files.slice(1)] };
    }) }));
}

// Only treat an explicitly named PLAIN.psd as a location marker.
function plainMarker(folder) {
    if (!folder || !path.isAbsolute(folder)) return null;
    let entries;
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); }
    catch (_) { return null; }
    const file = entries.find(e => e.isFile() && e.name.toLowerCase() === "plain.psd");
    return file ? path.join(folder, file.name) : null;
}
function validatedRkPlainFolder(folder) {
    const marker = plainMarker(folder);
    if (!marker) throw new Error("RK Plain folder must contain PLAIN.psd. Select SINGLE / RAKUEN / !!RAK PLAIN!! (also supports RAKUTEN).");
    const folderStat = fs.statSync(folder);
    const markerStat = fs.lstatSync(marker);
    if (!folderStat.isDirectory() || !markerStat.isFile() || markerStat.isSymbolicLink()) {
        throw new Error("RK Plain: invalid folder or marker.");
    }
    return { folder: fs.realpathSync(folder), marker: fs.realpathSync(marker) };
}
// Read only the exact RK Plain role inside the linked brand root. The same
// discoverProject() powers Amazon/Slider/Colorbox output locations.
function findRkPlainFolder(projectRoot) {
    if (!projectRoot || !path.isAbsolute(projectRoot)) return null;
    try {
        const role = discoverProject(projectRoot).roles.rkplain;
        return role?.status === "ready" && role.folderPath ? role.folderPath : null;
    } catch (_) { return null; }
}

function rkPlainName(id) {
    if (validId(id)) throw new Error(`Invalid RK Plain product ID: ${id}`);
    return `${id.toLowerCase()}plain.jpg`;
}

async function exportRkPlain(items, outputFolder, confirmedExisting = [], protectedPaths = []) {
    const { folder, marker } = validatedRkPlainFolder(outputFolder);
    const protectedNames = new Set([normalized(marker)]);
    for (const source of protectedPaths) {
        if (!source) continue;
        protectedNames.add(normalized(source));
        try { protectedNames.add(await canonicalPath(source)); } catch (_) {}
    }
    const unique = new Set();
    const existing = [];
    const pairs = [];
    for (const item of items) {
        if (!item?.jpg || !path.isAbsolute(item.jpg)) throw new Error("RK Plain source JPEG is invalid.");
        const name = rkPlainName(item.id);
        const key = name.toLowerCase();
        if (unique.has(key)) throw new Error(`RK Plain output filename collision: ${name}`);
        unique.add(key);
        const target = path.join(folder, name);
        const canonical = await canonicalPath(target);
        if (protectedNames.has(normalized(target)) || protectedNames.has(canonical)) {
            throw new Error(`RK Plain ${name} would overwrite a source or PLAIN.psd marker.`);
        }
        const stat = await fs.promises.lstat(target).catch(error => {
            if (error.code === "ENOENT") return null;
            throw error;
        });
        if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error(`RK Plain ${name} is not a regular file.`);
        if (stat) existing.push(name);
        pairs.push({ staged: item.jpg, name });
    }
    if (existing.some(name => !confirmedExisting.some(approved => approved.toLowerCase() === name.toLowerCase()))) {
        return { ok: false, existing, requiresApproval: true, folder, saved: [] };
    }
    if (!pairs.length) return { ok: true, existing, saved: [], folder };
    const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), "amazon-rk-plain-"));
    try {
        const saved = await publishGroup(pairs, { outputFolder: folder,
            backupFolder: path.join(work, "backups"), confirmedExistingPaths: confirmedExisting });
        return { ok: true, saved, existing, folder };
    } finally { await fs.promises.rm(work, { recursive: true, force: true }).catch(() => {}); }
}

module.exports = { verifyCreativeImage, withAssignedMains, withCreativeSecond, plainMarker, validatedRkPlainFolder,
    findRkPlainFolder, rkPlainName, exportRkPlain };
