"use strict";
// Pure layout/order operations used by Slider Maker and Slider -> Combine review.
// A variation is one indivisible photo + color caption + shadow setting.
(function (root, build) {
    const api = build();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.BrandForgeSliderDnD = api;
})(typeof window !== "undefined" ? window : null, function () {
    function slotCount(layoutMode) { return layoutMode === "fourCut" ? 4 : 2; }
    function validSlot(row, n, mode) {
        return row && Number.isInteger(n) && n >= 1 && n <= slotCount(mode);
    }
    function variation(row, n) {
        return { photo: row[`photo${n}`] || null,
            variant: String(row[`variant${n}`] || ""), shadow: Boolean(row[`shadow${n}`]) };
    }
    function writeVariation(row, n, item) {
        row[`photo${n}`] = item.photo;
        row[`variant${n}`] = item.variant;
        row[`shadow${n}`] = item.shadow;
    }
    function moveVariation(rows, fromRow, fromSlot, toRow, toSlot, layoutMode) {
        // PA Vertical is an item/detail pair rather than independent colors.
        if (layoutMode === "paVertical") return false;
        if (!Array.isArray(rows) || !validSlot(rows[fromRow], fromSlot, layoutMode) ||
            !validSlot(rows[toRow], toSlot, layoutMode)) return false;
        if (fromRow === toRow && fromSlot === toSlot) return false;
        const origin = variation(rows[fromRow], fromSlot);
        if (!origin.photo && !origin.variant) return false;
        const target = variation(rows[toRow], toSlot);
        writeVariation(rows[toRow], toSlot, origin);
        writeVariation(rows[fromRow], fromSlot, target);
        return true;
    }
    function moveCard(rows, from, to) {
        if (!Array.isArray(rows) || !Number.isInteger(from) || !Number.isInteger(to) ||
            from < 0 || to < 0 || from >= rows.length || to >= rows.length || from === to) return false;
        rows.splice(to, 0, rows.splice(from, 1)[0]);
        return true;
    }
    function insertDroppedPhotos(rows, photos, { layoutMode, startRow = 0, startSlot = 1, makeRow }) {
        if (!Array.isArray(rows) || !Array.isArray(photos) || typeof makeRow !== "function")
            throw new Error("Invalid Line Up drop request.");
        const count = slotCount(layoutMode);
        let index = Math.max(0, startRow) * count + Math.max(0, Math.min(count - 1, startSlot - 1));
        let inserted = 0;
        for (const file of photos) {
            if (!file || !file.path) continue;
            while (true) {
                const rowIndex = Math.floor(index / count);
                const n = index % count + 1;
                while (rows.length <= rowIndex) rows.push(makeRow());
                if (!rows[rowIndex][`photo${n}`] && !String(rows[rowIndex][`variant${n}`] || "").trim()) {
                    rows[rowIndex][`photo${n}`] = file;
                    inserted++;
                    index++;
                    break;
                }
                index++;
            }
        }
        return inserted;
    }
    function moveReviewedItem(items, itemId, section, beforeId = null) {
        if (!Array.isArray(items) || !["lineup", "details"].includes(section)) return false;
        const sourceIndex = items.findIndex(item => item.id === itemId);
        if (sourceIndex < 0 || itemId === beforeId) return false;
        const item = items.splice(sourceIndex, 1)[0];
        item.section = section;
        const groups = {
            lineup: items.filter(x => x.section === "lineup"),
            details: items.filter(x => x.section === "details")
        };
        const dest = groups[section];
        const destIndex = beforeId ? dest.findIndex(x => x.id === beforeId) : -1;
        dest.splice(destIndex < 0 ? dest.length : destIndex, 0, item);
        items.splice(0, items.length, ...groups.lineup, ...groups.details);
        return true;
    }
    return { slotCount, moveVariation, moveCard, insertDroppedPhotos, moveReviewedItem };
});
