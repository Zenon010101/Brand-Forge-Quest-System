"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const { PsdFastCache } = require("../src/modules/amazon/main/psdFastCache");

const exists = file => fs.existsSync(file);
const normalize = file => sharp(file).rotate().ensureAlpha().png().toBuffer();
const delay = ms => new Promise(r => setTimeout(r, ms));

async function run() {
    const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bf-amazon-fast-test-"));
    const root = path.join(work, "cache");
    const source = path.join(work, "PRODUCT.psd");
    await fs.promises.writeFile(source, Buffer.from("fake-photoshop-psd-source-2027"));
    let times = 0;
    const png = await sharp({ create: { width: 20, height: 12, channels: 4,
        background: { r: 20, g: 100, b: 80, alpha: 0 } } })
        .composite([{ input: { create: { width: 9, height: 6, channels: 4,
            background: { r: 10, g: 20, b: 200, alpha: 1 } } }, top: 3, left: 4 }])
        .png().toBuffer();
    async function extract(_psd, output) {
        times++;
        await delay(25);
        await fs.promises.writeFile(output, png);
    }
    const events = [];
    const cache = new PsdFastCache({ root });
    try {
        const first = await cache.load(source, { extract, normalize, onProgress: x => events.push(x.status) });
        assert.equal(first.cache, "MISS");
        assert.equal(times, 1);
        assert(events.includes("extracting-psd-no-shadow"));
        assert(events.includes("psd-cache-saved"));
        const second = await cache.load(source, { extract, normalize });
        assert.equal(second.cache, "HIT", "Generation must reuse preview extraction");
        assert.equal(times, 1, "Unchanged PSD may not reopen Photoshop");
        assert.deepStrictEqual(second.buffer, first.buffer, "Full-resolution normalized pixels must match exactly");
        assert.equal((await sharp(second.buffer).metadata()).width, 20, "Never cache only a thumbnail");
        const reopened = new PsdFastCache({ root });
        assert.equal((await reopened.load(source, { extract, normalize })).cache, "HIT", "Cache survives app restart");
        assert.equal(times, 1);
        const summary = await reopened.summary([source, source, path.join(work,"no-such.psd")]);
        assert.equal(summary.cached, 1);
        assert.equal(summary.missing, 1);
        assert.equal(summary.total, 2);
        // Change PSD bytes with unchanged filename, forcing a new signature.
        await fs.promises.writeFile(source, Buffer.from("fake-photoshop-psd-source-2027-modified"));
        assert.equal((await cache.load(source, { extract, normalize })).cache, "MISS");
        assert.equal(times, 2, "Modified PSD must be re-extracted");
        const meta = await cache.identity(source);
        const target = cache.paths(meta.key).png;
        assert(exists(target));
        await fs.promises.writeFile(target, Buffer.from("corrupt", "utf8"));
        assert.equal((await cache.load(source, { extract, normalize })).cache, "MISS",
            "Broken cached PNG must trigger safe Photoshop re-extraction");
        assert.equal(times, 3);
        // Three consumers of the same uncached file must share one extraction.
        await fs.promises.writeFile(source, Buffer.from("third source revision"));
        const concurrent = await Promise.all([0, 1, 2].map(() =>
            cache.load(source, { extract, normalize })));
        assert.equal(times, 4);
        assert.deepStrictEqual(concurrent.map(x => x.cache).sort(), ["MISS", "SHARED", "SHARED"]);
        // Cache can be disabled/unwritable: processing continues (same PNG bytes).
        const noDisk = new PsdFastCache({ root: path.join(work, "readonly-simulated") });
        noDisk.store = async () => false;
        const uncached = await noDisk.load(source, { extract, normalize });
        assert.equal(uncached.cache, "UNCACHED");
        assert.deepStrictEqual(uncached.buffer, first.buffer);
        assert.equal(times, 5);
        await cache.clear();
        assert(exists(source), "Clear Cache must never touch source PSDs");
        assert(!exists(root), "Clear Cache removes local cached PNGs");
        console.log("PASS Amazon PSD Fast Loader: persistent hits, full-res pixels, invalidation, corruption recovery, concurrent dedupe, uncached fallback, clear-safe.");
    } finally {
        await fs.promises.rm(work, { recursive: true, force: true });
    }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
