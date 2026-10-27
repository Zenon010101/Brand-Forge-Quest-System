"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { recognize } = require("./ocr");
const { CANVAS_WIDTH, SINGLE_HEIGHT, checkImageFile, clamp } = require("./planner");

const MAX_PIXELS = 240000000;
const MIN_TEXT_CONFIDENCE = 78;

function colorDistance(a, b) {
    return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}
function pixel(data, info, x, y) {
    const pos = (clamp(Math.round(y), 0, info.height - 1) * info.width + clamp(Math.round(x), 0, info.width - 1)) * info.channels;
    return [data[pos], data[pos + 1], data[pos + 2]];
}
function hex(color) { return `#${color.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, "0")).join("")}`; }

async function sampleBorder(imagePath, block) {
    const margin = 4;
    const left = Math.max(0, Math.floor(block.x) - margin);
    const top = Math.max(0, Math.floor(block.y) - margin);
    const width = Math.max(1, Math.min(CANVAS_WIDTH - left, Math.ceil(block.x + block.width) + margin - left));
    const { height: totalHeight } = await sharp(imagePath).metadata();
    const height = Math.max(1, Math.min(totalHeight - top, Math.ceil(block.y + block.height) + margin - top));
    if (width < 8 || height < 8) return null;
    const { data, info } = await sharp(imagePath, { limitInputPixels: MAX_PIXELS }).extract({ left, top, width, height }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const counts = new Map();
    const samplePoints = [];
    // Border points immediately outside the OCR bounding rectangle, where the
    // background should be visible if the copy is over a flat color panel.
    for (let x = 2; x < info.width - 2; x += Math.max(1, Math.floor(info.width / 60))) {
        samplePoints.push(pixel(data, info, x, 1), pixel(data, info, x, info.height - 2));
    }
    for (let y = 2; y < info.height - 2; y += Math.max(1, Math.floor(info.height / 25))) {
        samplePoints.push(pixel(data, info, 1, y), pixel(data, info, info.width - 2, y));
    }
    for (const rgb of samplePoints) {
        const key = rgb.map(v => Math.round(v / 8) * 8).join(",");
        const record = counts.get(key) || { count: 0, rgb: [0, 0, 0] };
        record.count++;
        rgb.forEach((v, k) => { record.rgb[k] += v; });
        counts.set(key, record);
    }
    const best = [...counts.values()].sort((a, b) => b.count - a.count)[0];
    if (!best || best.count / samplePoints.length < 0.80) return null;
    const background = best.rgb.map(v => Math.round(v / best.count));
    const contrasts = [];
    for (let y = 2; y < info.height - 2; y += Math.max(1, Math.floor(info.height / 15))) {
        for (let x = 2; x < info.width - 2; x += Math.max(1, Math.floor(info.width / 40))) {
            const rgb = pixel(data, info, x, y);
            if (colorDistance(rgb, background) > 65) contrasts.push(rgb);
        }
    }
    const foreground = contrasts.length
        ? [0, 1, 2].map(k => Math.round(contrasts.reduce((sum, rgb) => sum + rgb[k], 0) / contrasts.length))
        : [0, 0, 0];
    if (contrasts.length < 3) return null;
    return { background, color: hex(foreground), rect: { left, top, width, height } };
}

// Very conservative full-width picture/graphic band isolation. A white or
// single-color page with a photo between uniform horizontal gutters can have
// the image extracted as its own independent raster PSD layer. Complex mixed
// text/photo sections remain untouched in the fallback raster.
async function findImageBands(imagePath, textBlocks) {
    const { data, info } = await sharp(imagePath, { limitInputPixels: MAX_PIXELS })
        .resize({ width: 250, withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.height < 100) return [];
    const background = pixel(data, info, 0, 0);
    const corner = pixel(data, info, info.width - 1, 0);
    if (colorDistance(background, corner) > 14) return [];
    const foreground = new Array(info.height).fill(false);
    const rows = [];
    for (let y = 0; y < info.height; y++) {
        let changed = 0;
        let minX = info.width, maxX = -1;
        for (let x = 2; x < info.width - 2; x += 2) {
            if (colorDistance(pixel(data, info, x, y), background) > 30) {
                changed++;
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
            }
        }
        foreground[y] = changed >= 8;
        rows.push({ changed, minX, maxX });
    }
    const regions = [];
    let begin = -1, last = -1;
    for (let y = 0; y <= info.height; y++) {
        if (y < info.height && foreground[y]) {
            if (begin < 0) begin = y;
            last = y;
        }
        if (begin >= 0 && (y === info.height || y - last > 8)) {
            const bottom = last + 1;
            const top = begin;
            if (bottom - top >= 40) regions.push({ top, bottom });
            begin = -1;
        }
    }
    const normalizedHeight = (await sharp(imagePath).metadata()).height;
    const scaleX = CANVAS_WIDTH / info.width;
    const scaleY = normalizedHeight / info.height;
    const results = [];
    for (const region of regions) {
        const sample = rows.slice(region.top, region.bottom);
        const widthHits = sample.filter(row => row.changed > info.width * .18);
        if (widthHits.length / sample.length < 0.42) continue;
        let minX = info.width, maxX = -1;
        const bins = new Set();
        for (let y = region.top; y < region.bottom; y += 3) {
            minX = Math.min(minX, rows[y].minX);
            maxX = Math.max(maxX, rows[y].maxX);
            for (let x = 0; x < info.width; x += 4) {
                const rgb = pixel(data, info, x, y);
                if (colorDistance(rgb, background) > 35) bins.add(rgb.map(v => Math.floor(v / 32)).join("_"));
            }
        }
        if (bins.size < 28 || minX >= maxX) continue;
        const top = Math.max(0, Math.floor(region.top * scaleY));
        const bottom = Math.min(normalizedHeight, Math.ceil(region.bottom * scaleY));
        const left = Math.max(0, Math.floor((minX - 2) * scaleX));
        const right = Math.min(CANVAS_WIDTH, Math.ceil((maxX + 4) * scaleX));
        const rect = { left, top, width: right - left, height: bottom - top };
        if (rect.width < 120 || rect.height < 140) continue;
        if (textBlocks.some(t =>
            t.x < rect.left + rect.width && t.x + t.width > rect.left &&
            t.y < rect.top + rect.height && t.y + t.height > rect.top
        )) continue;
        // The pixel-reconstruction property is exact: crop and place at the
        // original pixel coordinates, and mask exactly that rectangle beneath.
        results.push({ ...rect, background: hex(background) });
        if (results.length >= 20) break;
    }
    return results;
}

// Component-based isolation for large photographic panels, including images
// beside text in multi-column layouts. It never modifies uncertain regions:
// all accepted crops are placed at their original coordinates, pixel-for-pixel.
async function findImageComponents(imagePath, textBlocks) {
    const { data, info } = await sharp(imagePath, { limitInputPixels: MAX_PIXELS })
        .resize({ width: 250, withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const bg = pixel(data, info, 1, 1);
    if (colorDistance(bg, pixel(data, info, info.width - 2, 1)) > 15) return [];
    const count = info.width * info.height;
    if (count > 12000000) return []; // conserve RAM on exceptionally tall pages
    const marked = new Uint8Array(count);
    const seen = new Uint8Array(count);
    const queue = new Int32Array(count);
    for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
            const index = y * info.width + x;
            marked[index] = colorDistance(pixel(data, info, x, y), bg) > 35 ? 1 : 0;
        }
    }
    const meta = await sharp(imagePath).metadata();
    const sx = meta.width / info.width, sy = meta.height / info.height;
    const rectangles = [];
    for (let first = 0; first < count; first++) {
        if (!marked[first] || seen[first]) continue;
        let head = 0, tail = 1;
        queue[0] = first;
        seen[first] = 1;
        let minX = info.width, minY = info.height, maxX = 0, maxY = 0, pixels = 0;
        const colorBins = new Set();
        while (head < tail) {
            const at = queue[head++];
            const x = at % info.width, y = (at / info.width) | 0;
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
            pixels++;
            if ((pixels % 5) === 0) colorBins.add(pixel(data, info, x, y).map(c => Math.floor(c / 32)).join("_"));
            const neighbors = [x > 0 ? at - 1 : -1, x + 1 < info.width ? at + 1 : -1,
                y > 0 ? at - info.width : -1, y + 1 < info.height ? at + info.width : -1];
            for (const next of neighbors) {
                if (next >= 0 && marked[next] && !seen[next]) {
                    seen[next] = 1;
                    queue[tail++] = next;
                }
            }
        }
        const w = maxX - minX + 1, h = maxY - minY + 1;
        if (w < 36 || h < 30 || pixels < 500 || pixels / (w * h) < .28 || colorBins.size < 25) continue;
        const left = Math.max(0, Math.floor((minX - 1) * sx));
        const top = Math.max(0, Math.floor((minY - 1) * sy));
        const right = Math.min(meta.width, Math.ceil((maxX + 2) * sx));
        const bottom = Math.min(meta.height, Math.ceil((maxY + 2) * sy));
        const rect = { left, top, width: right - left, height: bottom - top };
        if (rect.width < 140 || rect.height < 110) continue;
        if (textBlocks.some(t => t.x < left + rect.width && t.x + t.width > left &&
            t.y < top + rect.height && t.y + t.height > top)) continue;
        // Avoid capturing almost the entire screenshot as a single "image".
        if (rect.width > 0.98 * meta.width && rect.height > 0.94 * meta.height) continue;
        rectangles.push({ ...rect, background: hex(bg) });
        if (rectangles.length >= 20) break;
    }
    return rectangles.sort((a, b) => a.top - b.top || a.left - b.left);
}

async function analyzePart(source, index, workDir, options = {}, progress = () => {}) {
    const original = checkImageFile(source);
    const stats = await fs.promises.stat(original);
    const base = `part${String(index + 1).padStart(2, "0")}`;
    const normalized = path.join(workDir, `${base}-normalized.png`);
    const cleanBase = path.join(workDir, `${base}-base.png`);
    const meta = await sharp(original, { limitInputPixels: MAX_PIXELS }).rotate().metadata();
    if (!meta.width || !meta.height) throw new Error("Image has invalid dimensions.");
    const sideways = [5, 6, 7, 8].includes(meta.orientation);
    const orientedWidth = sideways ? meta.height : meta.width;
    const orientedHeight = sideways ? meta.width : meta.height;
    const normalizedHeight = Math.round(orientedHeight * CANVAS_WIDTH / orientedWidth);
    if (normalizedHeight < 1 || normalizedHeight > 300000) throw new Error(`Normalized height invalid: ${normalizedHeight} px.`);
    progress(`Normalizing screenshot ${index + 1} to 1000 px…`);
    await sharp(original, { limitInputPixels: MAX_PIXELS }).rotate()
        .resize({ width: CANVAS_WIDTH, height: normalizedHeight, fit: "fill", kernel: sharp.kernel.lanczos3 })
        .png({ compressionLevel: 5 }).toFile(normalized);

    const warnings = [], words = [];
    const CHUNK_HEIGHT = 1350;
    for (let top = 0; top < normalizedHeight; top += CHUNK_HEIGHT) {
        const height = Math.min(CHUNK_HEIGHT, normalizedHeight - top);
        const chunkPath = path.join(workDir, `${base}-ocr-${String(top).padStart(6, "0")}.png`);
        await sharp(normalized).extract({ left: 0, top, width: CANVAS_WIDTH, height }).png().toFile(chunkPath);
        progress(`OCR screenshot ${index + 1} — y ${top}–${top + height}…`);
        const ocr = await recognize(chunkPath, { tesseractPath: options.tesseractPath, workDir });
        if (ocr.warning && !warnings.includes(ocr.warning)) warnings.push(ocr.warning);
        for (const item of ocr.blocks || []) {
            const box = {
                text: String(item.text || "").trim(), x: Number(item.x), y: Number(item.y) + top,
                width: Number(item.width), height: Number(item.height),
                confidence: item.confidence === null ? null : Number(item.confidence),
                engine: ocr.engine
            };
            if (!box.text || ![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) continue;
            if (box.x < 0 || box.y < 0 || box.x + box.width > CANVAS_WIDTH + 1 || box.y + box.height > normalizedHeight + 1) continue;
            words.push(box);
        }
        await fs.promises.rm(chunkPath, { force: true }).catch(() => {});
    }

    const text = [], masks = [], extracted = [];
    const occupied = [];
    const score = item => item.confidence === null ? 72 : item.confidence;
    const sortedWords = words.sort((a, b) => score(b) - score(a));
    let evaluatedBackgrounds = 0;
    for (const block of sortedWords.slice(0, 600)) {
        const candidate = { ...block, name: `TEXT_${String(text.length + 1).padStart(2, "0")}`, editable: false, hiddenReview: true };
        const isTrusted = block.confidence === null || block.confidence >= MIN_TEXT_CONFIDENCE;
        if (isTrusted && evaluatedBackgrounds < 200 && !occupied.some(prev => block.x < prev.left + prev.width && block.x + block.width > prev.left && block.y < prev.top + prev.height && block.y + block.height > prev.top)) {
            try {
                evaluatedBackgrounds++;
                const sample = await sampleBorder(normalized, block);
                if (sample) {
                    candidate.editable = true;
                    candidate.hiddenReview = false;
                    candidate.background = hex(sample.background);
                    candidate.color = sample.color;
                    candidate.fontSize = clamp(Math.round(block.height * 0.95), 9, 130);
                    candidate.mask = sample.rect;
                    occupied.push(sample.rect);
                    masks.push({ input: { create: { width: sample.rect.width, height: sample.rect.height, channels: 4, background: candidate.background } }, left: sample.rect.left, top: sample.rect.top });
                }
            } catch (error) {
                warnings.push(`Text restoration skipped (${block.text.slice(0, 24)}): ${error.message}`);
            }
        }
        text.push(candidate);
    }
    if (words.length > 600) warnings.push("Only first 600 OCR lines were considered; remaining text stays in raster fallback.");
    if (evaluatedBackgrounds >= 200) warnings.push("Text background checks capped at 200 per screenshot to protect batch performance; remaining OCR lines kept as hidden review layers.");
    const trustedText = text.filter(item => item.editable);
    if (text.length && trustedText.length < text.length) {
        warnings.push(`${text.length - trustedText.length} OCR text lines are retained as hidden editable review layers because safe background reconstruction is uncertain.`);
    }
    progress(`Identifying isolated image blocks in screenshot ${index + 1}…`);
    try {
        const componentImages = await findImageComponents(normalized, text);
        const imageBands = await findImageBands(normalized, text);
        for (const block of [...componentImages, ...imageBands]) {
            if (extracted.some(previous => block.left < previous.left + previous.width &&
                block.left + block.width > previous.left && block.top < previous.top + previous.height &&
                block.top + block.height > previous.top)) continue;
            if (masks.some(mask => {
                const rect = { left: mask.left, top: mask.top, width: mask.input.create.width, height: mask.input.create.height };
                return block.left < rect.left + rect.width && block.left + block.width > rect.left && block.top < rect.top + rect.height && block.top + block.height > rect.top;
            })) continue;
            const name = `${base}_img${String(extracted.length + 1).padStart(2, "0")}.png`;
            const filePath = path.join(workDir, name);
            await sharp(normalized).extract({ left: block.left, top: block.top, width: block.width, height: block.height }).png().toFile(filePath);
            extracted.push({ ...block, name: `IMG_${String(extracted.length + 1).padStart(2, "0")}`, file: filePath, confidence: "conservative band" });
            masks.push({ input: { create: { width: block.width, height: block.height, channels: 4, background: block.background } }, left: block.left, top: block.top });
        }
    } catch (error) { warnings.push(`Image segmentation fallback: ${error.message}`); }
    if (masks.length) {
        // Most importantly, no untrusted OCR region is erased. The visible base
        // keeps the original screenshot everywhere but reliable reconstructed blocks.
        await sharp(normalized).composite(masks).png().toFile(cleanBase);
    } else {
        await fs.promises.copyFile(normalized, cleanBase);
    }
    const ocrPath = path.join(workDir, `${base}-ocr.json`);
    await fs.promises.writeFile(ocrPath, JSON.stringify({ source: original, text, warnings }, null, 2), "utf8");
    return {
        source: original, name: path.basename(original), sourceSize: stats.size,
        originalWidth: meta.width, originalHeight: meta.height,
        width: CANVAS_WIDTH, height: normalizedHeight, normalizedPath: normalized,
        basePath: cleanBase, ocrPath, text, images: extracted, warnings,
        counts: { editableText: trustedText.length, reviewText: text.length - trustedText.length, separateImages: extracted.length }
    };
}

async function prepareSingle(source, workDir) {
    const file = path.join(workDir, "single-1000.png");
    if (source) {
        await sharp(checkImageFile(source), { limitInputPixels: MAX_PIXELS }).rotate()
            .resize(CANVAS_WIDTH, SINGLE_HEIGHT, { fit: "contain", background: "#ffffff", withoutEnlargement: false })
            .flatten({ background: "#ffffff" }).png().toFile(file);
    } else {
        await sharp({ create: { width: CANVAS_WIDTH, height: SINGLE_HEIGHT, channels: 3, background: "#ffffff" } }).png().toFile(file);
    }
    return file;
}

module.exports = { analyzePart, prepareSingle, sampleBorder, findImageBands, findImageComponents };
