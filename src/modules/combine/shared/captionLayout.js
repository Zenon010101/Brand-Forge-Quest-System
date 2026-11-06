"use strict";

// The source image is kept intact for a vertical (TOP/BOTTOM) Line Up block.
// These positions refer to the TOP edge of the old printed captions as a
// fraction of the original source canvas, not to the product bounding box.
const DEFAULT_VERTICAL = Object.freeze({ topY: 0.44, bottomY: 0.925 });

function verticalPositions(top, bottom) {
    const first = top == null || top === "" ? DEFAULT_VERTICAL.topY : Number(top);
    const second = bottom == null || bottom === "" ? DEFAULT_VERTICAL.bottomY : Number(bottom);
    if (![first, second].every(Number.isFinite) || first < 0.05 || first > 0.85 ||
        second < 0.15 || second > 0.99 || second - first < 0.08) {
        throw new Error("TOP and BOTTOM caption positions must be 5–85% and 15–99%, with at least 8% separation.");
    }
    return { topY: first, bottomY: second };
}

// Only classify a pair when there is unambiguous spatial evidence. OCR text
// from a logo or a long line is NOT enough to change an image's layout mode.
function detectedCaptionLayout(captions, width, height) {
    const w = Number(width), h = Number(height);
    if (!(w > 0 && h > 0) || !Array.isArray(captions)) return null;
    const pair = captions.filter(c => c && String(c.text || "").trim() &&
        [c.x, c.y].every(v => Number.isFinite(Number(v))));
    if (pair.length !== 2) return null;
    const middleX = c => Number(c.x) + (Number(c.width) || 0) / 2;
    const middleY = c => Number(c.y) + (Number(c.height) || 0) / 2;
    const dx = Math.abs(middleX(pair[0]) - middleX(pair[1]));
    const dy = Math.abs(middleY(pair[0]) - middleY(pair[1]));
    if (dy >= h * 0.18 && dy > dx * 0.7) {
        const [top, bottom] = [...pair].sort((a, b) => Number(a.y) - Number(b.y));
        try {
            const positions = verticalPositions(Number(top.y) / h, Number(bottom.y) / h);
            return { mode: "vertical", first: String(top.text).trim(), second: String(bottom.text).trim(), ...positions };
        } catch (_) { return null; }
    }
    if (dx >= w * 0.20 && dx > dy * 0.7) {
        const [left, right] = [...pair].sort((a, b) => middleX(a) - middleX(b));
        return { mode: "dual", first: String(left.text).trim(), second: String(right.text).trim() };
    }
    return null;
}

// Build a suggested Line Up entry from text the user selected for removal.
// Keep the result editable; OCR and orientation can be wrong on difficult art.
function normalizedCaptionName(value) {
    return String(value || "").trim().replace(/^[0-9０-９]{1,2}[.．、)）]\s*/, "").trim();
}
function capturedCaptionSuggestion(captions, width, height, choice = "auto") {
    const entries = (captions || []).map(item => ({ ...item, text: normalizedCaptionName(item?.text) }))
        .filter(item => item.text);
    if (!entries.length) return null;
    if (choice === "single" || (choice === "auto" && entries.length === 1)) {
        return { mode: "single", first: entries[0].text, second: "" };
    }
    if (choice === "auto" && entries.length === 2) {
        const inferred = detectedCaptionLayout(entries, width, height);
        if (inferred) return { ...inferred, first: normalizedCaptionName(inferred.first),
            second: normalizedCaptionName(inferred.second) };
    }
    if (choice === "vertical") {
        const sorted = [...entries].sort((a,b) => Number(a.y || 0) - Number(b.y || 0));
        const top = Number(sorted[0]?.y) / Number(height);
        const bottom = Number(sorted[1]?.y) / Number(height);
        let positions;
        try { positions = verticalPositions(top, bottom); }
        catch (_) { positions = { ...DEFAULT_VERTICAL }; }
        return { mode: "vertical", first: sorted[0]?.text || "", second: sorted[1]?.text || "",
            ...positions };
    }
    if (choice === "dual") {
        const sorted = [...entries].sort((a,b) => Number(a.x || 0) - Number(b.x || 0));
        return { mode: "dual", first: sorted[0]?.text || "", second: sorted[1]?.text || "" };
    }
    // Two captions without clear spatial separation should not silently be
    // classified as LEFT/RIGHT or TOP/BOTTOM. The UI displays both for review.
    return { mode: "single", first: entries[0].text, second: entries[1]?.text || "",
        review: entries.length > 1 };
}
const exported = { DEFAULT_VERTICAL, verticalPositions, detectedCaptionLayout,
    normalizedCaptionName, capturedCaptionSuggestion };
if (typeof module === "object" && module.exports) module.exports = exported;
if (typeof window !== "undefined") window.BrandForgeCaptionLayout = exported;
