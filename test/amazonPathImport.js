"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const { scanBatchImageFolder, normalizedFolderPath } = require("../src/modules/amazon/main/batchImageScanner");
const filters = require("../src/modules/amazon/shared/imageFilters");
const { createOrderedSelection } = require("../src/modules/amazon/shared/selectionOrder");
const { validateVirtualBatch } = require("../src/modules/amazon/main/batchWorkspace");

async function run() {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-path-import-"));
    try {
        const images = path.join(root, "MY SOURCE IMAGES");
        const nested = path.join(images, "NESTED");
        await fs.promises.mkdir(nested, { recursive: true });
        const original = ["01_main.jpg", "02_top.PNG", "03_side.psd", "04_detail.webp", "05_extra.tiff", "10_back.jpeg"];
        for (const name of original) {
            const dest = path.join(images, name);
            if (/\.(png|jpg|jpeg|webp|tiff)$/i.test(name)) {
                const img = sharp({ create: { width: 40, height: 50, channels: 3, background: { r: name.length * 4, g: 90, b: 30 } } });
                await (name.toLowerCase().endsWith(".png") ? img.png() : name.toLowerCase().endsWith(".webp") ? img.webp() : name.toLowerCase().endsWith(".tiff") ? img.tiff() : img.jpeg()).toFile(dest);
            } else await fs.promises.writeFile(dest, "PSD INPUT PLACEHOLDER");
        }
        for (const [name, dir] of [["notes.txt", images], [".hidden.png", images], ["~$temp.png", images], ["nested_1.psb", nested], ["nested_2.bmp", nested]]) {
            await fs.promises.writeFile(path.join(dir, name), "SAMPLE");
        }
        const full = await scanBatchImageFolder(`"${images}"`, { format: "all", recursive: false });
        assert.strictEqual(full.folderPath, normalizedFolderPath(images));
        assert.deepStrictEqual(full.files.map(f => f.name), original, "natural 1,2,3,4,5,10 filename order");
        assert.strictEqual(full.scannedFolders, 1);
        assert.strictEqual(full.errors.length, 0);
        const allRecursive = await scanBatchImageFolder(images, { format: "all", recursive: true });
        assert.strictEqual(allRecursive.files.length, 8);
        assert.strictEqual(allRecursive.scannedFolders, 2);
        assert(allRecursive.files.some(f => f.relativePath.includes("NESTED")));
        const png = await scanBatchImageFolder(images, { format: "png", recursive: true });
        assert.deepStrictEqual(png.files.map(f => f.name), ["02_top.PNG"]);
        const psd = await scanBatchImageFolder(images, { format: "psd", recursive: true });
        assert.deepStrictEqual(psd.files.map(f => f.name), ["03_side.psd"]);
        const psb = await scanBatchImageFolder(images, { format: "psb", recursive: true });
        assert.deepStrictEqual(psb.files.map(f => f.name), ["nested_1.psb"]);
        const jpeg = await scanBatchImageFolder(images, { format: "jpg", recursive: true });
        assert.deepStrictEqual(jpeg.files.map(f => f.name), ["01_main.jpg", "10_back.jpeg"]);
        assert(filters.matchesExtension(".PNG", "png"));
        assert(!filters.matchesExtension(".PSD", "png"));
        await assert.rejects(scanBatchImageFolder("relative-folder", {}), /absolute/);
        await assert.rejects(scanBatchImageFolder(images, { format: "exe" }), /Unknown source-image/);
        await assert.rejects(scanBatchImageFolder(path.join(root, "does-not-exist")), /ENOENT/);
        console.log("PASS pasteable absolute path, nested scan toggle, natural image order, PNG / PSD / PSB / JPG / other file filters, invalid path protection");

        // UI selection order is independent of the library/filename/filter order.
        const selection = createOrderedSelection(8);
        const byName = new Map(full.files.map(f => [f.name, f]));
        const key = name => byName.get(name).path.replace(/\\/g, "/").toLowerCase();
        const targetNames = ["04_detail.webp", "01_main.jpg", "02_top.PNG", "10_back.jpeg"];
        for (const name of targetNames) assert(selection.toggle(key(name)).ok);
        assert.deepStrictEqual(selection.values(), targetNames.map(key));
        assert.strictEqual(selection.position(key("04_detail.webp")), 1);
        assert.strictEqual(selection.position(key("01_main.jpg")), 2);
        // Switching a Library type filter must not mutate selection order.
        assert.deepStrictEqual(full.files.filter(f => filters.matchesFile(f, "psd")).map(f => f.name), ["03_side.psd"]);
        assert.deepStrictEqual(selection.values(), targetNames.map(key));
        const picked = selection.values().map(k => full.files.find(f => f.path.toLowerCase() === k));
        const batch = await validateVirtualBatch({ groups: [{ id: "APM-100", files: picked, sharedIds: ["APM-101"] }] });
        assert(batch.ok, batch.errors?.join("\n"));
        assert.deepStrictEqual(batch.parents[0].variants[0].files.map(f => f.name), targetNames);
        assert.strictEqual(batch.plan.jpgCount, 8); // 4 distinct images for each of 2 IDs
        // Deselecting then choosing the same image again moves it to the end.
        assert(selection.toggle(key("01_main.jpg")).ok);
        assert(selection.toggle(key("01_main.jpg")).ok);
        assert.deepStrictEqual(selection.values(), [key("04_detail.webp"), key("02_top.PNG"), key("10_back.jpeg"), key("01_main.jpg")]);
        selection.clear();
        for (let i = 0; i < 8; i++) assert(selection.toggle(`item-${i}`).ok);
        assert.strictEqual(selection.toggle("item-8").ok, false, "up to eight picks are allowed");
        assert.strictEqual(selection.size, 8);
        selection.prune(new Set(["item-6", "item-1"]));
        assert.deepStrictEqual(selection.values(), ["item-1", "item-6"]);
        console.log("PASS exact click sequence across library filters, one-to-eight limit, deselect/reselect, shared-ID output order and source validation");

        // Cross-module integration points must exist in the shipped renderer.
        const html = await fs.promises.readFile(path.join(__dirname, "../src/modules/amazon/renderer/index.html"), "utf8");
        const renderer = await fs.promises.readFile(path.join(__dirname, "../src/modules/amazon/renderer/batchWorkspace.js"), "utf8");
        const preload = await fs.promises.readFile(path.join(__dirname, "../src/main/preload.js"), "utf8");
        const register = await fs.promises.readFile(path.join(__dirname, "../src/modules/amazon/main/register.js"), "utf8");
        for (const id of ["batchSourcePath", "batchBrowseSourceBtn", "batchScanFolderBtn", "batchScanFormat", "batchIncludeSubfolders", "batchLibraryFilter", "batchSelectionPreview", "batchClearSelectionBtn"]) {
            assert(html.includes(`id="${id}"`), `Amazon UI missing ${id}`);
        }
        assert(html.includes('src="../shared/selectionOrder.js"'));
        assert(html.includes('src="../shared/imageFilters.js"'));
        assert(renderer.includes("selectedPool.values().map(key => pool.get(key)?.path)"), "Add must use selection order, not pool order");
        assert(preload.includes("scanImageFolder:") && preload.includes("chooseImageFolder:"));
        assert(register.includes('amazon:scan-image-folder') && register.includes('amazon:choose-image-folder'));
        assert(html.includes("Original Folder Mode") && html.includes("Batch Workspace"));
        assert(!html.includes('id="batchSmartFolderBtn"') && !html.includes('id="smartFolderBackdrop"'), "Removed Smart Folder Import UI must not reappear");
        assert(!preload.includes("chooseSmartFolder") && !preload.includes("refreshSmartFolder"), "Smart Folder IPC must not remain exposed");
        assert(!register.includes('amazon:choose-smart-folder') && !register.includes('amazon:refresh-smart-folder'), "Smart Folder IPC handlers must be unregistered");
        assert(html.includes('id="batchShareImagesBtn"') && html.includes('id="batchScanFolderBtn"'), "Keep Share Images and direct path scanner");
        console.log("PASS Electron IPC, file filters, pick-order badges, Batch Workspace and Folder Mode; Smart Folder Import absent");
    } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
}
run().catch(err => { console.error(err); process.exitCode = 1; });
