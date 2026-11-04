"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { runPhotoshopJSX } = require("../../landing-page/main/photoshopBridge");

// Photoshop Content-Aware Fill is optional and does not use LaMa or require
// downloading an ML model. Actual Photoshop execution needs Windows QA.
async function photoshopContentAware(sourcePath, regions, width, height) {
    if (process.platform !== "win32") throw new Error("Photoshop Content-Aware Fill requires Adobe Photoshop on Windows. Choose Built-in restoration instead.");
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-combine-content-aware-"));
    try {
        const input = path.join(root, "source_copy.png");
        const output = path.join(root, "cleaned.png");
        await sharp(sourcePath, { animated:false, failOn:"error", limitInputPixels:32_000_000 })
            .rotate().png().toFile(input);
        const script = await fs.promises.readFile(path.join(__dirname, "../jsx/cleanupContentAware.jsx"), "utf8");
        const job = { input: input.replace(/\\/g,"/"), output: output.replace(/\\/g,"/"),
            width, height, areas: regions };
        await runPhotoshopJSX(`var CLEANUP_JOB = ${JSON.stringify(job)};\n` +
            script.replace(/^\s*#target\s+photoshop[^\n]*\n?/i, ""),
            "Combine Content-Aware Text Cleanup", Math.min(600000, 90000 + regions.length * 40000));
        const info = await sharp(output).metadata();
        if (info.format !== "png" || info.width !== width || info.height !== height) {
            throw new Error("Photoshop Content-Aware Fill did not produce a matching PNG.");
        }
        return { png: await fs.promises.readFile(output), width, height,
            methods: regions.map(() => "Photoshop Content-Aware Fill"),
            warnings: ["Check Photoshop Content-Aware results carefully wherever captions overlap actual product details."] };
    } finally { await fs.promises.rm(root, { recursive:true, force:true }).catch(() => {}); }
}
module.exports = { photoshopContentAware };
