"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const sharp = require("sharp");

async function run() {
    const scratch = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bf-amazon-fast-integration-"));
    const input = path.join(scratch, "one.psd");
    await fs.promises.writeFile(input, Buffer.from("dummy PSD for Photoshop bridge simulation"));
    const image = await sharp({ create: { width: 350, height: 230, channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: { create: { width: 230, height: 140, channels: 4,
            background: { r: 220, g: 65, b: 45, alpha: 1 } } }, top: 35, left: 60 }])
        .png().toBuffer();
    const moduleId = require.resolve("../src/modules/amazon/main/photoshopBridge");
    let calls = 0;
    // Simulate real Photoshop extraction at the bridge boundary, leaving the
    // production image processor, image compositor and caching code intact.
    const oldModule = require.cache[moduleId];
    require.cache[moduleId] = {
        id: moduleId, filename: moduleId, loaded: true,
        exports: {
            extractPsdNoShadowToPng: async (_source, target) => {
                calls++;
                await fs.promises.writeFile(target, image);
            },
            convertFileToPng: async () => { throw new Error("unexpected fallback"); }
        }
    };
    try {
        const cache = require("../src/modules/amazon/main/psdFastCache").sharedPsdFastCache;
        cache.root = path.join(scratch, "cache");
        const { createPreviewDataUrl, processVariant } = require("../src/modules/amazon/main/imageProcessor");
        const preview = await createPreviewDataUrl(input);
        assert.equal(preview.cache, "MISS");
        assert.equal(calls, 1);
        const preview2 = await createPreviewDataUrl(input);
        assert.equal(preview2.cache, "HIT");
        const events = [];
        const result = await processVariant({ id: "BF-FAST-1", files: [{path: input, name: "one.psd"}] },
            path.join(scratch, "jpg"), path.join(scratch, "work"), data => events.push(data));
        assert.equal(calls, 1, "Generate must reuse preview's no-shadow PNG without reopening Photoshop");
        assert.equal(events.find(e => e.status === "source-ready")?.cache, "HIT");
        assert.equal(result.jpgs.length, 1);
        assert.equal(result.layers.length, 1);
        assert.equal((await sharp(result.jpgs[0]).metadata()).width, 1001);
        assert.equal((await sharp(result.layers[0].pngPath).metadata()).height, 1001);
        assert(events.some(e => e.status === "complete" && Number.isInteger(e.renderMs)));
        assert((await fs.promises.stat(input)).isFile(), "Source PSD must never be modified by cache/generation");
        console.log("PASS Amazon PSD integration: preview extraction once, repeated preview + JPG/PSD pipeline cache hits, timing events, original preserved.");
    } finally {
        if (oldModule) require.cache[moduleId] = oldModule;
        else delete require.cache[moduleId];
        await fs.promises.rm(scratch, { recursive: true, force: true });
    }
}
run().catch(err => { console.error(err); process.exitCode = 1; });
