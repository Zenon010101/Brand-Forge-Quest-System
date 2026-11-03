"use strict";

const path = require("path");

// Geometry measured from !COMBINE_TEMPLATE.psd (600 x 1998).
// Only the original Detail boxes are fixed by the template. Line Up spacing
// is the agreed two-column extension of the same 293 px grid.
const DIM = Object.freeze({
    width: 600, single: 600, singleGap: 15,
    margin: 3, cell: 293, columnGap: 8, rowGap: 7,
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
    if (!single || typeof single !== "object") throw new Error("Upload one Single image before generating Combine.");
    if (!Array.isArray(lineup) || !Array.isArray(details)) throw new Error("Line Up and Details must be ordered lists.");
    // The only mandatory upload is Single. Either optional section may be omitted.
    if (lineup.length + details.length > DIM.maxParts) throw new Error(`Maximum ${DIM.maxParts} Line Up and Detail images per Combine.`);
    const name = safeOutputName(outputName);
    const placedSingle = fitInside(single, 0, 0, DIM.single, DIM.single);
    // Keep the 15 px gap before the first supplied section, but do not add
    // a trailing blank band for a Single-only Combine.
    let y = DIM.single + ((lineup.length || details.length) ? DIM.singleGap : 0);
    const lineupRows = [];
    const placedLineup = [];
    for (let i = 0; i < lineup.length; i += 2) {
        const items = lineup.slice(i, i + 2);
        const labels = items.map(item => wrapColorName(item.colorName));
        const lines = Math.max(...labels.map(l => l.length));
        const labelHeight = lines * DIM.labelLine;
        const row = { top: y, imageHeight: DIM.cell, labelTop: y + DIM.cell + DIM.labelGap,
            labelHeight, rowHeight: DIM.cell + DIM.labelGap + labelHeight,
            imageIndices: items.map((_, j) => i + j) };
        items.forEach((item, j) => {
            const colX = DIM.margin + j * (DIM.cell + DIM.columnGap);
            const fitted = fitInside(item, colX, y, DIM.cell, DIM.cell);
            placedLineup.push({ ...fitted, colorName: item.colorName, labelLines: labels[j],
                labelX: colX, labelY: row.labelTop, labelWidth: DIM.cell,
                labelHeight, order: i + j + 1 });
        });
        lineupRows.push(row);
        y += row.rowHeight + DIM.rowGap;
    }
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
        sourceCount: 1 + placedLineup.length + placedDetails.length,
        jpegCount: Math.ceil(y / 60000)
    };
}
module.exports = { DIM, buildCombineLayout, fitInside, wrapColorName, safeOutputName };
