"use strict";

// Folderless Amazon input adapter.  All image rendering, PSD, sharing and
// Colorbox still use the existing Amazon engine; this module only creates a
// validated virtual parent from explicitly assigned image paths.
const fs = require("fs");
const path = require("path");
const { SUPPORTED_EXTENSIONS, sourceTypeFromExtension } = require("./folderScanner");
const { buildSharingPlan, validId, idKey } = require("../shared/sharingPlan");

const MAX_GROUPS = 500;
const MAX_POOL_FILES = 2500;

async function readImageRecords(paths) {
    if (!Array.isArray(paths) || paths.length > MAX_POOL_FILES) {
        throw new Error(`Select no more than ${MAX_POOL_FILES} images at a time.`);
    }
    const files = [];
    const errors = [];
    const seen = new Set();
    for (const candidate of paths) {
        const input = String(candidate || "");
        if (!path.isAbsolute(input)) {
            errors.push(`${input || "(empty)"}: not an absolute file path.`);
            continue;
        }
        const extension = path.extname(input).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(extension)) {
            errors.push(`${path.basename(input)}: unsupported image format.`);
            continue;
        }
        try {
            const stat = await fs.promises.stat(input);
            if (!stat.isFile() || !stat.size) throw new Error("not a non-empty file");
            const real = await fs.promises.realpath(input);
            const key = path.normalize(real).toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            files.push({
                path: input,
                name: path.basename(input),
                extension,
                sourceType: sourceTypeFromExtension(extension),
                size: stat.size,
                modifiedMs: stat.mtimeMs
            });
        } catch (error) {
            errors.push(`${path.basename(input)}: ${error.message || String(error)}`);
        }
    }
    return { files, errors };
}

async function validateVirtualBatch(payload) {
    const errors = [];
    const groups = payload?.groups;
    if (!Array.isArray(groups) || groups.length === 0) {
        return { ok: false, errors: ["Add at least one product group with images."] };
    }
    if (groups.length > MAX_GROUPS) {
        return { ok: false, errors: [`Maximum ${MAX_GROUPS} product groups per batch.`] };
    }
    const variants = [];
    const seenGroups = new Set();
    for (let index = 0; index < groups.length; index++) {
        const raw = groups[index] || {};
        const label = String(raw.id || `Product ${index + 1}`);
        const id = String(raw.id || "").trim();
        const reason = validId(id);
        if (reason) errors.push(`${label}: ${reason}`);
        if (seenGroups.has(idKey(id))) errors.push(`${label}: duplicate product ID.`);
        seenGroups.add(idKey(id));
        const filePaths = Array.isArray(raw.files) ? raw.files : [];
        if (!filePaths.length || filePaths.length > 8) {
            errors.push(`${label}: assign 1 to 8 images (currently ${filePaths.length}).`);
        }
        const sharedIds = Array.isArray(raw.sharedIds) ? raw.sharedIds : [];
        if (!Array.isArray(raw.sharedIds) && raw.sharedIds !== undefined) {
            errors.push(`${label}: shared IDs must be an array.`);
        }
        const withinGroup = new Set();
        const files = [];
        for (const entry of filePaths.slice(0, 8)) {
            const filePath = typeof entry === "string" ? entry : entry?.path;
            if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
                errors.push(`${label}: invalid image path.`);
                continue;
            }
            const key = path.normalize(filePath).toLowerCase();
            if (withinGroup.has(key)) {
                errors.push(`${label}: same source image assigned more than once.`);
                continue;
            }
            withinGroup.add(key);
            const extension = path.extname(filePath).toLowerCase();
            if (!SUPPORTED_EXTENSIONS.has(extension)) {
                errors.push(`${label}: unsupported source image ${path.basename(filePath)}.`);
                continue;
            }
            try {
                const stat = await fs.promises.stat(filePath);
                if (!stat.isFile() || !stat.size) throw new Error("image file is empty or unavailable");
                files.push({ path: filePath, name: path.basename(filePath), extension,
                    sourceType: sourceTypeFromExtension(extension) });
            } catch (error) {
                errors.push(`${label}: ${path.basename(filePath)}: ${error.message || String(error)}`);
            }
        }
        if (!Array.isArray(sharedIds) || sharedIds.some(id => typeof id !== "string")) {
            errors.push(`${label}: invalid shared IDs.`);
        }
        variants.push({ id, files, sharedIds: Array.isArray(sharedIds) ? sharedIds : [] });
    }
    const parents = [{ id: "Batch Workspace", folderPath: null, variants }];
    const plan = buildSharingPlan(parents);
    errors.push(...plan.errors);
    // No implicit dropping of empty/invalid products.  The regular sharing
    // planner skips empty variants because Folder Mode allows unchecked IDs.
    if (plan.sourceCount !== groups.length) errors.push("Every batch product must have a valid image set.");
    return { ok: errors.length === 0, errors: [...new Set(errors)], parents, plan };
}

module.exports = { readImageRecords, validateVirtualBatch, MAX_GROUPS, MAX_POOL_FILES };
