"use strict";

const path = require("path");

// Geometry measured from !COMBINE_TEMPLATE.psd (600 x 1998).
// Only the original Detail boxes are fixed by the template. Line Up spacing
// is the agreed two-column extension of the same 293 px grid.
const DIM = Object.freeze({
    width: 600, single: 600, singleGap: 15,
    margin: 3, cell: 293, columnGap: 8, rowGap: 7,
    dualWidth: 594, dualMinHeight: 160, dualMaxHeight: 1600,
    labelGap: 6, labelSize: 28, labelLine: 36,
    detailsGap: 30, detailsHeadingSize: 28,
    detailsHeadingHeight: 36, detailsHeadingGap: 16,
    maxPsdHeight: 30000, maxHeight: 300000,
    maxParts: 250
});

function nameFromPath(p) { return path.parse(String(p || "")).name; }
function safeOutputName(value) {
    const stem = String(value || "").trim().replace(/\.(?:psd|psb|jpe?g)$/i, "");
    if (!stem || stem.length > 120 || stem.startsWith(".") || /[. ]$/.test(stem) ||
        /[<>:"/\\|?*\x00-\x1f]/.test(stem) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(stem)) {
        throw new Error("Enter a valid output filename (1-120 characters; no paths or Windows-reserved names).");
    }
    return stem;
}

function textUnits(ch) {
    if (/[\u2e80-\uffff]/.test(ch)) return 1;
    if (/[il1.,'\s]/.test(ch)) return 0.28;
    if (/[mwMW@]/.test(ch)) return 0.9;
    return 0.55;
}
function wrapColorName(raw, maxUnits = 10.0) {
    const text = String(raw || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
    if (!text) throw new Error("Every Line Up variation needs a color name.");
    if (text.length > 120) throw new Error("Color names are limited to 120 characters.");
    const words = text.match(/\S+\s*/g) || [text];
    const lines = [];
    let line = "";
    const measure = s => Array.from(s).reduce((n, c) => n + textUnits(c), 0);
    for (const word of words) {
        const value = word.trim();
        if (line && measure(`${line} ${value}`) > maxUnits) {
            lines.push(line);
            line = "";
        }
        if (measure(value) > maxUnits) {
            for (const ch of Array.from(value)) {
                if (line && measure(line + ch) > maxUnits) { lines.push(line); line = ""; }
                line += ch;
            }
        } else {
            line = line ? `${line} ${value}` : value;
        }
    }
    if (line) lines.push(line);
    if (lines.length > 5) throw new Error(`Color name "${text}" needs more than five lines. Shorten it.`);
    return lines;
}
function fitInside(entry, x, y, slotWidth, slotHeight) {
    const w = Number(entry.visibleWidth || entry.width);
    const h = Number(entry.visibleHeight || entry.height);
    if (!(w > 0 && h > 0)) throw new Error(`Invalid dimensions: ${entry.name}`);
    const scale = Math.min(slotWidth / w, slotHeight / h);
    const width = Math.max(1, Math.min(slotWidth, Math.round(w * scale)));
    const height = Math.max(1, Math.min(slotHeight, Math.round(h * scale)));
    return { ...entry, slotX: x, slotY: y, slotWidth, slotHeight, x: x + Math.floor((slotWidth - width) / 2),
        y: y + Math.floor((slotHeight - height) / 2),
        placedWidth: width, placedHeight: height };
}
function buildCombineLayout({ single, lineup, details, outputName }) {
    if (single != null && (typeof single !== "object" || Array.isArray(single))) throw new Error("Invalid Single image.");
    if (!Array.isArray(lineup) || !Array.isArray(details)) throw new Error("Line Up and Details must be ordered lists.");
    if (!single && !lineup.length && !details.length) throw new Error("Add at least one image to Single, Line Up, or Details.");
    if (lineup.length + details.length > DIM.maxParts) throw new Error(`Maximum ${DIM.maxParts} Line Up and Detail images per Combine.`);
    const name = safeOutputName(outputName);
    const placedSingle = single ? fitInside(single, 0, 0, DIM.single, DIM.single) : null;
    // Only reserve the 600 px Single area and 15 px separation when supplied.
    // Without Single, Line Up or Details starts at the top of the canvas.
    let y = placedSingle ? DIM.single + ((lineup.length || details.length) ? DIM.singleGap : 0) : 0;
    const lineupRows = [];
    const placedLineup = [];
    // Respect the exact source-image order. Regular one-item images share a
    // two-column row; a two-item image takes one entire full-width row and
    // creates TWO independent editable color-name text layers underneath it.
    // Never split, crop, or duplicate a two-item image into separate slots.
    let pending = [];
    function appendNormalRow(items) {
        if (!items.length) return;
        const labels = items.map(({ item }) => wrapColorName(item.colorName));
        const labelHeight = Math.max(...labels.map(lines => lines.length)) * DIM.labelLine;
        const labelTop = y + DIM.cell + DIM.labelGap;
        const row = { kind: "regular", top: y, imageHeight: DIM.cell, labelTop,
            labelHeight, rowHeight: DIM.cell + DIM.labelGap + labelHeight,
            imageIndices: items.map(({ index }) => index) };
        items.forEach(({ item, index }, column) => {
            const x = DIM.margin + column * (DIM.cell + DIM.columnGap);
            const lines = labels[column];
            const label = { side: "single", text: item.colorName, lines,
                x, y: labelTop, width: DIM.cell, height: labelHeight };
            placedLineup.push({ ...fitInside(item, x, y, DIM.cell, DIM.cell), rowMode: "single",
                colorName: item.colorName, labelLines: lines,
                labelX: x, labelY: labelTop, labelWidth: DIM.cell, labelHeight,
                labels: [label], order: index + 1 });
        });
        lineupRows.push(row);
        y += row.rowHeight + DIM.rowGap;
    }
    function appendDualRow(item, index) {
        const left = wrapColorName(item.colorName);
        const right = wrapColorName(item.colorNameRight);
        const rawWidth = Number(item.visibleWidth || item.width);
        const rawHeight = Number(item.visibleHeight || item.height);
        if (!(rawWidth > 0 && rawHeight > 0)) throw new Error(`Invalid dimensions: ${item.name}`);
        // Keep the complete source-image composition intact, with a row height
        // derived from its aspect ratio. Fit-inside is uniform: never stretch.
        const imageHeight = Math.max(DIM.dualMinHeight, Math.min(DIM.dualMaxHeight,
            Math.round(DIM.dualWidth * rawHeight / rawWidth)));
        const labelHeight = Math.max(left.length, right.length) * DIM.labelLine;
        const labelTop = y + imageHeight + DIM.labelGap;
        const xRight = DIM.margin + DIM.cell + DIM.columnGap;
        const labels = [
            { side: "left", text: item.colorName, lines: left,
                x: DIM.margin, y: labelTop, width: DIM.cell, height: labelHeight },
            { side: "right", text: item.colorNameRight, lines: right,
                x: xRight, y: labelTop, width: DIM.cell, height: labelHeight }
        ];
        const row = { kind: "dual", top: y, imageHeight, labelTop,
            labelHeight, rowHeight: imageHeight + DIM.labelGap + labelHeight,
            imageIndices: [index] };
        placedLineup.push({ ...fitInside(item, DIM.margin, y, DIM.dualWidth, imageHeight),
            rowMode: "dual", colorName: item.colorName, colorNameRight: item.colorNameRight,
            labelLines: left, labelX: DIM.margin, labelY: labelTop,
            labelWidth: DIM.cell, labelHeight, labels, order: index + 1 });
        lineupRows.push(row);
        y += row.rowHeight + DIM.rowGap;
    }
    lineup.forEach((item, index) => {
        const mode = item.rowMode == null ? "single" : item.rowMode;
        if (mode !== "single" && mode !== "dual") throw new Error(`Invalid Line Up row mode for ${item.name}.`);
        if (mode === "dual") {
            appendNormalRow(pending); pending = [];
            appendDualRow(item, index);
        } else {
            pending.push({ item, index });
            if (pending.length === 2) { appendNormalRow(pending); pending = []; }
        }
    });
    appendNormalRow(pending);
    // Empty last Line Up row is never emitted. Keep only the agreed 7 px
    // between rows; after the final row the Details section sets its own gap.
    if (lineupRows.length) y -= DIM.rowGap;
    let detailsHeader = null;
    const placedDetails = [];
    if (details.length) {
        if (lineup.length) y += DIM.detailsGap;
        detailsHeader = { x: 8, y, fontSize: DIM.detailsHeadingSize,
            height: DIM.detailsHeadingHeight, text: "DETAILS" };
        y += DIM.detailsHeadingHeight + DIM.detailsHeadingGap;
        for (let i = 0; i < details.length; i++) {
            const row = Math.floor(i / 2);
            const col = i % 2;
            const x = DIM.margin + col * (DIM.cell + DIM.columnGap);
            const top = y + row * (DIM.cell + DIM.rowGap);
            placedDetails.push({ ...fitInside(details[i], x, top, DIM.cell, DIM.cell), order: i + 1 });
        }
        y += Math.ceil(details.length / 2) * DIM.cell + Math.max(0, Math.ceil(details.length / 2) - 1) * DIM.rowGap;
        y += DIM.margin;
    }
    y = Math.ceil(y);
    if (y > DIM.maxHeight) throw new Error(`Combine height ${y}px exceeds Photoshop's supported document height.`);
    return {
        width: DIM.width, height: y, format: y > DIM.maxPsdHeight ? "psb" : "psd", name,
        single: placedSingle, lineup: placedLineup, details: placedDetails,
        lineupRows, detailsHeader, geometry: DIM,
        lineupRowCount: lineupRows.length,
        sourceCount: (placedSingle ? 1 : 0) + placedLineup.length + placedDetails.length,
        jpegCount: Math.ceil(y / 60000)
    };
}
module.exports = { DIM, buildCombineLayout, fitInside, wrapColorName, safeOutputName };
