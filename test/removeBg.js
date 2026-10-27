"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const sharp = require("sharp");
const { WORKFLOW_RULES } = require("../src/shared/workflowConfig");
const { RemoveBgProcessor, analyzePng } = require("../src/modules/remove-bg/main/processor");
const { outputPaths } = require("../src/modules/remove-bg/main/files");
const { jsxFromFile } = require("../src/modules/remove-bg/main/photoshopBridge");
const { sendProgressToRequestFrame } = require("../src/modules/remove-bg/main/ipc");

const transparentImage = () => sharp({
    create: { width: 120, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
}).composite([{
    input: { create: { width: 72, height: 83, channels: 4, background: { r: 10, g: 12, b: 14, alpha: 255 } } },
    left: 24, top: 26
}]).png().toBuffer();
const jpegImage = () => sharp({ create: {
    width: 120, height: 120, channels: 3, background: { r: 255, g: 255, b: 255 }
} }).jpeg().toBuffer();
const opaquePng = () => sharp({ create: {
    width: 120, height: 120, channels: 3, background: { r: 255, g: 255, b: 255 }
} }).png().toBuffer();

async function run() {
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "gws-remove-bg-test-"));
    const transparent = await transparentImage();
    const fakePsd = Buffer.concat([Buffer.from("8BPS"), Buffer.alloc(90, 1)]);
    let segmentationCalls = 0;
    let shadowCalls = 0;
    const processor = new RemoveBgProcessor({
        removeInPhotoshop: async (source, destination) => {
            segmentationCalls++;
            if (path.basename(source).startsWith("bad")) throw new Error("Simulated Photoshop segmentation failure");
            await fs.promises.writeFile(destination, transparent);
        },
        addShadowInPhotoshop: async (source, destination) => {
            shadowCalls++;
            if (path.basename(source).startsWith("three")) throw new Error("Simulated Photoshop PSD failure");
            assert.match(source, /\.png$/);
            await fs.promises.writeFile(destination, fakePsd);
        }
    });
    const write = (filename, data) => fs.promises.writeFile(path.join(tmp, filename), data);

    try {
        await Promise.all([
            write("one.jpg", await jpegImage()),
            write("bad.jpg", await jpegImage()),
            write("three.jpg", await jpegImage())
        ]);
        const paths = ["one.jpg", "bad.jpg", "three.jpg"].map(name => path.join(tmp, name));
        let registered = await processor.add(paths);
        assert.equal(registered.added.length, 3);
        assert.equal(registered.rejected.length, 0);
        assert.equal((await processor.add([paths[0]])).skipped.length, 1);
        const progress = [];
        const cutouts = await processor.batch("remove", paths, false, x => progress.push(x));
        assert.equal(cutouts.success, 2);
        assert.equal(cutouts.failed, 1);
        assert.equal(segmentationCalls, 3);
        assert.equal(progress.filter(x => x.status === "done").length, 2);
        assert.equal(progress.filter(x => x.status === "failed").length, 1);
        assert.equal(cutouts.results[1].status, "Remove BG Failed");
        assert.equal((await analyzePng(path.join(tmp, "one.png"))).width, 120);
        // Critical regression: after restarting the app, existing transparent
        // PNGs must appear as PNG Ready without running segmentation again.
        const reopened = new RemoveBgProcessor({
            removeInPhotoshop: async () => { throw new Error("Recovery must never re-run background removal."); },
            addShadowInPhotoshop: async () => { throw new Error("Not called until Add Shadow."); }
        });
        const recovered = await reopened.add(paths);
        assert.equal(recovered.added.filter(item => !!item.pngPath).length, 2);
        assert.equal(recovered.added.find(x => x.name === "bad.jpg").status, "Original");
        assert.equal(recovered.added.find(x => x.name === "one.jpg").status, "PNG Ready");
        assert.equal(reopened.getState().items.filter(x => !!x.pngPath).length, 2);
        assert.equal(fs.existsSync(path.join(tmp, "bad.png")), false);
        assert.equal(fs.existsSync(path.join(tmp, "one.psd")), false, "PSD must wait for separate Add Shadow click");
        assert.equal(fs.existsSync(path.join(tmp, "three.psd")), false);
        assert.equal((await fs.promises.readFile(paths[0])).equals(await jpegImage()), true, "source photo unchanged");

        const shadows = await processor.batch("shadow", paths, false);
        assert.equal(shadows.success, 1);
        assert.equal(shadows.failed, 1);
        assert.equal(shadowCalls, 2, "failed Remove BG must never attempt shadow");
        assert.equal(shadows.results[0].status, "Shadow Ready");
        assert.equal(shadows.results[1].status, "Shadow Failed");
        assert.equal(fs.existsSync(path.join(tmp, "one.psd")), true);
        assert.equal(fs.existsSync(path.join(tmp, "bad.psd")), false);
        assert.equal(fs.existsSync(path.join(tmp, "three.png")), true, "failed PSD does not delete PNG");
        assert.equal(segmentationCalls, 3, "Add Shadow must not run Remove Background again");
        assert.equal((await processor.batch("shadow", paths, false)).failed, 1, "shadow failure may be retried independently");
        assert.equal((await processor.batch("remove", paths, false)).failed, 1, "PNG success is not re-segmented");

        // Existing exports cannot silently be destroyed. Overwrite backs up.
        await write("existing.jpg", await jpegImage());
        await write("existing.png", Buffer.from("KEEP ORIGINAL EXPORT"));
        const ePath = path.join(tmp, "existing.jpg");
        await processor.add([ePath]);
        const denied = await processor.batch("remove", [ePath], false);
        assert.equal(denied.failed, 1);
        assert.equal((await fs.promises.readFile(path.join(tmp, "existing.png"))).toString(), "KEEP ORIGINAL EXPORT");
        const permitted = await processor.batch("remove", [ePath], true);
        assert.equal(permitted.success, 1);
        const backups = await fs.promises.readdir(path.join(tmp, "GWS Backups"));
        assert(backups.some(f => f.startsWith("existing.")));
        assert.equal((await analyzePng(path.join(tmp, "existing.png"))).hasTransparency, true);

        // Opaque input PNG automatically backs up its original during a same-name export.
        await write("same.png", await opaquePng());
        const samePath = path.join(tmp, "same.png");
        const originalOpaque = await fs.promises.readFile(samePath);
        await processor.add([samePath]);
        const replaced = await processor.batch("remove", [samePath], false);
        assert.equal(replaced.success, 1);
        assert.notEqual(replaced.results[0].originalPreviewPath, samePath, "Original QC must point to backup");
        assert.equal((await fs.promises.readFile(replaced.results[0].originalPreviewPath)).equals(originalOpaque), true);
        assert.equal((await analyzePng(samePath)).hasTransparency, true);

        // Already cut-out transparent PNG passes through; no Photoshop call.
        await write("transparent.png", transparent);
        const transparentPath = path.join(tmp, "transparent.png");
        const before = await fs.promises.readFile(transparentPath);
        await processor.add([transparentPath]);
        const calls = segmentationCalls;
        assert.equal(processor.getState().items.find(x => x.path === transparentPath).status, "PNG Ready");
        assert.equal((await processor.batch("remove", [transparentPath], false)).success, 0);
        assert.equal(segmentationCalls, calls);
        assert.equal((await fs.promises.readFile(transparentPath)).equals(before), true);

        // Two sources with the same same-folder basename would overwrite each other.
        await write("collision.jpg", await jpegImage());
        await write("collision.tif", Buffer.from("not accessed: registration checks extension and existence"));
        const collision = await processor.add([path.join(tmp, "collision.jpg"), path.join(tmp, "collision.tif")]);
        assert.equal(collision.added.length, 1);
        assert.equal(collision.rejected.length, 1);
        assert.match(collision.rejected[0].reason, /conflict/i);
        processor.removeFromQueue([path.join(tmp, "collision.jpg")]);

        // PSD source and PSD output have the same path. Always preserve source via backup.
        const mockSourcePsd = Buffer.concat([Buffer.from("8BPS"), Buffer.alloc(90, 27)]);
        await write("psd-source.psd", mockSourcePsd);
        const psdSource = path.join(tmp, "psd-source.psd");
        await processor.add([psdSource]);
        assert.equal((await processor.batch("remove", [psdSource], false)).success, 1);
        const psdReplaced = await processor.batch("shadow", [psdSource], false);
        assert.equal(psdReplaced.success, 1);
        assert.notEqual(psdReplaced.results[0].originalPreviewPath, psdSource);
        assert.equal((await fs.promises.readFile(psdReplaced.results[0].originalPreviewPath)).equals(mockSourcePsd), true);
        assert.equal((await fs.promises.readFile(psdSource)).equals(fakePsd), true);

        // Imported old transparent cutout must be shadowable without running
        // Remove Background, while the existing PNG remains byte-for-byte.
        await write("recovery.jpg", await jpegImage());
        await write("recovery.png", transparent);
        const recoverySource = path.join(tmp, "recovery.jpg");
        let recoveredShadowInput = "";
        const recoveryProcessor = new RemoveBgProcessor({
            removeInPhotoshop: async () => { throw new Error("Should reuse existing PNG"); },
            addShadowInPhotoshop: async (png, output) => {
                recoveredShadowInput = png;
                await fs.promises.writeFile(output, fakePsd);
            }
        });
        const pngBefore = await fs.promises.readFile(path.join(tmp, "recovery.png"));
        const reimported = await recoveryProcessor.add([recoverySource]);
        assert.equal(reimported.added[0].status, "PNG Ready");
        assert.equal((await recoveryProcessor.batch("remove", [recoverySource], false)).success, 0);
        assert.equal((await recoveryProcessor.batch("shadow", [recoverySource], false)).success, 1);
        assert.equal(recoveredShadowInput, path.join(tmp, "recovery.png"));
        assert((await fs.promises.readFile(path.join(tmp, "recovery.png"))).equals(pngBefore));
        assert.equal(fs.existsSync(path.join(tmp, "recovery.psd")), true);

        // Progress messages must target the invoking module iframe instead
        // of the top-level BrowserWindow. Destroyed frames are non-fatal.
        const delivered = [];
        const senderFrame = { isDestroyed: () => false, send: (...args) => delivered.push(args) };
        assert.equal(sendProgressToRequestFrame({ senderFrame, sender: { send: () => { throw Error("Wrong frame!"); } } }, { phase: "remove" }), true);
        assert.deepEqual(delivered, [["remove-bg:progress", { phase: "remove" }]]);
        assert.equal(sendProgressToRequestFrame({ senderFrame: { isDestroyed: () => true } }, {}), false);
        assert.equal(sendProgressToRequestFrame({ senderFrame: { send: () => { throw Error("Frame navigated"); } } }, {}), false);

        assert.equal(outputPaths(path.join(tmp, "bag01.jpg")).png, path.join(tmp, "bag01.png"));
        assert.equal(outputPaths(path.join(tmp, "bag01.jpg")).psd, path.join(tmp, "bag01.psd"));
        const allTmp = await fs.promises.readdir(tmp);
        assert(!allTmp.some(name => name.includes(".gws-")), "temporary export cleanup");

        const jpegText = fs.readFileSync(path.join(__dirname, "../src/modules/remove-bg/jsx/addShadow.jsx"), "utf8");
        assert(jpegText.includes('stringIDToTypeID("newPlacedLayer")'), "Main must be Smart Object");
        const sourceCutout = fs.readFileSync(path.join(__dirname, "../src/modules/remove-bg/jsx/removeBackground.jsx"), "utf8");
        assert(sourceCutout.includes("gwsHideEditableShadowLayers"), "do not bake PSD source shadow into PNG");
        assert(jpegText.includes("SelectionType.INTERSECT"), "lower silhouette must intersect real alpha");
        assert(!jpegText.includes("dropShadow"), "No generic Photoshop drop shadow");
        assert(jpegText.includes('shadow.name = "Shadow"'));
        assert(jpegText.includes('main.name = "Main"'));
        assert(jpegText.includes("gwsDoc.layers.length !== 2"));
        for (const name of ["addShadow.jsx", "removeBackground.jsx", "preview.jsx"]) {
            const code = fs.readFileSync(path.join(__dirname, "../src/modules/remove-bg/jsx", name), "utf8");
            new vm.Script(code, { filename: name });
        }
        const injected = jsxFromFile("addShadow.jsx", {
            GWS_LOWER_RATIO: WORKFLOW_RULES.slider.shadow.lowerRatio,
            GWS_BLUR: WORKFLOW_RULES.slider.shadow.blur,
            GWS_OPACITY: WORKFLOW_RULES.slider.shadow.opacity,
            GWS_OFFSET_X: WORKFLOW_RULES.slider.shadow.offsetX,
            GWS_OFFSET_Y: WORKFLOW_RULES.slider.shadow.offsetY
        });
        assert(injected.includes("var GWS_LOWER_RATIO = 0.5;"));
        assert(injected.includes("var GWS_BLUR = 5;"));
        assert(injected.includes("var GWS_OPACITY = 18;"));
        assert(injected.includes("var GWS_OFFSET_Y = 4;"));
        assert(injected.includes("var GWS_OFFSET_X = 0;"));
        const shell = fs.readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
        assert(shell.includes('data-page="remove-bg"'));
        assert(shell.includes('id="removeBgFrame"'));
        assert(shell.includes('data-open="slider"') && shell.includes('data-open="amazon"'));
        console.log("Remove Background + Shadow integration tests passed.");
    } finally {
        await fs.promises.rm(tmp, { recursive: true, force: true });
    }
}
run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
