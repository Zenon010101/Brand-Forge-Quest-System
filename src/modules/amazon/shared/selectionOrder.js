/* Preserve the order in which the designer clicks source images.
 * A Set alone loses the intentional pick sequence when assigning from a
 * differently ordered Image Library. This tiny helper is also unit tested. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.BrandForgeSelectionOrder = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    function createOrderedSelection(maximum = 8) {
        if (!Number.isInteger(maximum) || maximum < 1) throw new Error("Invalid selection limit.");
        const keys = [];
        return {
            toggle(key) {
                if (typeof key !== "string" || !key) return { ok: false, error: "Invalid image." };
                const index = keys.indexOf(key);
                if (index >= 0) {
                    keys.splice(index, 1);
                    return { ok: true, selected: false };
                }
                if (keys.length >= maximum) return { ok: false, error: `Select at most ${maximum} images per product.` };
                keys.push(key);
                return { ok: true, selected: true, position: keys.length };
            },
            has: key => keys.includes(key),
            position: key => { const index = keys.indexOf(key); return index < 0 ? 0 : index + 1; },
            values: () => [...keys],
            clear: () => { keys.length = 0; },
            prune: allowed => {
                for (let i = keys.length - 1; i >= 0; i--) if (!allowed.has(keys[i])) keys.splice(i, 1);
            },
            get size() { return keys.length; },
            get maximum() { return maximum; }
        };
    }
    return { createOrderedSelection };
});
