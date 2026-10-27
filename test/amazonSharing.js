"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const rules = require("../src/modules/amazon/shared/sharingPlan");
const { publishGroup, preflightDestinations } = require("../src/modules/amazon/main/sharedExporter");

function source(id, files = 5, sharedIds = []) {
    return { id, files: Array.from({ length: files }, (_, i) => ({ name: `${i + 1}.png`, path: `/tmp/mock_${id}_${i}.png` })), sharedIds };
}
function planFor(...variants) {
    return rules.buildSharingPlan([{ id: "BRAND", variants }]);
}

function testIds() {
    assert.deepStrictEqual(rules.parseSharedIds(" A\r\nB,C;D\t E\n\n"), ["A", "B", "C", "D", "E"]);
    const normal = planFor(source("DPK100", 5, ["DPK101", "DPK102"]));
    assert.strictEqual(normal.ok, true, normal.errors.join("; "));
    assert.strictEqual(normal.sourceCount, 1);
    assert.strictEqual(normal.sharedCount, 2);
    assert.strictEqual(normal.jpgCount, 15);
    assert(normal.outputFiles.includes("DPK100_5.jpg"));
    assert(normal.outputFiles.includes("DPK101.jpg"));
    assert(normal.outputFiles.includes("DPK102_5.jpg"));
    assert.strictEqual(planFor(source("DPK100", 2, ["dpk100"])).ok, false);
    assert.strictEqual(planFor(source("DPK100", 2, ["DPK101", "dpk101"])).ok, false);
    assert.strictEqual(planFor(source("DPK100", 5, ["DPK100_2"])).ok, false,
        "must catch collision between source image 2 and shared image 1");
    assert.strictEqual(planFor(source("DPK100", 5), source("DPK100_3", 2, ["DPK200"])).ok, false,
        "must reject collisions between two selected source IDs too");
    assert.strictEqual(rules.buildSharingPlan([{ id: "B", variants: [source("SRC", 1, ["UNSELECTED"]) ] }], {
        reservedVariantIds: ["UNSELECTED"]
    }).ok, false, "unselected physical folder ID cannot become virtual shared ID");
    for (const id of ["CON", "NUL.txt", "..", "a/b", "a?b", "a.", " bad", "bad ", "", "a".repeat(151)]) {
        assert(rules.validId(id), `should reject ${JSON.stringify(id)}`);
    }
    assert.strictEqual(rules.validId("NMS224-A"), null);
    assert.strictEqual(planFor(source("ABC", 1, ["CON"])).ok, false);
    assert.strictEqual(planFor(source("ABC", 1, Array.from({ length: 201 }, (_, i) => `A${i}`))).ok, false);
    const two = planFor(source("SRC", 2, ["A", "B"]), source("SECOND", 3, ["C"]));
    assert.strictEqual(two.totalVariants, 5);
    assert.strictEqual(two.jpgCount, 12);
    console.log("PASS multi-ID parsing, validation, collisions, output names and counts");
}

async function makeProduct(file) {
    const svg = Buffer.from('<svg width="200" height="200"><rect x="20" y="20" width="160" height="160" fill="red" /></svg>');
    await sharp(svg).png().toFile(file);
}
async function fixture() {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "amazon-share-test-"));
    const parentFolder = path.join(root, "BRAND");
    const sourceFolder = path.join(parentFolder, "SRC");
    const otherFolder = path.join(parentFolder, "UNSELECTED");
    const outputFolder = path.join(root, "output");
    await Promise.all([sourceFolder, otherFolder, outputFolder].map(dir => fs.promises.mkdir(dir, { recursive: true })));
    const image1 = path.join(sourceFolder, "1.png");
    const image2 = path.join(sourceFolder, "2.png");
    await makeProduct(image1);
    await makeProduct(image2);
    const params = {
        parents: [{ id: "BRAND", folderPath: parentFolder, variants: [{
            id: "SRC", files: [{ path: image1, name: "1.png" }, { path: image2, name: "2.png" }],
            sharedIds: ["SH1", "SH2"]
        }] }], outputFolder, psdFileName: "MASTER"
    };
    return { root, parentFolder, sourceFolder, outputFolder, params };
}

async function testPreflight() {
    const data = await fixture();
    try {
        const plan = rules.buildSharingPlan(data.params.parents);
        const prepared = await preflightDestinations(plan, data.outputFolder, "MASTER.psd", [
            data.params.parents[0].variants[0].files[0].path
        ]);
        assert(prepared.ok);
        assert.deepStrictEqual(prepared.existingFiles, []);
        await fs.promises.writeFile(path.join(data.outputFolder, "SH1.jpg"), "old shared file");
        await fs.promises.writeFile(path.join(data.outputFolder, "MASTER.psd"), "old psd");
        const hasOld = await preflightDestinations(plan, data.outputFolder, "MASTER.psd", []);
        assert(hasOld.ok);
        assert.deepStrictEqual(hasOld.existingFiles, ["SH1.jpg", "MASTER.psd"]);
        const conflictInput = path.join(data.outputFolder, "SRC.jpg");
        await fs.promises.writeFile(conflictInput, "original input");
        const unsafe = await preflightDestinations(plan, data.outputFolder, "MASTER.psd", [conflictInput]);
        assert(!unsafe.ok && unsafe.errors.some(e => e.includes("source image")));
        const folderConflict = path.join(data.outputFolder, "SH2.jpg");
        await fs.promises.mkdir(folderConflict);
        const unsafe2 = await preflightDestinations(plan, data.outputFolder, "MASTER.psd", []);
        assert(!unsafe2.ok && unsafe2.errors.some(e => e.includes("not a regular file")));
        console.log("PASS source protection, existing output preflight, folder conflicts");
    } finally { await fs.promises.rm(data.root, { recursive: true, force: true }); }
}

async function testPublishing() {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "amazon-share-publish-"));
    try {
        const out = path.join(root, "out");
        const stage = path.join(root, "stage");
        const backup = path.join(stage, "backup");
        await fs.promises.mkdir(out);
        await fs.promises.mkdir(stage);
        const prior = path.join(out, "A.jpg");
        await fs.promises.writeFile(prior, "ORIGINAL");
        const staged = path.join(stage, "a.jpg");
        await fs.promises.writeFile(staged, "NEW");
        await assert.rejects(publishGroup([{ staged, name: "A.jpg" }], {
            backupFolder: backup, outputFolder: out, confirmedExistingPaths: []
        }), /approved/);
        assert.strictEqual(await fs.promises.readFile(prior, "utf8"), "ORIGINAL");
        const published = await publishGroup([{ staged, name: "A.jpg" }], {
            backupFolder: backup, outputFolder: out, confirmedExistingPaths: ["A.jpg"]
        });
        assert.deepStrictEqual(published, [prior]);
        assert.strictEqual(await fs.promises.readFile(prior, "utf8"), "NEW");

        // Windows Google Drive reports ESIDR for NTFS hardlinks and EXDEV for
        // cross-volume renames. Neither syscall may be needed by publishing.
        const originalLink = fs.promises.link;
        const originalRename = fs.promises.rename;
        fs.promises.link = async () => {
            throw Object.assign(new Error("Google Drive does not support hard links"), { code: "ESIDR" });
        };
        fs.promises.rename = async () => {
            throw Object.assign(new Error("Cross-volume rename denied"), { code: "EXDEV" });
        };
        try {
            const portable = path.join(stage, "portable.jpg");
            await fs.promises.writeFile(portable, "PORTABLE");
            await publishGroup([{ staged: portable, name: "PORTABLE.jpg" }], {
                backupFolder: backup, outputFolder: out, confirmedExistingPaths: []
            });
            assert.strictEqual(await fs.promises.readFile(path.join(out, "PORTABLE.jpg"), "utf8"), "PORTABLE");
            const updated = path.join(stage, "updated.jpg");
            await fs.promises.writeFile(updated, "UPDATED PORTABLE");
            await publishGroup([{ staged: updated, name: "PORTABLE.jpg" }], {
                backupFolder: backup, outputFolder: out, confirmedExistingPaths: ["PORTABLE.jpg"]
            });
            assert.strictEqual(await fs.promises.readFile(path.join(out, "PORTABLE.jpg"), "utf8"), "UPDATED PORTABLE");
        } finally {
            fs.promises.link = originalLink;
            fs.promises.rename = originalRename;
        }

        // Force a second-file publishing failure and ensure the first JPG in
        // that same ID is restored (including a previously existing JPG).
        await fs.promises.writeFile(prior, "ORIGINAL 2");
        const stage1 = path.join(stage, "s1.jpg");
        const stage2 = path.join(stage, "s2.jpg");
        await fs.promises.writeFile(stage1, "replaced");
        await fs.promises.writeFile(stage2, "second file");
        const originalOpen = fs.promises.open;
        fs.promises.open = async (file, flags, ...rest) => {
            if (file === path.join(out, "B.jpg") && flags === "wx") {
                throw Object.assign(new Error("Injected failure"), { code: "EIO" });
            }
            return originalOpen(file, flags, ...rest);
        };
        try {
            await assert.rejects(publishGroup([
                { staged: stage1, name: "A.jpg" }, { staged: stage2, name: "B.jpg" }
            ], { backupFolder: backup, outputFolder: out, confirmedExistingPaths: ["A.jpg"] }), /Injected failure/);
        } finally { fs.promises.open = originalOpen; }
        assert.strictEqual(await fs.promises.readFile(prior, "utf8"), "ORIGINAL 2");
        assert.strictEqual(fs.existsSync(path.join(out, "B.jpg")), false);

        // A mid-copy error must remove the new output and restore the old
        // output. This exercises the OS-level copy path used on shared drives.
        const originalCopy = fs.promises.copyFile;
        fs.promises.copyFile = async (from, to, ...args) => {
            if (from === stage2 && to === path.join(out, "B.jpg")) {
                await fs.promises.writeFile(to, "PARTIAL");
                throw Object.assign(new Error("Injected partial shared-drive copy"), { code: "EACCES" });
            }
            return originalCopy(from, to, ...args);
        };
        try {
            await assert.rejects(publishGroup([
                { staged: stage1, name: "A.jpg" }, { staged: stage2, name: "B.jpg" }
            ], { backupFolder: backup, outputFolder: out, confirmedExistingPaths: ["A.jpg"],
                retryPolicy: { verifyDelaysMs: [0], copyAttempts: 1 }
            }), /Injected partial shared-drive copy/);
        } finally { fs.promises.copyFile = originalCopy; }
        assert.strictEqual(await fs.promises.readFile(prior, "utf8"), "ORIGINAL 2");
        assert.strictEqual(fs.existsSync(path.join(out, "B.jpg")), false);
        console.log("PASS Google Drive link/rename compatibility, explicit overwrites, partial-write cleanup and per-ID rollback");
    } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
}

async function testSharedDrivePublishVerification() {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "amazon-drive-checks-"));
    try {
        const out = path.join(root, "out");
        const stage = path.join(root, "stage");
        const backup = path.join(stage, "backup");
        await fs.promises.mkdir(out);
        await fs.promises.mkdir(stage);
        const source = path.join(stage, "source.jpg");
        const target = path.join(out, "STATS.jpg");
        await fs.promises.writeFile(source, Buffer.from("this content was copied correctly and completely"));
        const opts = (extra = {}) => ({ outputFolder: out, backupFolder: backup,
            confirmedExistingPaths: [], retryPolicy: { verifyDelaysMs: [0, 1, 1], copyAttempts: 2 }, ...extra });

        // Reproduce the exact v1.7.1 problem: the provider returns stale
        // file size metadata AFTER the write, even though the bytes are OK.
        const statOriginal = fs.promises.stat;
        let wrongStats = 0;
        fs.promises.stat = async (file, ...args) => {
            const real = await statOriginal(file, ...args);
            if (file === target) {
                wrongStats++;
                return { ...real, size: real.size - 1, isFile: () => true };
            }
            return real;
        };
        try {
            await publishGroup([{ staged: source, name: "STATS.jpg" }], opts());
        } finally { fs.promises.stat = statOriginal; }
        assert.deepStrictEqual(await fs.promises.readFile(target), await fs.promises.readFile(source));
        // v1.7.1 used an immediate stat after every copy; the current
        // implementation verifies actual readback instead of trusting it.
        assert.strictEqual(wrongStats, 0, "publisher should not depend on output stat metadata");

        // Google Drive can briefly show an incomplete/old read. Wait for the
        // real bytes to be visible instead of immediately failing the ID.
        let staleReads = 0;
        const target2 = path.join(out, "VISIBILITY.jpg");
        const streamOriginal = fs.createReadStream;
        fs.createReadStream = (file, ...args) => {
            if (file === target2 && staleReads++ < 2) {
                return require("stream").Readable.from([Buffer.from("STALE")]);
            }
            return streamOriginal(file, ...args);
        };
        try {
            await publishGroup([{ staged: source, name: "VISIBILITY.jpg" }], opts());
        } finally { fs.createReadStream = streamOriginal; }
        assert.strictEqual(staleReads, 3);
        assert.deepStrictEqual(await fs.promises.readFile(target2), await fs.promises.readFile(source));

        // Simulate Google Drive accepting a write that stores only part of
        // the JPG. A recopy must happen and the final file must match.
        const target3 = path.join(out, "RETRY.jpg");
        const copyOriginal = fs.promises.copyFile;
        let copies = 0;
        fs.promises.copyFile = async (from, to, ...args) => {
            if (from === source && to === target3 && ++copies === 1) {
                await fs.promises.writeFile(to, Buffer.from("INCOMPLETE"));
                return;
            }
            return copyOriginal(from, to, ...args);
        };
        try {
            await publishGroup([{ staged: source, name: "RETRY.jpg" }], opts());
        } finally { fs.promises.copyFile = copyOriginal; }
        assert.strictEqual(copies, 2);
        assert.deepStrictEqual(await fs.promises.readFile(target3), await fs.promises.readFile(source));

        // A genuine same-size corruption is NOT success. After retries are
        // exhausted, both prior files and other outputs in this ID must roll
        // back; no invalid JPG can remain in the final folder.
        const prior = path.join(out, "OLD.jpg");
        await fs.promises.writeFile(prior, "BEFORE");
        const bad = path.join(out, "CORRUPT.jpg");
        fs.promises.copyFile = async (from, to, ...args) => {
            if (from === source && to === bad) {
                await fs.promises.writeFile(to, Buffer.alloc((await fs.promises.readFile(source)).length, 88));
                return;
            }
            return copyOriginal(from, to, ...args);
        };
        try {
            await assert.rejects(publishGroup([
                { staged: source, name: "OLD.jpg" }, { staged: source, name: "CORRUPT.jpg" }
            ], opts({ confirmedExistingPaths: ["OLD.jpg"] })), /verification failed|could not be verified/);
        } finally { fs.promises.copyFile = copyOriginal; }
        assert.strictEqual(await fs.promises.readFile(prior, "utf8"), "BEFORE");
        assert.strictEqual(fs.existsSync(bad), false);

        // Retain the fallback for virtual providers which reject copyFile.
        const fallback = path.join(out, "FALLBACK.jpg");
        fs.promises.copyFile = async (from, to, ...args) => {
            if (from === source && to === fallback) {
                throw Object.assign(new Error("Unsupported copy operation"), { code: "EXDEV" });
            }
            return copyOriginal(from, to, ...args);
        };
        try {
            await publishGroup([{ staged: source, name: "FALLBACK.jpg" }], opts());
        } finally { fs.promises.copyFile = copyOriginal; }
        assert.deepStrictEqual(await fs.promises.readFile(fallback), await fs.promises.readFile(source));
        console.log("PASS stale Drive size metadata, delayed file visibility, partial-copy recovery, corruption rollback, and copy fallback");
    } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
}

async function withMockPhotoshop(fn) {
    const modulePath = require.resolve("../src/modules/amazon/main/psdBuilder");
    const jobPath = require.resolve("../src/modules/amazon/main/sharedJob");
    require(modulePath);
    const previous = require.cache[modulePath].exports;
    const calls = [];
    let shouldFail = false;
    require.cache[modulePath].exports = {
        buildAmazonPsd: async (name, groups, dst) => {
            calls.push({ name, groups });
            if (shouldFail) throw new Error("Simulated Photoshop PSD failure");
            await fs.promises.writeFile(dst, "FAKE PSD TEST ARTIFACT");
        }
    };
    delete require.cache[jobPath];
    const job = require(jobPath);
    try { await fn(job, calls, value => { shouldFail = value; }); }
    finally { require.cache[modulePath].exports = previous; delete require.cache[jobPath]; }
}

async function testIntegration() {
    await withMockPhotoshop(async (job, calls, setFail) => {
        const data = await fixture();
        try {
            const psdName = { baseName: "MASTER", fileName: "MASTER.psd" };
            const event = { sender: { send() {}, isDestroyed() { return false; } } };
            const inspect = async () => job.inspectSharingRequest(data.params, psdName);
            let inspected = await inspect();
            assert(inspected.ok, inspected.errors?.join("; "));
            assert.strictEqual(inspected.sharedCount, 2);
            assert.strictEqual(inspected.sourceCount, 1);
            const result = await job.processSharedAmazonJob(event, {
                ...data.params, confirmedExistingFiles: []
            }, psdName, inspected);
            assert(result.ok);
            assert.strictEqual(result.successful, 3);
            assert.strictEqual(result.failed, 0);
            assert.strictEqual(result.sourceSuccessful, 1);
            assert.strictEqual(result.sharedSuccessful, 2);
            assert.strictEqual(result.results.reduce((sum, r) => sum + r.jpgs.length, 0), 6);
            for (let i = 1; i <= 2; i++) {
                const master = await fs.promises.readFile(path.join(data.outputFolder, rules.outputName("SRC", i)));
                for (const id of ["SH1", "SH2"]) {
                    const copy = await fs.promises.readFile(path.join(data.outputFolder, rules.outputName(id, i)));
                    assert.deepStrictEqual(copy, master, `${id} must be a byte-exact copy`);
                }
                const meta = await sharp(master).metadata();
                assert.strictEqual(meta.width, 1001);
                assert.strictEqual(meta.height, 1001);
            }
            assert.strictEqual(calls.length, 1, "Photoshop PSD builder called exactly once");
            const variants = calls[0].groups[0].variants;
            assert.deepStrictEqual(variants.map(v => v.variantId), ["SRC", "SH1", "SH2"]);
            assert.deepStrictEqual(variants[1].layers.map(v => v.layerName), ["SH1", "SH1_2"]);
            assert.strictEqual(variants[1].layers[0].pngPath, variants[0].layers[0].pngPath,
                "shared PSD layers must reuse the source PNG asset");
            assert.strictEqual(await fs.promises.readFile(result.masterPsdPath, "utf8"), "FAKE PSD TEST ARTIFACT");
            assert.deepStrictEqual((await fs.promises.readdir(data.outputFolder)).filter(n => n.startsWith(".amazon-sharing-stage")), [], "temporary files must not be staged in the output drive");

            const { prepareColorboxPlan, exportColorboxes } = require("../src/modules/amazon/main/colorboxExporter");
            const colorFolder = path.join(data.root, "colorbox");
            await fs.promises.mkdir(colorFolder);
            const items = result.results.map(r => ({ parentId: r.parentId, variantId: r.variantId, sourcePath: r.jpgs[0] }));
            const plan = await prepareColorboxPlan(items, colorFolder, result.results.flatMap(r => r.jpgs));
            const colorResult = await exportColorboxes(plan, { overwrite: false });
            assert.strictEqual(colorResult.successful, 3);
            const clr = await fs.promises.readFile(path.join(colorFolder, "sh1clr.jpg"));
            assert.deepStrictEqual(clr, await fs.promises.readFile(path.join(data.outputFolder, "SH1.jpg")));

            // Already-existing outputs must not be replaced if user did not confirm them.
            inspected = await inspect();
            assert.strictEqual(inspected.existingFiles.length, 7);
            const denied = await job.processSharedAmazonJob(event, {
                ...data.params, confirmedExistingFiles: []
            }, psdName, inspected);
            assert(!denied.ok && denied.error.includes("overwrite approval"));
            assert.strictEqual((await fs.promises.readFile(path.join(data.outputFolder, "SH1.jpg"))).length, clr.length);

            // Re-running with full confirmation works without clobbering unrelated files.
            const sentinel = path.join(data.outputFolder, "UNRELATED.jpg");
            await fs.promises.writeFile(sentinel, "untouched");
            const second = await job.processSharedAmazonJob(event, {
                ...data.params, confirmedExistingFiles: inspected.existingFiles
            }, psdName, inspected);
            assert.strictEqual(second.successful, 3);
            assert.strictEqual(await fs.promises.readFile(sentinel, "utf8"), "untouched");

            // PSD errors keep original PSD (and the new JPGs) unchanged.
            setFail(true);
            const psdBefore = await fs.promises.readFile(path.join(data.outputFolder, "MASTER.psd"));
            const psdError = await job.processSharedAmazonJob(event, {
                ...data.params, confirmedExistingFiles: inspected.existingFiles
            }, psdName, inspected);
            assert(psdError.masterPsdError && psdError.masterPsdError.includes("Simulated"));
            assert.strictEqual(psdError.successful, 3);
            assert.deepStrictEqual(await fs.promises.readFile(path.join(data.outputFolder, "MASTER.psd")), psdBefore);
            console.log("PASS actual 1001 JPG render, shared byte-copy, PSD layer reuse, Colorbox, overwrite approval, PSD failure safety");
        } finally { await fs.promises.rm(data.root, { recursive: true, force: true }); }
    });
}

async function testExactReportedLateImageBatch() {
    await withMockPhotoshop(async (job, calls) => {
        const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "amazon-late-image-"));
        try {
            const brand = path.join(root, "APOM");
            const out = path.join(root, "final");
            await fs.promises.mkdir(brand);
            await fs.promises.mkdir(out);
            const variants = [];
            const cases = [
                ["APM-90200-JP", 6, ["APM-90300-JP", "APM-90400-JP", "APM-90500-JP", "APM-90600-JP"]],
                ["APM-90202-JP", 5, ["APM-90302-JP", "APM-90402-JP", "APM-90502-JP", "APM-90602-JP"]]
            ];
            for (const [id, count, sharedIds] of cases) {
                const folder = path.join(brand, id);
                await fs.promises.mkdir(folder);
                const files = [];
                for (let i = 1; i <= count; i++) {
                    const file = path.join(folder, `${i}.png`);
                    await makeProduct(file);
                    files.push({ name: `${i}.png`, path: file });
                }
                variants.push({ id, files, sharedIds });
            }
            const params = { parents: [{ id: "APOM", folderPath: brand, variants }], outputFolder: out };
            const psd = { baseName: "MASTER", fileName: "MASTER.psd" };
            const inspected = await job.inspectSharingRequest(params, psd);
            assert(inspected.ok, inspected.errors?.join("; "));
            // Exact filenames in the user's 0-success/10-failed screenshot.
            const troubled = new Set(["APM-90200-JP_6.jpg", "APM-90202-JP_5.jpg"]);
            const originalReadStream = fs.createReadStream;
            const countByName = new Map();
            fs.createReadStream = (file, ...args) => {
                const name = path.basename(String(file));
                if (file.startsWith(out + path.sep) && troubled.has(name)) {
                    const count = (countByName.get(name) || 0) + 1;
                    countByName.set(name, count);
                    if (count === 1) return require("stream").Readable.from([Buffer.from("NOT YET VISIBLE")]);
                }
                return originalReadStream(file, ...args);
            };
            let result;
            try {
                result = await job.processSharedAmazonJob(
                    { sender: { send() {}, isDestroyed() { return false; } } },
                    { ...params, confirmedExistingFiles: [] }, psd, inspected
                );
            } finally { fs.createReadStream = originalReadStream; }
            assert.strictEqual(result.successful, 10);
            assert.strictEqual(result.failed, 0);
            assert.strictEqual(result.sourceSuccessful, 2);
            assert.strictEqual(result.sharedSuccessful, 8);
            assert.strictEqual(result.results.reduce((n, row) => n + row.jpgs.length, 0), 55);
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].groups[0].variants.length, 10);
            for (const [id, count, shared] of cases) {
                for (let i = 1; i <= count; i++) {
                    const first = await fs.promises.readFile(path.join(out, rules.outputName(id, i)));
                    for (const sharedId of shared) {
                        assert.deepStrictEqual(await fs.promises.readFile(path.join(out, rules.outputName(sharedId, i))), first);
                    }
                }
            }
            assert.strictEqual(countByName.get("APM-90200-JP_6.jpg"), 2);
            assert.strictEqual(countByName.get("APM-90202-JP_5.jpg"), 2);
            console.log("PASS exact 10-ID APOM batch, late 6th/5th JPG visibility and all 55 shared outputs");
        } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
    });
}

async function testFailedSourceIsolation() {
    await withMockPhotoshop(async job => {
        const data = await fixture();
        try {
            const badFolder = path.join(data.parentFolder, "BAD");
            await fs.promises.mkdir(badFolder);
            const broken = path.join(badFolder, "1.png");
            await fs.promises.writeFile(broken, "not a PNG");
            data.params.parents[0].variants.unshift({
                id: "BAD", files: [{ path: broken, name: "1.png" }], sharedIds: ["BAD_SHARE"]
            });
            const psdName = { baseName: "MASTER", fileName: "MASTER.psd" };
            const inspected = await job.inspectSharingRequest(data.params, psdName);
            assert(inspected.ok);
            const result = await job.processSharedAmazonJob({ sender: { send() {}, isDestroyed() { return false; } } }, {
                ...data.params, confirmedExistingFiles: []
            }, psdName, inspected);
            assert.strictEqual(result.successful, 3);
            assert.strictEqual(result.failed, 2);
            assert.deepStrictEqual(result.results.filter(r => !r.ok).map(r => r.variantId), ["BAD", "BAD_SHARE"]);
            assert(fs.existsSync(path.join(data.outputFolder, "SH2.jpg")));
            assert(!fs.existsSync(path.join(data.outputFolder, "BAD_SHARE.jpg")));
            console.log("PASS source failure isolation and shared-dependent skipping");
        } finally { await fs.promises.rm(data.root, { recursive: true, force: true }); }
    });
}

async function testSharedCopyFailureIsolation() {
    await withMockPhotoshop(async (job, calls) => {
        const data = await fixture();
        try {
            const psdName = { baseName: "MASTER", fileName: "MASTER.psd" };
            const inspected = await job.inspectSharingRequest(data.params, psdName);
            assert(inspected.ok, inspected.errors?.join("; "));
            const originalOpen = fs.promises.open;
            fs.promises.open = async (file, flags, ...rest) => {
                if (file === path.join(data.outputFolder, "SH1.jpg") && flags === "wx") {
                    throw Object.assign(new Error("Simulated shared-drive copy failure"), { code: "EIO" });
                }
                return originalOpen(file, flags, ...rest);
            };
            let result;
            try {
                result = await job.processSharedAmazonJob(
                    { sender: { send() {}, isDestroyed() { return false; } } },
                    { ...data.params, confirmedExistingFiles: [] }, psdName, inspected
                );
            } finally { fs.promises.open = originalOpen; }
            assert.strictEqual(result.successful, 2);
            assert.strictEqual(result.failed, 1);
            assert.strictEqual(result.results.find(r => r.variantId === "SH1").ok, false);
            assert.strictEqual(result.results.find(r => r.variantId === "SH2").ok, true);
            assert(fs.existsSync(path.join(data.outputFolder, "SRC.jpg")));
            assert(fs.existsSync(path.join(data.outputFolder, "SH2.jpg")));
            assert(!fs.existsSync(path.join(data.outputFolder, "SH1.jpg")));
            assert.deepStrictEqual(calls[0].groups[0].variants.map(v => v.variantId), ["SRC", "SH2"]);
            console.log("PASS failed shared-ID copy does not stop other IDs or pollute master PSD");
        } finally { await fs.promises.rm(data.root, { recursive: true, force: true }); }
    });
}

async function main() {
    testIds();
    await testPreflight();
    await testPublishing();
    await testSharedDrivePublishVerification();
    await testIntegration();
    await testExactReportedLateImageBatch();
    await testFailedSourceIsolation();
    await testSharedCopyFailureIsolation();
    console.log("All Amazon Sharing tests passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
