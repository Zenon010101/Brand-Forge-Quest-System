"use strict";

// Read-only PSD marker discovery. This module NEVER opens a PSD in Photoshop,
// creates an image, or writes to the linked G: brand project.
const fs = require("fs");
const path = require("path");
const ROLES = ["amazon", "slider", "colorbox"];
const MARKER_EXTS = new Set([".psd", ".psb"]);
const MAX_SCAN_DIRS = 30;

function pathKey(value) {
    return path.resolve(String(value || "")).replace(/\\/g, "/").toLowerCase();
}
function beneath(candidate, root) {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
}
function readEntries(folder) {
    return fs.readdirSync(folder, { withFileTypes: true });
}
function actualChild(folder, target) {
    try {
        const entry = readEntries(folder).find(e => e.isDirectory() && e.name.toLowerCase() === target.toLowerCase());
        return entry ? path.join(folder, entry.name) : null;
    } catch (error) { return null; }
}
function markerFiles(folder) {
    return readEntries(folder).filter(e => e.isFile() && MARKER_EXTS.has(path.extname(e.name).toLowerCase()))
        .map(e => path.join(folder, e.name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
// Folder names in the production Shared Drive are not always equal to the
// module labels. Normalize punctuation so 'AMAZON [single and slider]' and
// 'AMAZON (single & slider)' both resolve, without scanning unrelated folders.
function normalizedFolderName(value) {
    return String(value || "").toLowerCase().replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function matchingFolders(parent, normalizedName) {
    if (!parent) return [];
    try {
        return readEntries(parent)
            .filter(e => e.isDirectory() && normalizedFolderName(e.name) === normalizedName)
            .map(e => path.join(parent, e.name));
    } catch (error) { return []; }
}
function candidate(folder, priority) {
    return folder ? { folder, priority } : null;
}
function proposedMarkers(root) {
    const slider = actualChild(root, "SLIDER");
    const colorbox = actualChild(root, "COLORBOX");
    const directAmazon = actualChild(root, "AMAZON");
    const legacyAmazon = slider && actualChild(slider, "AMAZON");

    // Actual team structure:
    //   <brand>/SLIDER/AMAZON [single and slider]/Amazon Template.psd
    //   <brand>/SLIDER/SLIDER-IMAGES/psd/Slider Template.psd
    //   <brand>/COLORBOX/Colorbox Template.psd
    // 'code' beside 'psd' is deliberately NOT an output directory.
    const preferredAmazonFolders = matchingFolders(slider, "amazon single and slider");
    const nestedAmazon = legacyAmazon && actualChild(legacyAmazon, "single and slider");
    const sliderImageFolders = matchingFolders(slider, "slider images");
    const sliderPsdFolders = sliderImageFolders.map(folder => actualChild(folder, "psd")).filter(Boolean);
    return {
        colorbox: [candidate(colorbox, 0)].filter(Boolean),
        slider: [
            ...sliderPsdFolders.map(folder => candidate(folder, 0)),
            candidate(slider, 1) // Legacy project layout only.
        ].filter(Boolean),
        amazon: [
            ...preferredAmazonFolders.map(folder => candidate(folder, 0)),
            candidate(nestedAmazon, 0),
            candidate(legacyAmazon, 1),
            candidate(directAmazon, 1) // Legacy project layout only.
        ].filter(Boolean)
    };
}
function isTemplateLike(filePath) {
    return /(?:^|[ _.-])template(?:[ _.-]|$)/i.test(path.basename(filePath, path.extname(filePath))) ||
        /template/i.test(path.basename(filePath));
}
function validateRoot(root) {
    if (!root || !path.isAbsolute(root)) throw new Error("Select an absolute Google Drive brand/project folder.");
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) throw new Error("The selected project path is not a folder.");
    const resolved = fs.realpathSync(root);
    return resolved;
}
function discoverProject(rootInput) {
    const root = validateRoot(rootInput);
    const candidates = proposedMarkers(root);
    const result = { root, name: path.basename(root), roles: {}, warnings: [] };
    for (const role of ROLES) {
        const choices = [];
        const seen = new Set();
        for (const entry of candidates[role].slice(0, MAX_SCAN_DIRS)) {
            // A folder appears only once, with its highest (most specific)
            // priority. Never follow arbitrary recursive PSD directories.
            const folderKey = pathKey(entry.folder);
            if (seen.has(folderKey)) continue;
            seen.add(folderKey);
            for (const marker of markerFiles(entry.folder)) {
                const realMarker = fs.realpathSync(marker);
                if (!beneath(realMarker, root)) continue;
                choices.push({ markerPath: realMarker, folderPath: path.dirname(realMarker),
                    label: path.relative(root, realMarker), priority: entry.priority });
            }
        }
        // Prefer a verified marker in the explicit nested production folders.
        // Legacy paths remain selectable, but never override the proper
        // nested path when both have PSDs. Multiple markers at the same
        // priority still require confirmation unless just one is a template.
        const bestPriority = choices.length ? Math.min(...choices.map(x => x.priority)) : Infinity;
        const current = choices.filter(x => x.priority === bestPriority);
        const preferred = current.filter(x => isTemplateLike(x.markerPath));
        const uniqueFolders = new Set(current.map(x => pathKey(x.folderPath)));
        const automatic = uniqueFolders.size > 1 ? null :
            preferred.length === 1 ? preferred[0] : current.length === 1 ? current[0] : null;
        let status = automatic ? "ready" : choices.length ? "ambiguous" : "missing";
        if (status === "ambiguous") result.warnings.push(`${role.toUpperCase()}: several PSD markers found; select the correct one.`);
        if (status === "missing") result.warnings.push(`${role.toUpperCase()}: no PSD marker in the expected folder. Choose output manually.`);
        result.roles[role] = { status, choices, selectedMarker: automatic?.markerPath || null, folderPath: automatic?.folderPath || null };
    }
    return result;
}
function resolveSelections(root, selectedMarkers) {
    const discovered = discoverProject(root);
    const selected = {};
    for (const role of ROLES) {
        const chosen = String(selectedMarkers?.[role] || "");
        if (!chosen) { selected[role] = null; continue; }
        const match = discovered.roles[role].choices.find(item => pathKey(item.markerPath) === pathKey(chosen));
        if (!match) throw new Error(`${role.toUpperCase()} PSD marker is no longer in the selected project. Rescan the brand folder.`);
        // Reverify canonical paths now, to reject moved files and junction escapes.
        const canonical = fs.realpathSync(match.markerPath);
        if (!beneath(canonical, discovered.root)) throw new Error("PSD marker is outside the selected project root.");
        selected[role] = { markerPath: canonical, folderPath: path.dirname(canonical) };
    }
    if (!ROLES.some(role => selected[role])) throw new Error("No valid PSD marker selected. Choose a valid brand project or use manual output folders.");
    return { root: discovered.root, name: discovered.name, roles: selected, locationLayoutVersion: 2 };
}
function assertMarkerSafe(link, role, targetFilePath) {
    if (!link || !link.roles?.[role]) return;
    const marker = link.roles[role];
    if (pathKey(targetFilePath) === pathKey(marker.markerPath)) {
        throw new Error(`Cannot overwrite the ${role.toUpperCase()} PSD template/marker: ${path.basename(marker.markerPath)}. Use a different output filename.`);
    }
}
function verifyLinkedProject(link) {
    if (!link?.root) throw new Error("No linked Google Drive project is set.");
    // A v1.7.16 link may have selected a broad SLIDER or AMAZON folder.
    // If the correct nested production layout is now detected, demand a
    // one-time re-link instead of quietly publishing to an old directory.
    if (link.locationLayoutVersion !== 2) {
        const found = discoverProject(link.root);
        for (const role of ["amazon", "slider"]) {
            const saved = link.roles?.[role]?.markerPath;
            const preferred = found.roles[role]?.selectedMarker;
            const savedChoice = found.roles[role]?.choices.find(choice => pathKey(choice.markerPath) === pathKey(saved));
            const preferredChoice = found.roles[role]?.choices.find(choice => pathKey(choice.markerPath) === pathKey(preferred));
            if (saved && savedChoice?.priority > 0 && preferredChoice?.priority === 0) {
                throw new Error(`Saved ${role.toUpperCase()} path uses an old layout. Click Detect Folders and Use Detected Paths to link the correct nested location.`);
            }
        }
    }
    return resolveSelections(link.root, Object.fromEntries(ROLES.map(role => [role, link.roles?.[role]?.markerPath || ""])));
}
module.exports = { ROLES, pathKey, beneath, discoverProject, resolveSelections, verifyLinkedProject, assertMarkerSafe };
