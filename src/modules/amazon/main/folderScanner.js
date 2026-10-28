const fs = require("fs");
const path = require("path");

const SUPPORTED_EXTENSIONS = new Set([
    ".psd", ".psb", ".jpg", ".jpeg", ".png", ".webp",
    ".tif", ".tiff", ".bmp", ".gif", ".heic", ".heif", ".avif"
]);

function sourceTypeFromExtension(extension) {
    const ext = String(extension || "").trim().toLowerCase();
    if (ext === ".psd" || ext === ".psb") return "psd";
    if (ext === ".png") return "png";
    if (ext === ".jpg" || ext === ".jpeg") return "jpg";
    if (ext === ".webp") return "webp";
    return "other";
}

function naturalSort(a, b) {
    return String(a).localeCompare(String(b), undefined, {
        numeric: true,
        sensitivity: "base"
    });
}

function exactSlotFromName(filename) {
    const parsed = path.parse(filename);
    const base = String(parsed.name || "").trim();
    if (!/^[1-8]$/.test(base)) return null;
    return Number(base);
}

function fileRecord(folderPath, entry) {
    const fullPath = path.join(folderPath, entry.name);
    let size = null;
    let modifiedMs = null;

    try {
        const stat = fs.statSync(fullPath);
        size = stat.size;
        modifiedMs = stat.mtimeMs;
    } catch (error) {}

    return {
        name: entry.name,
        path: fullPath,
        extension: path.extname(entry.name).toLowerCase(),
        sourceType: sourceTypeFromExtension(path.extname(entry.name)),
        slot: exactSlotFromName(entry.name),
        size,
        modifiedMs
    };
}

function scanVariantFolder(folderPath) {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });

    // STRICT AMAZON SOURCE RULE:
    // Only exact filenames 1 through 8 are candidates. Everything else in the
    // variant folder is ignored by the Amazon UI / Check All workflow.
    const scannedFiles = entries
        .filter(entry => {
            if (!entry.isFile()) return false;
            if (!exactSlotFromName(entry.name)) return false;
            return SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase());
        })
        .map(entry => fileRecord(folderPath, entry))
        .sort((a, b) => a.slot - b.slot || naturalSort(a.name, b.name));

    // Treat duplicate slot basenames (for example 1.psd + 1.jpg) as separate
    // candidates so the UI can show them instead of silently picking one.
    const files = scannedFiles;
    const ignoredFiles = entries
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .filter(name => !files.some(file => file.name === name));

    return {
        id: path.basename(folderPath),
        folderPath,
        files,
        ignoredFiles,
        totalFiles: files.length,
        status: files.length > 0 ? "ready" : "empty"
    };
}

function scanParentFolder(parentFolder) {
    const entries = fs.readdirSync(parentFolder, { withFileTypes: true });

    let variants = entries
        .filter(entry => entry.isDirectory())
        .sort((a, b) => naturalSort(a.name, b.name))
        .map(entry => scanVariantFolder(path.join(parentFolder, entry.name)));

    // Same convenience fallback as the previous Amazon app: if the selected
    // folder itself contains exact 1-8 files and no variant subfolders, treat
    // the selected folder as a single Variant ID.
    if (variants.length === 0) {
        const selfVariant = scanVariantFolder(parentFolder);
        if (selfVariant.files.length > 0) variants = [selfVariant];
    }

    return {
        id: path.basename(parentFolder),
        folderPath: parentFolder,
        variants,
        totalVariants: variants.length,
        variantsWithFiles: variants.filter(v => v.files.length > 0).length,
        emptyVariants: variants.filter(v => v.files.length === 0).length
    };
}

module.exports = {
    SUPPORTED_EXTENSIONS,
    naturalSort,
    exactSlotFromName,
    sourceTypeFromExtension,
    scanVariantFolder,
    scanParentFolder
};
