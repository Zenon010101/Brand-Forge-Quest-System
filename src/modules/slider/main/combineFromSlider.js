"use strict";

// BrandForge Slider -> New Brand Combine handoff.
// Slider groups are authoritative starting evidence. The user reviews and
// corrects them before export; no OCR or destructive text cleanup is needed.
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const { inspectOne } = require("../../combine/main/assets");
const { buildCombineLayout, safeOutputName } = require("../../combine/main/planner");
const { rasterizePsdSources, preparedEntry, createCombineFiles } = require("../../combine/main/photoshop");

const JPEG_STRIP_MAX = 18000;
const MAX_INPUTS = 251;
let generating = false;

function sourceFile(photo) {
    return photo && typeof photo.path === "string" && photo.path.trim()
        ? { path: photo.path, name: photo.name || path.basename(photo.path) } : null;
}
function suggestFromSlider(job = {}) {
    const creative = Array.isArray(job.creative) ? job.creative : [];
    const details = Array.isArray(job.detail) ? job.detail : [];
    const rows = Array.isArray(job.lineupRows) ? job.lineupRows : [];
    const order = Array.isArray(job.outputOrder) && job.outputOrder.length ? job.outputOrder : [
        ...creative.map((_, index) => ({ type: "creative", index })),
        ...rows.map((_, index) => ({ type: "lineup", index })),
        ...details.map((_, index) => ({ type: "detail", index }))
    ];
    const variants = [], detailItems = [];
    const seenDescriptors = new Set();
    let serial = 0;
    function add(photo, section, colorName, reason) {
        const file = sourceFile(photo);
        if (!file) return;
        const item = { id: `slider-combine-${++serial}`, ...file, section,
            colorName: section === "lineup" ? String(colorName || "").trim() : "",
            colorNameRight: "", rowMode: "single", captionTopY: 0.4, captionBottomY: 0.85,
            reason };
        (section === "lineup" ? variants : detailItems).push(item);
    }
    for (const descriptor of order) {
        if (!descriptor || !["creative", "lineup", "detail"].includes(descriptor.type) ||
            !Number.isInteger(descriptor.index) || descriptor.index < 0) continue;
        const key = `${descriptor.type}-${descriptor.index}`;
        if (seenDescriptors.has(key)) continue;
        seenDescriptors.add(key);
        if (descriptor.type === "creative") {
            add(creative[descriptor.index], "details", "", "Slider Creative -> Details (review)");
        } else if (descriptor.type === "detail") {
            add(details[descriptor.index], "details", "", "Slider Detail");
        } else {
            const row = rows[descriptor.index];
            if (!row) continue;
            const slots = job.layoutMode === "fourCut" ? 4 : 2;
            const pa = job.layoutMode === "paVertical";
            for (let i = 1; i <= slots; i++) {
                if (pa && i === 2) add(row.photo2, "details", "", "PA Vertical feature photo -> Details (review)");
                else add(row[`photo${i}`], "lineup", pa ? row.variant1 : row[`variant${i}`],
                    `Slider ${job.layoutMode || "horizontal"} variation ${i}`);
            }
        }
    }
    return { items: [...variants, ...detailItems], lineupCount: variants.length,
        detailCount: detailItems.length, method: "slider-categories-with-manual-review" };
}
function xmlEscape(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function captionSvg(lines, width, height, size = 28, align = "center") {
    if (!lines || !lines.length) return null;
    const yStart = Math.min(size, Math.max(1, height - 3));
    const x = align === "left" ? 0 : width / 2;
    const anchor = align === "left" ? "start" : "middle";
    const tspans = lines.map((line, i) => `<tspan x="${x}" dy="${i ? 36 : 0}">${xmlEscape(line)}</tspan>`).join("");
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="${x}" y="${yStart}" font-size="${size}" font-weight="300" font-family="Hiragino Kaku Gothic Pro, Hiragino Sans, Yu Gothic, sans-serif" text-anchor="${anchor}" fill="#1e1e1e">${tspans}</text></svg>`);
}
function outputHtml(stem, jpegNames, publicBaseUrl = "") {
    const base = String(publicBaseUrl || "").trim();
    if (base && !/^https:\/\//i.test(base)) throw new Error("For Rakuten HTML, the public image URL must start with https://.");
    // Public base may be either a directory or full URL template ending with '/'.
    const srcFor = filename => base ? `${base.replace(/\/+$/, "")}/${encodeURIComponent(filename)}` : filename;
    const rows = jpegNames.map(name => `<tr><td><img src="${xmlEscape(srcFor(name))}" width="600" border="0" alt="${xmlEscape(stem)}"></td></tr>`).join("\n");
    // Rakuten-friendly table-only markup: no iframe, div, style or script.
    return `<table width="600" border="0" cellpadding="0" cellspacing="0">\n${rows}\n</table>\n`;
}
async function uniqueStem(folder, base) {
    const exists = new Set((await fs.promises.readdir(folder)).map(x => x.toLowerCase()));
    for (let n = 1; n <= 9999; n++) {
        const candidate = n === 1 ? base : `${base}_v${n}`;
        const c = candidate.toLowerCase();
        if (![".html", ".jpg", "_01.jpg", ".psd", ".psb"].some(ext => exists.has(c + ext)) &&
            ![...exists].some(file => file.startsWith(c + "_") && /_\d+\.jpe?g$/.test(file))) return candidate;
    }
    throw new Error("Too many existing Combine versions in the selected output folder.");
}
async function validateOutputFolder(folder) {
    if (!folder || typeof folder !== "string") throw new Error("Choose where to save the Combine JPEG, HTML and PSD/PSB.");
    const real = await fs.promises.realpath(folder);
    const stat = await fs.promises.stat(real);
    if (!stat.isDirectory()) throw new Error("Combine output must be an existing folder.");
    return real;
}
async function resolveLayout(payload) {
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length > MAX_INPUTS) throw new Error(`Combine supports up to ${MAX_INPUTS - 1} gallery images plus Single.`);
    const single = payload.singlePath ? await inspectOne(payload.singlePath) : null;
    const selected = [];
    for (const item of items) {
        if (!item || !["lineup", "details"].includes(item.section)) throw new Error("Every reviewed image needs Line Up or Details classification.");
        const info = await inspectOne(item.path);
        selected.push({ ...info, section: item.section, colorName: String(item.colorName || "").trim(),
            colorNameRight: String(item.colorNameRight || "").trim(),
            rowMode: item.section === "lineup" && ["single", "dual", "vertical"].includes(item.rowMode) ? item.rowMode : "single",
            captionTopY: item.captionTopY, captionBottomY: item.captionBottomY });
    }
    const lineup = selected.filter(x => x.section === "lineup");
    const details = selected.filter(x => x.section === "details");
    const layout = buildCombineLayout({ single, lineup, details, outputName: payload.outputName, allowBlankCaptions: true });
    return { layout, originals: [single, ...selected].filter(Boolean) };
}
async function prepareLayers(layout, temp, progress) {
    const ordered = [...(layout.single ? [layout.single] : []), ...layout.lineup, ...layout.details];
    progress({ stage: "preparing", message: `Preparing ${ordered.length} original images; no text removal.` });
    const map = await rasterizePsdSources(ordered.map(x => x.path), temp);
    const prepared = [];
    for (let i = 0; i < ordered.length; i++) {
        prepared.push(await preparedEntry(ordered[i], i, temp, map));
        progress({ stage: "preparing", completed: i + 1, total: ordered.length,
            message: `Fitted ${i + 1}/${ordered.length} images (preserved proportions)` });
    }
    const images = prepared.map(item => ({ source: item.input, x: item.x, y: item.y,
        width: item.placedWidth, height: item.placedHeight }));
    const labels = [];
    for (let i = 0; i < layout.lineup.length; i++) {
        const entry = layout.lineup[i];
        const placed = prepared[(layout.single ? 1 : 0) + i];
        for (const label of placed.labels || entry.labels || []) {
            if (!label.lines || !label.lines.length || !(label.width > 0) || !(label.height > 0)) continue;
            labels.push({ input: captionSvg(label.lines, Math.max(1, Math.round(label.width)),
                    Math.max(1, Math.round(label.height))), x: Math.round(label.x), y: Math.round(label.y),
                width: Math.round(label.width), height: Math.round(label.height) });
        }
    }
    if (layout.detailsHeader) {
        const h = layout.detailsHeader;
        labels.push({ input: captionSvg(["DETAILS"], layout.width - 16, h.height, h.fontSize, "left"),
            x: h.x, y: h.y, width: layout.width - 16, height: h.height });
    }
    return { images, labels };
}
async function renderStrip(width, top, height, layers, destination) {
    const overlays = [];
    for (const [kind, list] of [["images", layers.images], ["labels", layers.labels]]) {
        for (const entry of list) {
            if (!entry || !entry.width || !entry.height) continue;
            const start = Math.max(entry.y, top);
            const end = Math.min(entry.y + entry.height, top + height);
            if (end <= start) continue;
            const localTop = start - entry.y;
            const h = end - start;
            let input;
            if (kind === "images") {
                input = await sharp(entry.source).extract({ left: 0, top: localTop, width: entry.width, height: h }).png().toBuffer();
            } else {
                input = await sharp(entry.input).extract({ left: 0, top: localTop, width: entry.width, height: h }).png().toBuffer();
            }
            overlays.push({ input, left: entry.x, top: start - top });
        }
    }
    await sharp({ create: { width, height, channels: 3, background: "white" }, limitInputPixels: 400000000 })
        .composite(overlays).jpeg({ quality: 96, chromaSubsampling: "4:4:4", mozjpeg: true }).toFile(destination);
    const meta = await sharp(destination).metadata();
    if (meta.format !== "jpeg" || meta.width !== width || meta.height !== height)
        throw new Error("Combine JPEG validation failed after rendering.");
}
async function renderOutputs(layout, temp, stem, publicBaseUrl, progress) {
    const layers = await prepareLayers(layout, temp, progress);
    const stripCount = Math.ceil(layout.height / JPEG_STRIP_MAX);
    const jpegNames = [];
    const jpegPaths = [];
    for (let i = 0; i < stripCount; i++) {
        const filename = stripCount === 1 ? `${stem}.jpg` : `${stem}_${String(i + 1).padStart(2, "0")}.jpg`;
        const dest = path.join(temp, filename);
        await renderStrip(layout.width, i * JPEG_STRIP_MAX, Math.min(JPEG_STRIP_MAX, layout.height - i * JPEG_STRIP_MAX), layers, dest);
        jpegNames.push(filename); jpegPaths.push(dest);
        progress({ stage: "jpeg", completed: i + 1, total: stripCount, message: `JPEG ${i + 1}/${stripCount} saved and verified` });
    }
    const htmlPath = path.join(temp, `${stem}.html`);
    await fs.promises.writeFile(htmlPath, outputHtml(stem, jpegNames, publicBaseUrl), "utf8");
    progress({ stage: "html", message: "HTML created for the matching JPEG output." });
    return { jpegNames, jpegPaths, htmlPath };
}
async function publishFiles(staged, folder) {
    const sources = [...staged.jpegPaths, staged.htmlPath];
    const published = [];
    try {
        for (const source of sources) {
            const dest = path.join(folder, path.basename(source));
            // Exclusive copy prevents overwriting existing outputs or marker PSDs.
            await fs.promises.copyFile(source, dest, fs.constants.COPYFILE_EXCL);
            published.push(dest);
        }
        return { jpegPaths: published.slice(0, -1), htmlPath: published.at(-1) };
    } catch (error) {
        for (const created of published) await fs.promises.rm(created, { force: true }).catch(() => {});
        throw error;
    }
}
async function generateSliderCombine(payload, progress = () => {}, dependencies = {}) {
    if (generating) throw new Error("Another Slider Combine job is already generating.");
    generating = true;
    let temp;
    try {
        const folder = await validateOutputFolder(payload.outputFolder);
        const base = safeOutputName(payload.outputName);
        const stem = await uniqueStem(folder, base);
        const { layout, originals } = await resolveLayout({ ...payload, outputName: stem });
        for (const original of originals) {
            const stat = await fs.promises.lstat(original.path);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== original.bytes || stat.mtimeMs !== original.mtimeMs)
                throw new Error(`${original.name} changed after import. Import it again.`);
        }
        temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-slider-combine-"));
        progress({ stage: "layout", message: `600 x ${layout.height}px | Single -> ${layout.lineup.length} Line Up -> ${layout.details.length} Details` });
        const render = dependencies.render || renderOutputs;
        const staged = await render(layout, temp, stem, payload.publicBaseUrl, progress);
        const saved = await publishFiles(staged, folder);
        let psdPath = null, psdWarning = null;
        if (payload.includePsd) {
            progress({ stage: "psd", message: `Creating editable ${layout.format.toUpperCase()} in Photoshop...` });
            try {
                const builder = dependencies.psdBuilder || createCombineFiles;
                const psdStage = path.join(temp, "photoshop");
                await fs.promises.mkdir(psdStage, { recursive: true });
                const psd = await builder(layout, psdStage, progress);
                const target = path.join(folder, `${stem}.${layout.format}`);
                await fs.promises.copyFile(psd.psdPath, target, fs.constants.COPYFILE_EXCL);
                psdPath = target;
            } catch (error) {
                psdWarning = `JPEG + HTML saved. Optional Photoshop output failed: ${error.message || error}`;
                progress({ stage: "warning", message: psdWarning });
            }
        }
        progress({ stage: "complete", message: `Saved ${saved.jpegPaths.length} JPEG + HTML${psdPath ? " + editable PSD/PSB" : ""}` });
        return { ok: true, outputFolder: folder, outputName: stem,
            width: layout.width, height: layout.height, lineupCount: layout.lineup.length,
            detailCount: layout.details.length, jpegPaths: saved.jpegPaths,
            htmlPath: saved.htmlPath, psdPath, psdWarning,
            htmlUsesPublicUrls: Boolean(String(payload.publicBaseUrl || "").trim()) };
    } finally {
        generating = false;
        if (temp) await fs.promises.rm(temp, { recursive: true, force: true }).catch(() => {});
    }
}
module.exports = { suggestFromSlider, outputHtml, uniqueStem, resolveLayout, generateSliderCombine, renderOutputs, captionSvg };
