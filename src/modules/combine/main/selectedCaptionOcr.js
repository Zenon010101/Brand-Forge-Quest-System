"use strict";

// Read the text INSIDE a user-approved removal mask, BEFORE cleaning the PNG.
// This OCR step never edits source pixels or guesses captions from unselected
// product logos. Previously detected OCR boxes are reused whenever possible;
// a missed manual rectangle or brush stroke gets a targeted OCR crop.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { createSelectionMask } = require("./maskCleanup");

const MAX_CAPTIONS = 16;
const MAX_CROPS = 12;
function clamp(n, low, high) { return Math.max(low, Math.min(high, n)); }
function rect(x, y, width, height, imageWidth, imageHeight) {
    const left = clamp(Math.floor(x), 0, imageWidth - 1);
    const top = clamp(Math.floor(y), 0, imageHeight - 1);
    return { x: left, y: top,
        width: Math.max(1, Math.min(imageWidth - left, Math.ceil(x + width) - left)),
        height: Math.max(1, Math.min(imageHeight - top, Math.ceil(y + height) - top)) };
}
function maskTouches(box, mask, width, height) {
    const b = rect(box.x, box.y, box.width, box.height, width, height);
    // A thin brush stroke may touch only a few letters. Probe densely, but
    // cap work for a large manually drawn rectangle.
    const step = Math.max(1, Math.floor(Math.max(b.width, b.height) / 180));
    let hits = 0, probes = 0;
    for (let y = b.y; y < b.y + b.height; y += step) {
        for (let x = b.x; x < b.x + b.width; x += step) {
            probes++;
            if (mask[y * width + x]) hits++;
        }
    }
    // A one-pixel boundary collision must not capture an unrelated logo.
    return hits >= Math.max(3, Math.ceil(probes * .012));
}
function overlaps(a, b, gap = 0) {
    return a.x <= b.x + b.width + gap && b.x <= a.x + a.width + gap &&
        a.y <= b.y + b.height + gap && b.y <= a.y + a.height + gap;
}
function mergeNearby(rectangles, width, height, gap = 14) {
    const items = rectangles.map(r => rect(r.x, r.y, r.width, r.height, width, height));
    let changed = true;
    while (changed) {
        changed = false;
        outer: for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
                if (!overlaps(items[i], items[j], gap)) continue;
                const a = items[i], b = items[j];
                items[i] = rect(Math.min(a.x, b.x), Math.min(a.y, b.y),
                    Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
                    Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y), width, height);
                items.splice(j, 1); changed = true; break outer;
            }
        }
    }
    return items;
}
function strokeBoxes(strokes, width, height) {
    return strokes.filter(s => s.mode === "add").map(s => {
        const xs = s.points.map(p => p[0]), ys = s.points.map(p => p[1]);
        const pad = s.size / 2;
        const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
        return rect(x, y, Math.max(...xs) - Math.min(...xs) + pad * 2,
            Math.max(...ys) - Math.min(...ys) + pad * 2, width, height);
    });
}
function validCaption(block, width, height) {
    if (!block || !String(block.text || "").trim()) return null;
    const nums = [block.x, block.y, block.width, block.height].map(Number);
    if (!nums.every(Number.isFinite) || nums[2] <= 0 || nums[3] <= 0) return null;
    const bounds = rect(...nums, width, height);
    return { text: String(block.text).trim().slice(0, 240), ...bounds,
        confidence: block.confidence == null ? null : Number(block.confidence),
        source: block.source || "OCR" };
}
function addUnique(list, candidate) {
    if (!candidate) return;
    // A focused crop may recognize the same caption as the earlier full scan.
    // Prefer the crop if it has higher confidence, without duplicating a name.
    const at = list.findIndex(c => overlaps(c, candidate, 2) &&
        Math.abs((c.x + c.width / 2) - (candidate.x + candidate.width / 2)) < Math.max(c.width, candidate.width) * .55 &&
        Math.abs((c.y + c.height / 2) - (candidate.y + candidate.height / 2)) < Math.max(c.height, candidate.height) * .65);
    if (at >= 0) {
        const old = list[at];
        if ((candidate.confidence ?? 0) > (old.confidence ?? 0)) list[at] = candidate;
    } else list.push(candidate);
}
async function captureSelectedCaptions({ filePath, width, height, areas = [], strokes = [], scanRegions = [], ocr }) {
    const { mask } = createSelectionMask(width, height, areas, strokes);
    const captured = [];
    const warnings = [];
    for (const region of scanRegions) {
        const caption = validCaption(region, width, height);
        if (caption && maskTouches(caption, mask, width, height)) addUnique(captured, { ...caption, source: "selected OCR" });
    }
    // OCR only selected areas. If the source scan already read text in an
    // approved area, reuse that text and don't repeat an expensive OCR process.
    const regions = mergeNearby([...areas, ...strokeBoxes(strokes, width, height)], width, height);
    const missed = regions.filter(box => maskTouches(box, mask, width, height) &&
        !captured.some(c => overlaps(c, box) &&
            c.x + c.width / 2 >= box.x - 3 && c.x + c.width / 2 <= box.x + box.width + 3 &&
            c.y + c.height / 2 >= box.y - 3 && c.y + c.height / 2 <= box.y + box.height + 3));
    const crops = missed.slice(0, MAX_CROPS);
    if (missed.length > MAX_CROPS) warnings.push("Too many separate text selections. OCR read only the first 12 unrecognized areas.");
    if (crops.length && typeof ocr === "function") {
        const folder = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-selected-ocr-"));
        try {
            for (const [i, box] of crops.entries()) {
                const pad = Math.max(8, Math.min(28, Math.round(box.height * .4)));
                const left = Math.max(0, box.x - pad), top = Math.max(0, box.y - pad);
                const right = Math.min(width, box.x + box.width + pad);
                const bottom = Math.min(height, box.y + box.height + pad);
                const cw = right - left, ch = bottom - top;
                const scale = cw <= 1000 && ch <= 900 ? 2 : 1;
                const target = path.join(folder, `selection-${i}.png`);
                try {
                    let operation = sharp(filePath, { animated: false, limitInputPixels: 32_000_000 })
                        .rotate().extract({ left, top, width: cw, height: ch }).flatten({ background: "#ffffff" });
                    if (scale === 2) operation = operation.resize(cw * 2, ch * 2);
                    await operation.png().toFile(target);
                    const output = await ocr(target, { workDir: folder });
                    if (output?.warning) warnings.push(`Selection ${i + 1}: ${output.warning}`);
                    for (const block of output?.blocks || []) {
                        const globalBox = { ...block, x: left + Number(block.x) / scale,
                            y: top + Number(block.y) / scale,
                            width: Number(block.width) / scale, height: Number(block.height) / scale,
                            source: "selected-area OCR" };
                        const caption = validCaption(globalBox, width, height);
                        // Reject characters outside the mask even when a crop
                        // contains a nearby logo or a different product label.
                        if (caption && maskTouches(caption, mask, width, height)) addUnique(captured, caption);
                    }
                } catch (error) {
                    warnings.push(`Selection ${i + 1} could not be read: ${error.message}`);
                }
            }
        } finally { await fs.promises.rm(folder, { recursive: true, force: true }).catch(() => {}); }
    }
    captured.sort((a, b) => a.y - b.y || a.x - b.x);
    if (captured.some(c => c.confidence != null && Number.isFinite(c.confidence) && c.confidence < 65)) {
        warnings.push("Some selected text has low OCR confidence. Check and correct the editable color names.");
    }
    if (!captured.length) warnings.push("OCR could not read the selected text. You can enter or correct the caption before adding the cleaned copy.");
    if (captured.length > 2) warnings.push(`${captured.length} separate text segments detected. Check which names belong to this image.`);
    return { captions: captured.slice(0, MAX_CAPTIONS), warnings };
}
module.exports = { captureSelectedCaptions, maskTouches, strokeBoxes, mergeNearby };
