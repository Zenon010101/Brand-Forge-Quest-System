"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const { readImageRecords, validateVirtualBatch } = require("../src/modules/amazon/main/batchWorkspace");
const { outputName } = require("../src/modules/amazon/shared/sharingPlan");

async function run() {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-amazon-batch-"));
    try {
        const files = path.join(root, "unsorted-source-files");
        const other = path.join(root, "other-images");
        const outputFolder = path.join(root, "outputs");
        await Promise.all([files, other, outputFolder].map(p => fs.promises.mkdir(p)));
        const sources = [];
        for (let i = 0; i < 8; i++) {
            const file = path.join(i % 2 ? other : files, `camera_image_${i + 45}.png`);
            await sharp({ create: { width: 280, height: 240, channels: 4, background: { r: 90 + i * 8, g: 35, b: 120, alpha: 1 } } }).png().toFile(file);
            sources.push(file);
        }
        const unrelated = path.join(files, "not-an-image.txt");
        await fs.promises.writeFile(unrelated, "notes");
        let inspected = await readImageRecords([sources[2], sources[0], sources[2], unrelated]);
        assert.deepStrictEqual(inspected.files.map(item => item.path), [sources[2], sources[0]]);
        assert.strictEqual(inspected.errors.length, 1);
        assert.strictEqual(inspected.files[0].name, path.basename(sources[2]));
        const groups = [
            { id: "APM-100", files: [sources[3], sources[0], sources[1]], sharedIds: ["APM-101", "APM-102"] },
            { id: "APM-200", files: [sources[6], sources[2]], sharedIds: [] }
        ];
        const request = { groups, outputFolder };
        let checked = await validateVirtualBatch(request);
        assert(checked.ok, checked.errors?.join("; "));
        assert.strictEqual(checked.plan.sourceCount, 2);
        assert.strictEqual(checked.plan.sharedCount, 2);
        assert.strictEqual(checked.plan.jpgCount, 11);
        assert.strictEqual(checked.parents[0].folderPath, null);
        assert.deepStrictEqual(checked.parents[0].variants[0].files.map(file => file.path), groups[0].files);

        const badCases = [
            [{ id: "MISSING", files: [], sharedIds: [] }],
            [{ id: "TOO-MANY", files: [...sources, sources[0]], sharedIds: [] }],
            [{ id: "BAD/ID", files: [sources[0]], sharedIds: [] }],
            [{ id: "FIRST", files: [sources[0], sources[0]], sharedIds: [] }],
            [{ id: "FIRST", files: [sources[0]], sharedIds: ["FIRST"] }],
            [{ id: "FIRST", files: [sources[0], sources[1]], sharedIds: ["FIRST_2"] }],
            [{ id: "FIRST", files: [sources[0]], sharedIds: ["SECOND"] }, { id: "SECOND", files: [sources[1]], sharedIds: [] }],
            [{ id: "MISSING-SOURCE", files: [path.join(root, "gone.png")], sharedIds: [] }]
        ];
        for (const batch of badCases) {
            const invalid = await validateVirtualBatch({ groups: batch });
            assert(!invalid.ok, `must reject invalid batch: ${JSON.stringify(batch).slice(0, 100)}`);
        }
        console.log("PASS source ingestion without folders/renaming, ordering, sharing counts, eight-image cap, filename collision, and invalid ID checks");

        // Reuse the actual 1.7.x sharing image-processing and publishing engine.
        // Only replace Photoshop PSD creation (unavailable on this test host).
        const psdPath = require.resolve("../src/modules/amazon/main/psdBuilder");
        const jobPath = require.resolve("../src/modules/amazon/main/sharedJob");
        require(psdPath);
        const oldPsdExports = require.cache[psdPath].exports;
        let createdGroups;
        require.cache[psdPath].exports = { buildAmazonPsd: async (_name, parentGroups, destination) => {
            createdGroups = parentGroups;
            await fs.promises.writeFile(destination, "MOCK PSD");
        } };
        delete require.cache[jobPath];
        try {
            const job = require(jobPath);
            const psdName = { baseName: "AMAZON_MASTER", fileName: "AMAZON_MASTER.psd" };
            const virtualPayload = { parents: checked.parents, outputFolder };
            let preflight = await job.inspectSharingRequest(virtualPayload, psdName);
            assert(preflight.ok, preflight.errors?.join("; "));
            assert.strictEqual(preflight.existingFiles.length, 0);
            const sent = [];
            const event = { senderFrame: { send: (_, progress) => sent.push(progress) } };
            const result = await job.processSharedAmazonJob(event, {
                ...virtualPayload, confirmedExistingFiles: []
            }, psdName, preflight);
            assert(result.ok && !result.masterPsdError);
            assert.strictEqual(result.sourceSuccessful, 2);
            assert.strictEqual(result.sharedSuccessful, 2);
            assert.strictEqual(result.successful, 4);
            assert.strictEqual(result.failed, 0);
            assert.strictEqual(result.results.flatMap(item => item.jpgs).length, 11);
            assert(fs.existsSync(path.join(outputFolder, "AMAZON_MASTER.psd")));
            assert(createdGroups);
            assert.deepStrictEqual(createdGroups[0].variants.map(variant => variant.variantId), ["APM-100", "APM-101", "APM-102", "APM-200"]);
            assert.deepStrictEqual(createdGroups[0].variants[0].layers.map(layer => layer.layerName), ["APM-100", "APM-100_2", "APM-100_3"]);
            assert.deepStrictEqual(createdGroups[0].variants[2].layers.map(layer => layer.layerName), ["APM-102", "APM-102_2", "APM-102_3"]);
            assert(sent.some(e => e.type === "shared-start"));
            for (let i = 1; i <= 3; i++) {
                const original = await fs.promises.readFile(path.join(outputFolder, outputName("APM-100", i)));
                for (const id of ["APM-101", "APM-102"]) {
                    assert.deepStrictEqual(await fs.promises.readFile(path.join(outputFolder, outputName(id, i))), original);
                }
                const metadata = await sharp(original).metadata();
                assert.strictEqual(metadata.width, 1001);
                assert.strictEqual(metadata.height, 1001);
            }
            const primary = await fs.promises.readFile(path.join(outputFolder, "APM-100.jpg"));
            const second = await fs.promises.readFile(path.join(outputFolder, "APM-100_2.jpg"));
            assert.notDeepStrictEqual(primary, second, "reordered source image must become the correct Amazon image #1");
            const { prepareColorboxPlan, exportColorboxes } = require("../src/modules/amazon/main/colorboxExporter");
            const colorFolder = path.join(root, "colorboxes");
            await fs.promises.mkdir(colorFolder);
            const items = result.results.map(r => ({ parentId: r.parentId, variantId: r.variantId, sourcePath: r.jpgs[0] }));
            const colorPlan = await prepareColorboxPlan(items, colorFolder, result.results.flatMap(r => r.jpgs));
            const color = await exportColorboxes(colorPlan, { overwrite: false });
            assert.strictEqual(color.successful, 4);
            for (const id of ["APM-100", "APM-101", "APM-102", "APM-200"]) {
                assert.deepStrictEqual(await fs.promises.readFile(path.join(colorFolder, `${id.toLowerCase()}clr.jpg`)),
                    await fs.promises.readFile(path.join(outputFolder, `${id}.jpg`)));
            }
            // Same-folder output protection: original source image filename may
            // equal a planned Amazon result, but this is NEVER auto-overwritten.
            const overwriteInput = path.join(outputFolder, "SOURCE.jpg");
            await fs.promises.writeFile(overwriteInput, "ORIGINAL SOURCE");
            const unsafe = await validateVirtualBatch({ groups: [{ id: "SOURCE", files: [overwriteInput], sharedIds: [] }] });
            assert(unsafe.ok);
            const unsafePreflight = await job.inspectSharingRequest({ parents: unsafe.parents, outputFolder }, psdName);
            assert(!unsafePreflight.ok && unsafePreflight.errors.some(e => e.includes("source image")));
            // All original source files must still exist with identical bytes.
            for (const source of sources) assert(fs.existsSync(source));
            preflight = await job.inspectSharingRequest(virtualPayload, psdName);
            assert.strictEqual(preflight.existingFiles.length, 12);
            const rejected = await job.processSharedAmazonJob(event, { ...virtualPayload, confirmedExistingFiles: [] }, psdName, preflight);
            assert(!rejected.ok && /overwrite approval/i.test(rejected.error));
            console.log("PASS 2 independent image sets + 2 shared IDs, 11 final JPGs, master PSD, original file protection, and Image 1 Colorbox source");
        } finally {
            require.cache[psdPath].exports = oldPsdExports;
            delete require.cache[jobPath];
        }
        const page = fs.readFileSync(path.join(__dirname, "../src/modules/amazon/renderer/index.html"), "utf8");
        for (const id of ["batchModeTab", "batchDropZone", "batchBulkIds", "batchGroupList", "batchImagePool", "batchOrderList", "batchSharedIds", "batchGenerateBtn"]) {
            assert(page.includes(`id="${id}"`), `missing UI control ${id}`);
        }
        assert(page.includes('src="batchWorkspace.js"'));
        console.log("PASS new Folderless UI mounted beside unchanged Folder Mode");
    } finally {
        await fs.promises.rm(root, { recursive: true, force: true });
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
