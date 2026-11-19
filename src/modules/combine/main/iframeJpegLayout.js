"use strict";

// The iframe HTML table and the Combine JPEG intentionally use DIFFERENT layouts.
// JPEG: restore the established 600px Combine look, with two image columns in
// BOTH Line Up and Details. Images remain unmodified and are loaded by Chromium
// directly from their original HTTPS URLs (no Photoshop or downloaded assets).
const { DIM } = require("./planner");
const WIDTH = DIM.width;
const esc = value => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");

function itemTag(url, index, kind) {
    if (!/^https:\/\//i.test(String(url))) throw new Error(`Combine JPEG: invalid ${kind} image URL at item ${index + 1}.`);
    return `<div class="bf-slot bf-${kind}-slot"><img src="${esc(url)}" alt="${esc(kind)} ${index + 1}" loading="eager"></div>`;
}
function twoColumnRows(urls, kind) {
    const rows = [];
    for (let i = 0; i < urls.length; i += 2) {
        // An unpaired item stays in its original left slot, never stretched.
        rows.push(`<div class="bf-row">${itemTag(urls[i], i, kind)}${urls[i + 1]
            ? itemTag(urls[i + 1], i + 1, kind)
            : '<div class="bf-slot bf-empty" aria-hidden="true"></div>'}</div>`);
    }
    return rows.join("\n");
}
function legacyCombineJpegHtml({ lineup = [], details = [] } = {}) {
    if (!Array.isArray(lineup) || !Array.isArray(details) || (!lineup.length && !details.length)) {
        throw new Error("Combine JPEG needs at least one Line Up or Details image.");
    }
    // Use the legacy planner constants to prevent 600px JPEG layout drift.
    const detailsGap = lineup.length ? DIM.detailsGap : 0;
    const head = details.length
        ? `<section class="bf-details" style="margin-top:${detailsGap}px"><h2>DETAILS</h2>${twoColumnRows(details, "details")}</section>`
        : "";
    return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${WIDTH},initial-scale=1">
<title>BrandForge Combine JPEG</title>
<style>
  html,body{margin:0;padding:0;background:#fff;color:#1e1e1e;overflow-x:hidden}
  body{width:${WIDTH}px;font-family:Arial,sans-serif}
  .bf-page{box-sizing:border-box;width:${WIDTH}px;padding:${DIM.margin}px}
  .bf-row{display:grid;grid-template-columns:${DIM.cell}px ${DIM.cell}px;column-gap:${DIM.columnGap}px;
    align-items:end;width:${DIM.dualWidth}px}
  .bf-row+.bf-row{margin-top:${DIM.rowGap}px}
  .bf-slot{box-sizing:border-box;width:${DIM.cell}px;min-width:0;display:flex;
    align-items:center;justify-content:center;overflow:hidden}
  .bf-slot img{display:block;width:auto;height:auto;max-width:100%;object-fit:contain;
    margin:0 auto;border:0}
  .bf-lineup-slot{align-items:end}
  .bf-lineup-slot img{max-height:${DIM.lineupPortraitMaxHeight}px}
  .bf-details h2{box-sizing:border-box;height:${DIM.detailsHeadingHeight}px;line-height:${DIM.detailsHeadingHeight}px;
    font-family:Arial,sans-serif;font-size:${DIM.detailsHeadingSize}px;font-weight:400;
    margin:0 0 ${DIM.detailsHeadingGap}px 5px;padding:0}
  .bf-details-slot{height:${DIM.cell}px}
  .bf-details-slot img{max-height:${DIM.cell}px}
</style>
</head>
<body><main class="bf-page">${lineup.length ? `<section class="bf-lineup">${twoColumnRows(lineup, "lineup")}</section>` : ""}${head}</main></body>
</html>`;
}

module.exports = { legacyCombineJpegHtml, WIDTH, twoColumnRows };
