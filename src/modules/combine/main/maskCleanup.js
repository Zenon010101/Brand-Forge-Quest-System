"use strict";
// Pixel-precise selection mask for Combine text cleanup. Brush/eraser strokes
// edit the MASK, never the original image. No new product details are generated.
const MAX_STROKES = 220;
const MAX_POINTS = 12000;
const MAX_SELECTED_FRACTION = 0.45;

function normalizeStrokes(strokes, width, height) {
    if (strokes == null) return [];
    if (!Array.isArray(strokes) || strokes.length > MAX_STROKES) {
        throw new Error(`Use at most ${MAX_STROKES} brush/eraser strokes per image.`);
    }
    let total = 0;
    return strokes.map((stroke, index) => {
        if (!stroke || !["add", "erase"].includes(stroke.mode)) {
            throw new Error(`Invalid brush/eraser mode at stroke ${index + 1}.`);
        }
        const size = Number(stroke.size);
        if (!Number.isFinite(size) || size < 2 || size > 600) {
            throw new Error(`Invalid brush diameter at stroke ${index + 1}.`);
        }
        if (!Array.isArray(stroke.points) || !stroke.points.length || stroke.points.length > 2000) {
            throw new Error(`Invalid brush points at stroke ${index + 1}.`);
        }
        total += stroke.points.length;
        if (total > MAX_POINTS) throw new Error("Too many brush points. Use fewer, shorter strokes.");
        const points = stroke.points.map((p, i) => {
            if (!Array.isArray(p) || p.length !== 2) throw new Error(`Invalid point ${i + 1} in stroke ${index + 1}.`);
            const x = Number(p[0]), y = Number(p[1]);
            if (!Number.isFinite(x) || !Number.isFinite(y) || x < -1 || y < -1 || x > width + 1 || y > height + 1) {
                throw new Error(`Brush point out of bounds at stroke ${index + 1}.`);
            }
            return [Math.max(0, Math.min(width - 1, x)), Math.max(0, Math.min(height - 1, y))];
        });
        return { mode: stroke.mode, size, points };
    });
}
function paintCircle(mask, width, height, cx, cy, radius, value) {
    const left = Math.max(0, Math.floor(cx - radius));
    const right = Math.min(width - 1, Math.ceil(cx + radius));
    const top = Math.max(0, Math.floor(cy - radius));
    const bottom = Math.min(height - 1, Math.ceil(cy + radius));
    const sq = radius * radius;
    for (let y = top; y <= bottom; y++) {
        const dy = (y + 0.5) - cy, row = y * width;
        for (let x = left; x <= right; x++) {
            const dx = (x + 0.5) - cx;
            if (dx * dx + dy * dy <= sq) mask[row + x] = value;
        }
    }
}
function createSelectionMask(width, height, areas, strokes) {
    const mask = new Uint8Array(width * height);
    // sourceGuard never admits protected eraser holes as background samples.
    // A mask hole might be a logo, product edge, or still-visible text.
    const sourceGuard = new Uint8Array(width * height);
    for (const area of areas) {
        for (let y = area.y; y < area.y + area.height; y++) {
            const start = y * width + area.x, end = start + area.width;
            mask.fill(1, start, end);
            sourceGuard.fill(1, start, end);
        }
    }
    for (const stroke of strokes) {
        const radius = stroke.size / 2, value = stroke.mode === "add" ? 1 : 0;
        let previous = null;
        for (const p of stroke.points) {
            if (previous) {
                const distance = Math.hypot(p[0] - previous[0], p[1] - previous[1]);
                const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.45)));
                for (let j = 1; j <= steps; j++) {
                    const fraction = j / steps;
                    const x = previous[0] + (p[0] - previous[0]) * fraction;
                    const y = previous[1] + (p[1] - previous[1]) * fraction;
                    paintCircle(mask, width, height, x, y, radius, value);
                    if (value) paintCircle(sourceGuard, width, height, x, y, radius, 1);
                }
            } else {
                paintCircle(mask, width, height, p[0], p[1], radius, value);
                if (value) paintCircle(sourceGuard, width, height, p[0], p[1], radius, 1);
            }
            previous = p;
        }
    }
    let selected = 0;
    for (let i = 0; i < mask.length; i++) selected += mask[i];
    if (!selected) throw new Error("No pixels are selected. Brush over the text or approve a text region.");
    if (selected > width * height * MAX_SELECTED_FRACTION) {
        throw new Error("The text mask covers too much of the image. Reduce the selection to caption pixels.");
    }
    return { mask, sourceGuard, selected };
}
// Clean Fill interpolates nearby UNSELECTED source colors. Unlike Content-
// Aware, it neither copies another product region nor invents texture.
// It never writes outside the final mask (including eraser cutouts).
function cleanFillPixels(original, width, height, mask, feather = 0, sourceGuard = mask) {
    const result = Buffer.from(original);
    const maxReach = 180;
    let complex = 0;
    let changed = 0;
    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            const pixel = row + x;
            if (!mask[pixel]) continue;
            const neighbors = [];
            let closest = Infinity;
            // Search source pixels only, and stop at the first unmasked pixel.
            for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                for (let d = 1; d <= maxReach; d++) {
                    const sx = x + dx * d, sy = y + dy * d;
                    if (sx < 0 || sx >= width || sy < 0 || sy >= height) break;
                    const offset = sy * width + sx;
                    if (sourceGuard[offset]) continue;
                    const raw = offset * 4;
                    if (original[raw + 3] < 50) continue;
                    neighbors.push({ offset: raw, distance: d, dx, dy });
                    closest = Math.min(closest, d);
                    break;
                }
            }
            if (!neighbors.length) continue; // leave uncertain pixels untouched
            const src = pixel * 4;
            let weights = 0;
            const colors = [0, 0, 0];
            const minValues = [255, 255, 255], maxValues = [0, 0, 0];
            for (const neighbor of neighbors) {
                const weight = 1 / Math.max(1, neighbor.distance);
                weights += weight;
                for (let c = 0; c < 3; c++) {
                    const value = original[neighbor.offset + c];
                    colors[c] += value * weight;
                    minValues[c] = Math.min(minValues[c], value);
                    maxValues[c] = Math.max(maxValues[c], value);
                }
            }
            if (neighbors.length >= 2 && maxValues.some((value, c) => value - minValues[c] > 70)) complex++;
            const alpha = feather > 0 ? Math.min(1, closest / (feather + 1)) : 1;
            for (let c = 0; c < 3; c++) {
                const fill = Math.round(colors[c] / weights);
                result[src + c] = Math.round(fill * alpha + original[src + c] * (1 - alpha));
            }
            changed++;
            // Original alpha is preserved, as are ALL bytes outside the mask.
        }
    }
    const warnings = [];
    if (complex > Math.max(60, changed * 0.02)) {
        warnings.push("Selected text lies on a varied background. Clean Fill will not invent texture; review the preview and refine the selection if needed.");
    }
    if (changed === 0) warnings.push("Some selected pixels could not be matched to a nearby background; refine your selection.");
    return { result, methods: ["Clean Fill (selected pixels only)"], warnings, changed };
}
module.exports = { normalizeStrokes, createSelectionMask, cleanFillPixels };
