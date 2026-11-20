"use strict";

const fs = require("node:fs");

/**
 * Photoshop ExtendScript on Windows can misdecode non-ASCII product captions
 * and folder names if the generated JSX has no UTF-8 BOM. 2026 and 2027 both
 * accept UTF-8 with BOM. VBS launchers remain UTF-16LE with BOM.
 */
function jsxWithBom(source) {
    return "\uFEFF" + String(source).replace(/^\uFEFF/, "");
}

async function writeJsxFile(filePath, source) {
    await fs.promises.writeFile(filePath, jsxWithBom(source), "utf8");
}

module.exports = { jsxWithBom, writeJsxFile };
