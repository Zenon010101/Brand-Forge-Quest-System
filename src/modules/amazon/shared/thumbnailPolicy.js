/* Background thumbnails must NEVER invoke Photoshop. Explicit clicks still use
 * the normal PSD preview/fast-cache pipeline. */
(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root && typeof root === "object") root.BrandForgeAmazonThumbnailPolicy = api;
})(typeof window !== "undefined" ? window : null, function () {
    "use strict";
    const allowed = new Set([".jpg", ".jpeg", ".png", ".webp"]);
    function canBackgroundPreview(value) {
        const input = String(value?.extension || value || "").toLowerCase();
        const extension = input.match(/\.[^.\\/]+$/)?.[0] || "";
        return allowed.has(extension);
    }
    return { canBackgroundPreview };
});
