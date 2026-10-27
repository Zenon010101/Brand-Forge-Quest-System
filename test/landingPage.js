"use strict";
const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");
const os = require("os");
const sharp = require("sharp");
const { validateProjectCode, assembleLayout } = require("../src/modules/landing-page/main/planner");
const { parseTsv } = require("../src/modules/landing-page/main/ocr");
const { LandingPageService, publishDirectory } = require("../src/modules/landing-page/main/service");
const { findImageComponents } = require("../src/modules/landing-page/main/analyzer");

(async () => {
    const layout = assembleLayout([{ width: 1000, height: 1600 }, { width: 1000, height: 500 }]);
    assert.equal(layout.height, 3100);
    assert.equal(layout.parts[0].y, 1000);
    assert.equal(layout.parts[1].y, 2600);
    assert.equal(layout.parts[0].group, "02_LP_PART_01");
    assert.equal(layout.parts[1].group, "03_LP_PART_02");
    assert.equal(assembleLayout([{ width: 1000, height: 29001 }]).format, "psb");
    assert.throws(() => assembleLayout([{ width: 1000, height: 300000 }]), /exceeds Photoshop/);
    for (const invalid of ["../abc", "C:\\x", "CON", "NUL.txt", "illegal|x", "abc.", " "]) {
        assert.throws(() => validateProjectCode(invalid), /valid product code/);
    }
    assert.equal(validateProjectCode("DPK100.psd"), "DPK100");

    const tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n" +
        "5\t1\t1\t1\t1\t1\t10\t20\t43\t13\t92\tWelcome\n" +
        "5\t1\t1\t1\t1\t2\t60\t20\t20\t13\t91\tHome\n";
    const parsed = parseTsv(tsv);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].text, "Welcome Home");
    assert.equal(parsed[0].x, 10);

    const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-lp-test-"));
    try {
        const files = [path.join(work, "screenshot_A.png"), path.join(work, "screenshot_B.png")];
        const single = path.join(work, "single.png");
        const output = path.join(work, "output");
        await fs.promises.mkdir(output);
        // A real flattened screenshot fixture. Verify reconstruction never
        // loses source order or alters the uploaded images.
        const svg = (width, height, word) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#ffffff"/><rect x="20" y="100" width="${width-40}" height="220" fill="#d44c35"/><text x="45" y="60" font-family="Arial" font-weight="bold" font-size="42" fill="#222222">${word}</text><rect x="50" y="390" width="${width-100}" height="300" fill="#3470c4"/></svg>`);
        await sharp(svg(750, 1200, "Welcome Home")).png().toFile(files[0]);
        await sharp(svg(850, 500, "Our Products")).png().toFile(files[1]);
        await sharp({ create: { width: 600, height: 600, channels: 3, background: "#eee6c3" } }).png().toFile(single);
        // Text next to a photo: OCR overlap must not cause the isolated photo
        // to disappear or force an unrelated text region into a raster crop.
        const sideBySide = path.join(work, "side-by-side.png");
        const white = await sharp({ create: { width: 1000, height: 1300, channels: 3, background: "#ffffff" } }).raw().toBuffer();
        for (let y = 180; y < 850; y++) {
            for (let x = 80; x < 580; x++) {
                const off = (y * 1000 + x) * 3;
                white[off] = (x * 19 + y * 31) % 230;
                white[off + 1] = (x * 5 + y * 13) % 230;
                white[off + 2] = (x * 3 + y * 7) % 230;
            }
        }
        await sharp(white, { raw: { width: 1000, height: 1300, channels: 3 } }).png().toFile(sideBySide);
        const regions = await findImageComponents(sideBySide, [{ x: 640, y: 220, width: 250, height: 70 }]);
        assert.ok(regions.length >= 1);
        assert.ok(regions[0].left < 90 && regions[0].left + regions[0].width < 625);
        const originals = await Promise.all([...files, single].map(async file => fs.promises.readFile(file)));
        let buildCalls = 0;
        const service = new LandingPageService({
            buildPsd: async (nextLayout, outputPath, options) => {
                buildCalls++;
                assert.equal(nextLayout.width, 1000);
                assert.equal(nextLayout.parts[0].y, 1000);
                assert.equal(nextLayout.parts[1].y, 2600);
                assert.equal(options.code, "DPK100_LP");
                assert.equal(options.hasSingle, buildCalls === 1);
                await fs.promises.writeFile(outputPath, Buffer.alloc(5000, 42));
                return outputPath;
            }
        });
        const analyzed = await service.analyze({ screenshots: files, singlePath: single });
        assert.equal(analyzed.parts.length, 2);
        assert.equal(analyzed.height, 1000 + 1600 + Math.round(500 * 1000 / 850));
        assert.deepEqual(analyzed.parts.map(p => p.source), files);
        assert.equal(analyzed.parts[1].y, 2600);
        assert.equal(analyzed.format, "psd");
        const detail = await service.preview({ filePath: files[0], mode: "detail", top: 400, height: 800 });
        assert.equal(detail.top, 400);
        assert.equal(detail.height, 800);
        assert.equal(detail.normalizedHeight, 1600);
        const detailPng = Buffer.from(detail.dataUrl.split(",")[1], "base64");
        const detailInfo = await sharp(detailPng).metadata();
        assert.equal(detailInfo.width, 1000);
        assert.equal(detailInfo.height, 800);
        const firstResult = await service.generate({ sessionId: analyzed.sessionId, productCode: "DPK100_LP", outputFolder: output });
        assert.equal(firstResult.ok, true);
        assert.equal(buildCalls, 1);
        const manifest = JSON.parse(await fs.promises.readFile(firstResult.manifestPath, "utf8"));
        assert.equal(manifest.single.source, single);
        assert.equal(manifest.canvas.height, analyzed.height);
        assert.deepEqual(manifest.screenshotOrder, files);
        assert.equal(manifest.parts[0].group, "02_LP_PART_01");
        assert.equal(manifest.parts[1].y, manifest.parts[0].y + manifest.parts[0].normalizedDimensions.height);
        assert.ok(fs.existsSync(path.join(firstResult.outputFolder, "extracted", "part01_normalized_reference.png")));
        assert.ok(fs.existsSync(path.join(firstResult.outputFolder, "ocr", "part01.json")));
        assert.equal((await sharp(path.join(firstResult.outputFolder, "extracted", "part01_normalized_reference.png")).metadata()).width, 1000);
        for (const [index, file] of [...files, single].entries()) assert.deepEqual(await fs.promises.readFile(file), originals[index]);

        const analyzedAgain = await service.analyze({ screenshots: files, singlePath: null });
        await assert.rejects(() => service.generate({ sessionId: analyzedAgain.sessionId, productCode: "DPK100_LP", outputFolder: output }), /already exists/i);
        const second = await service.generate({ sessionId: analyzedAgain.sessionId, productCode: "DPK100_LP", outputFolder: output, overwrite: true });
        assert.ok(second.backupFolder);
        assert.ok(fs.existsSync(path.join(second.backupFolder, "manifest.json")));
        const m2 = JSON.parse(await fs.promises.readFile(second.manifestPath, "utf8"));
        assert.equal(m2.single.provided, false);

        const srcDir = path.join(work, "publish-src");
        const dstDir = path.join(work, "publish-dst");
        await fs.promises.mkdir(srcDir); await fs.promises.mkdir(dstDir);
        await fs.promises.writeFile(path.join(srcDir, "test.txt"), "NEW");
        await fs.promises.writeFile(path.join(dstDir, "test.txt"), "OLD");
        await assert.rejects(() => publishDirectory(srcDir, dstDir, false), /already exists/);
        assert.equal(await fs.promises.readFile(path.join(dstDir, "test.txt"), "utf8"), "OLD");
        const backup = await publishDirectory(srcDir, dstDir, true);
        assert.equal(await fs.promises.readFile(path.join(dstDir, "test.txt"), "utf8"), "NEW");
        assert.equal(await fs.promises.readFile(path.join(backup, "test.txt"), "utf8"), "OLD");
        await service.dispose();
        console.log("Landing Page Generator tests passed: 1000px + 1000px Single + ordering + OCR parsing + PNG assets + manifest + overwrite backup + unchanged sources.");
    } finally { await fs.promises.rm(work, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
