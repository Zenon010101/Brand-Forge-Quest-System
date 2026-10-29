/* Shared Amazon image-format filters for folder scanning and library preview.
 * No Photoshop conversion or source image modification occurs here. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.BrandForgeImageFilters = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const filters = Object.freeze([
        { value: "all", label: "All supported images", extensions: [".psd", ".psb", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp", ".gif", ".heic", ".heif", ".avif"] },
        { value: "psd", label: "PSD only", extensions: [".psd"] },
        { value: "psb", label: "PSB only", extensions: [".psb"] },
        { value: "png", label: "PNG only", extensions: [".png"] },
        { value: "jpg", label: "JPG / JPEG", extensions: [".jpg", ".jpeg"] },
        { value: "webp", label: "WEBP only", extensions: [".webp"] },
        { value: "tiff", label: "TIF / TIFF", extensions: [".tif", ".tiff"] },
        { value: "bmp", label: "BMP only", extensions: [".bmp"] },
        { value: "gif", label: "GIF only", extensions: [".gif"] },
        { value: "heic", label: "HEIC / HEIF", extensions: [".heic", ".heif"] },
        { value: "avif", label: "AVIF only", extensions: [".avif"] }
    ]);
    function findFilter(value) {
        return filters.find(item => item.value === String(value || "all").toLowerCase()) || null;
    }
    function matchesExtension(extension, filterName) {
        const filter = findFilter(filterName);
        if (!filter) return false;
        return filter.extensions.includes(String(extension || "").toLowerCase());
    }
    function matchesFile(file, filterName) {
        return matchesExtension(file && file.extension, filterName);
    }
    return { filters, findFilter, matchesExtension, matchesFile };
});
