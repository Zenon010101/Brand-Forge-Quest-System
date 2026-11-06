"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { TextCleanupService } = require("../src/modules/combine/main/textCleanup");
const { CombineService } = require("../src/modules/combine/main/service");
const { captureSelectedCaptions } = require("../src/modules/combine/main/selectedCaptionOcr");
const { capturedCaptionSuggestion } = require("../src/modules/combine/shared/captionLayout");

async function run() {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-captured-text-test-"));
    const source = path.join(root, "product.png");
    try {
        await sharp({ create: { width: 600, height: 600, channels: 3, background: "#ffffff" } })
            .png().toFile(source);
        let calls = 0;
        const service = new TextCleanupService({ ocr: async imagePath => {
            calls++;
            if (path.basename(imagePath) === "scan.png") return { engine: "Mock OCR", blocks: [
                { text: "UNSELECTED BRAND", x: 35, y: 32, width: 110, height: 20, confidence: 97 }
            ] };
            // Coordinates within the upscaled selected crop (2x). Use a
            // Japanese label even though the full-image OCR missed it.
            return { engine: "Mock OCR", blocks: [
                { text: "1.クラウドホワイト/コアブラック", x: 40, y: 18, width: 290, height: 35, confidence: 95 }
            ] };
        } });
        assert.equal((await service.addFiles([source])).images.length, 1);
        await service.scan(source);
        assert.equal(calls, 1);
        const area = { x: 130, y: 270, width: 250, height: 35 };
        const cleanPreview = await service.preview({ filePath: source, engine: "clean", areas: [area], captureText: true });
        assert(cleanPreview.previewDataUrl.startsWith("data:image/png;base64,"));
        assert.equal(cleanPreview.captions.length, 1);
        assert.equal(cleanPreview.captions[0].text, "1.クラウドホワイト/コアブラック");
        assert(!cleanPreview.captions.some(c => c.text.includes("UNSELECTED")), "Unselected logo not reused");
        assert.equal(capturedCaptionSuggestion(cleanPreview.captions, 600, 600).first,
            "クラウドホワイト/コアブラック", "Ordinal is omitted from editable color name");
        assert(calls >= 2, "Manual rectangle triggers targeted OCR on original source");
        // Brush-only selection gets the same OCR text, without requiring an
        // approved OCR checkbox or a rectangle.
        const brush = [{ mode: "add", size: 32, points: [[138, 285], [375, 285]] }];
        const brushed = await service.preview({ filePath: source, areas: [], strokes: brush,
            captureText: true, engine: "clean" });
        assert.equal(brushed.captions.length, 1, "Brush-only OCR is mapped into a caption");
        // Two independently highlighted captions missed by the first scan
        // still become two editable names with original top/bottom positions.
        const selectedPair = await captureSelectedCaptions({ filePath: source, width: 600, height: 600,
            areas: [{ x: 112, y: 250, width: 320, height: 35 },
                { x: 115, y: 544, width: 318, height: 35 }], strokes: [], scanRegions: [],
            ocr: async (imagePath) => ({ blocks: [{
                text: path.basename(imagePath).includes("selection-0") ? "1.TOP COLOR" : "2.BOTTOM COLOR",
                x: 42, y: 18, width: 460, height: 42, confidence: 94
            }] }) });
        assert.equal(selectedPair.captions.length, 2, "Both manually selected captions recovered");
        const suggestedPair = capturedCaptionSuggestion(selectedPair.captions, 600, 600);
        assert.equal(suggestedPair.mode, "vertical");
        assert.equal(suggestedPair.first, "TOP COLOR");
        assert.equal(suggestedPair.second, "BOTTOM COLOR");
        // Eraser subtracts part of a selection; a logo touched only by a
        // protected eraser region is not promoted to a caption.
        const result = await captureSelectedCaptions({ filePath: source, width: 600, height: 600,
            areas: [{ x: 120, y: 270, width: 240, height: 40 }], strokes: [
                { mode: "add", size: 28, points: [[30, 40], [140, 40]] },
                { mode: "erase", size: 75, points: [[30, 40], [85, 40], [140, 40]] }
            ], scanRegions: [
                { text: "UNSELECTED BRAND", x: 35, y: 32, width: 110, height: 20, confidence: 97 },
                { text: "2.コアブラック", x: 140, y: 277, width: 165, height: 23, confidence: 96 }
            ], ocr: async () => ({ blocks: [] }) });
        assert.deepEqual(result.captions.map(c => c.text), ["2.コアブラック"]);
        // Two captions are ordered by spatial position, not OCR emission order.
        const horizontal = capturedCaptionSuggestion([
            { text: "RIGHT", x: 405, y: 512, width: 90, height: 20 },
            { text: "LEFT", x: 58, y: 515, width: 90, height: 20 }
        ], 600, 600);
        assert.equal(horizontal.mode, "dual");
        assert.deepEqual([horizontal.first, horizontal.second], ["LEFT", "RIGHT"]);
        const vertical = capturedCaptionSuggestion([
            { text: "2.コアブラック/クラウドホワイト", x: 150, y: 555, width: 300, height: 25 },
            { text: "1.クラウドホワイト/コアブラック", x: 145, y: 253, width: 310, height: 25 }
        ], 600, 600);
        assert.equal(vertical.mode, "vertical");
        assert.equal(vertical.first, "クラウドホワイト/コアブラック");
        assert.equal(vertical.second, "コアブラック/クラウドホワイト");
        assert.equal(vertical.topY, 253/600);
        assert.equal(vertical.bottomY, 555/600);
        // OCR failure does not prevent the user from cleaning the selected
        // text; the edit fields remain available for manual correction.
        const noOcr = new TextCleanupService({ ocr: async () => ({ blocks: [], engine: "Unavailable", warning: "OCR missing" }) });
        await noOcr.addFiles([source]);
        await noOcr.scan(source);
        const noCapture = await noOcr.preview({ filePath: source, areas: [area], captureText: true });
        assert.equal(noCapture.captions.length, 0);
        assert(noCapture.captionWarnings.length > 0);
        // Cleanup saves only a copy. The original is never changed.
        const oldOriginal = await fs.promises.readFile(source);
        const saved = await noOcr.save({ filePath: source, areas: [area] });
        assert(saved.path.includes("COMBINE_CLEANED"));
        assert((await fs.promises.readFile(source)).equals(oldOriginal));
        // Automatically cleaned downloads already include recognized names
        // in slider_manifest.json. Single-caption slides must inherit them too,
        // not only two-caption images.
        const autoFolder = path.join(root, "COMBINE_CLEANED");
        const auto = path.join(autoFolder, "001_auto_textclean.png");
        await fs.promises.copyFile(source, auto);
        await fs.promises.writeFile(path.join(root, "slider_manifest.json"), JSON.stringify({ images: [
            { path: source, width: 600, height: 600, cleanup: {
                cleanedPath: auto, captions: [{ text: "1.オフホワイト", x: 174, y: 540 }] } }
        ] }));
        const combine = new CombineService();
        const downloaded = await combine.addFiles([auto]);
        assert.equal(downloaded.images[0].suggestedLineup.mode, "single");
        assert.equal(downloaded.images[0].suggestedLineup.first, "オフホワイト");
        console.log("PASS: selected OCR from rectangle/brush, eraser protection, name mapping, Japanese numbering, OCR failure and original preservation");
    } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
