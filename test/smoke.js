"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const sharp = require("sharp");

const projectRoot = path.resolve(__dirname, "..");
const scanner = require(path.join(projectRoot, "src/modules/amazon/main/folderScanner"));
const amazonRules = require(path.join(projectRoot, "src/modules/amazon/main/amazonRules"));
const colorbox = require(path.join(projectRoot, "src/modules/amazon/main/colorboxExporter"));
const progression = require(path.join(projectRoot, "src/modules/profile/main/progression"));

async function alphaBounds(buffer) {
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let minX = info.width;
    let minY = info.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
            const a = data[(y * info.width + x) * info.channels + 3];
            if (a <= 20) continue;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
    }
    return maxX < 0 ? null : {
        left: minX,
        top: minY,
        right: maxX + 1,
        bottom: maxY + 1,
        width: maxX - minX + 1,
        height: maxY - minY + 1
    };
}

function syntaxCheckJsx(relativePath) {
    const file = path.join(projectRoot, relativePath);
    const text = fs.readFileSync(file, "utf8")
        .replace(/^\uFEFF/, "")
        .replace(/^\s*#target\s+photoshop\s*/i, "");
    new vm.Script(text, { filename: relativePath });
}

async function testScanner() {
    for (let i = 1; i <= 8; i++) {
        assert.strictEqual(scanner.exactSlotFromName(`${i}.png`), i);
        assert.strictEqual(scanner.exactSlotFromName(`${i}.psd`), i);
    }

    assert.strictEqual(scanner.sourceTypeFromExtension(".psd"), "psd");
    assert.strictEqual(scanner.sourceTypeFromExtension(".psb"), "psd");
    assert.strictEqual(scanner.sourceTypeFromExtension(".png"), "png");
    assert.strictEqual(scanner.sourceTypeFromExtension(".jpg"), "jpg");
    assert.strictEqual(scanner.sourceTypeFromExtension(".jpeg"), "jpg");
    assert.strictEqual(scanner.sourceTypeFromExtension(".webp"), "webp");
    assert.strictEqual(scanner.sourceTypeFromExtension(".tiff"), "other");
    ["01.png", "9.png", "abc_1.png", "1-copy.png", "notes.txt"].forEach(name => {
        assert.strictEqual(scanner.exactSlotFromName(name), null, name);
    });

    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "amazon-scan-test-"));
    try {
        for (const name of ["1.png", "2.jpg", "notes.txt", "abc_1.png", "9.png", "3.txt"]) {
            await fs.promises.writeFile(path.join(root, name), "x");
        }
        const result = scanner.scanVariantFolder(root);
        assert.deepStrictEqual(result.files.map(f => f.name), ["1.png", "2.jpg"]);
        assert.deepStrictEqual(result.files.map(f => f.sourceType), ["png", "jpg"]);
        assert(result.ignoredFiles.includes("notes.txt"));
        assert(result.ignoredFiles.includes("abc_1.png"));
    } finally {
        await fs.promises.rm(root, { recursive: true, force: true });
    }
}

async function testAmazonVisiblePixelSizing() {
    const item = await sharp({
        create: { width: 1000, height: 1000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).composite([{
        input: { create: { width: 100, height: 200, channels: 4, background: { r: 220, g: 20, b: 20, alpha: 255 } } },
        left: 400,
        top: 350
    }]).png().toBuffer();

    const cut = await amazonRules.detectCutSides(item);
    assert.deepStrictEqual(cut, { left: false, right: false, top: false, bottom: false });

    const first = await amazonRules.renderAmazonImage(item, 1, cut);
    const firstBounds = await alphaBounds(first.pngBuffer);
    assert(firstBounds);
    assert(Math.abs(firstBounds.height - 801) <= 1, `first height=${firstBounds.height}`);
    assert(Math.abs(firstBounds.width - 401) <= 2, `first width=${firstBounds.width}`);
    assert(Math.abs(firstBounds.top - 100) <= 1, `first top=${firstBounds.top}`);

    const rest = await amazonRules.renderAmazonImage(item, 2, cut);
    const restBounds = await alphaBounds(rest.pngBuffer);
    assert(restBounds);
    assert(Math.abs(restBounds.height - 921) <= 1, `rest height=${restBounds.height}`);
    assert(Math.abs(restBounds.width - 461) <= 2, `rest width=${restBounds.width}`);
    assert(Math.abs(restBounds.top - 40) <= 1, `rest top=${restBounds.top}`);
}

async function testAmazonCutPlacement() {
    const source = await sharp({
        create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).composite([{
        input: { create: { width: 200, height: 200, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 255 } } },
        left: 0,
        top: 100
    }]).png().toBuffer();

    const cut = await amazonRules.detectCutSides(source);
    assert.strictEqual(cut.left, true);
    assert.strictEqual(cut.bottom, true);
    assert.strictEqual(cut.right, false);
    assert.strictEqual(cut.top, false);

    const rendered = await amazonRules.renderAmazonImage(source, 2, cut);
    const bounds = await alphaBounds(rendered.pngBuffer);
    assert.strictEqual(bounds.left, 0);
    assert.strictEqual(bounds.bottom, 1001);
}


async function testAmazonCutCornerLock() {
    const svg = Buffer.from(
        '<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg">' +
        '<polygon points="0,0 299,0 299,299 150,299 0,150" fill="black"/>' +
        '</svg>'
    );

    const source = await sharp({
        create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).composite([{ input: svg, left: 0, top: 0 }]).png().toBuffer();

    const cut = await amazonRules.detectCutSides(source);
    assert.deepStrictEqual(cut, { left: true, right: true, top: true, bottom: true });

    const rendered = await amazonRules.renderAmazonImage(source, 2, cut);
    const { data, info } = await sharp(rendered.pngBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];
    assert(alphaAt(0, 1000) > 20, "cut corner must contain actual visible item pixels");
}

async function testAmazonFirstImageCutFlush() {
    const source = await sharp({
        create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).composite([{
        input: { create: { width: 220, height: 220, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 255 } } },
        left: 0,
        top: 0
    }]).png().toBuffer();

    const cut = await amazonRules.detectCutSides(source);
    const rendered = await amazonRules.renderAmazonImage(source, 1, cut);
    const bounds = await alphaBounds(rendered.pngBuffer);
    assert.strictEqual(bounds.left, 0, "Amazon image 1 cut-left must flush to canvas edge");
    assert.strictEqual(bounds.top, 0, "Amazon image 1 cut-top must flush to canvas edge");
}

async function testColorboxByteCopy() {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "colorbox-test-"));
    const out = path.join(root, "out");
    await fs.promises.mkdir(out);
    try {
        const source = path.join(root, "RMC-81.jpg");
        await sharp({
            create: { width: 1001, height: 1001, channels: 3, background: { r: 255, g: 255, b: 255 } }
        }).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toFile(source);

        const plan = await colorbox.prepareColorboxPlan([
            { parentId: "PARENT", variantId: "RMC-81", sourcePath: source }
        ], out, [source]);
        const result = await colorbox.exportColorboxes(plan, { overwrite: false });
        assert.strictEqual(result.successful, 1);
        assert.strictEqual(result.failed, 0);
        const output = path.join(out, "rmc-81clr.jpg");
        assert.deepStrictEqual(await fs.promises.readFile(output), await fs.promises.readFile(source));
    } finally {
        await fs.promises.rm(root, { recursive: true, force: true });
    }
}

async function testAmazonBackgroundPrepHelpers() {
    const imageProcessor = require(path.join(projectRoot, "src/modules/amazon/main/imageProcessor"));

    const transparent = await sharp({
        create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).composite([{
        input: { create: { width: 50, height: 50, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 255 } } },
        left: 25, top: 25
    }]).png().toBuffer();

    const opaque = await sharp({
        create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 255 } }
    }).png().toBuffer();


    const bridgeText = fs.readFileSync(path.join(projectRoot, "src/modules/amazon/main/photoshopBridge.js"), "utf8");
    assert(bridgeText.includes('sourceDoc.layers[1].visible = false'), "PSD second top-level layer hide rule missing");
    assert(!bridgeText.includes('stringIDToTypeID("removeBackground")'), "Amazon must not call Remove Background");
}

function testSliderPlacementRevision() {
    const jsx = fs.readFileSync(path.join(projectRoot, "src/modules/slider/jsx/sliderEngine.jsx"), "utf8");
    assert(jsx.includes('var PSD_SHADOW_LIFT_PX = 4;'), "PSD shadow lift rule missing");
    assert(jsx.includes('ensureSliderMainSmartObject'), "PSD Main Smart Object conversion missing");
    assert(jsx.includes('stringIDToTypeID("newPlacedLayer")'), "Smart Object action missing");
    assert(jsx.includes('analyzeSourceVisibleContent'), "white-background visible-item analysis missing");
    assert(jsx.includes('stringIDToTypeID("removeBackground")'), "Slider analysis Remove Background action missing");
    assert(jsx.includes('getOpaqueSourceMappedBounds'), "normalized item-bound mapping missing for flat sources");
    assert(jsx.includes('return getLayerVisibleBoundsPx(info.mainLayer);'), "PSD Main must use direct visible bounds");
    assert(jsx.includes('STRICT FIT SAFETY'), "strict guide containment rule missing");
    assert(jsx.includes('slotCorrection'), "lineup slot containment rule missing");
    assert(jsx.includes('liftEditablePSDShadowAfterPlacement'), "post-placement PSD shadow correction missing");
    assert(jsx.includes('var CREATIVE_DETAIL_WIDTH = 570;'));
    assert(jsx.includes('var CREATIVE_DETAIL_HEIGHT = 530;'));
}

function testSliderPaVerticalDefinition() {
    const jsx = fs.readFileSync(path.join(projectRoot, "src/modules/slider/jsx/sliderEngine.jsx"), "utf8");
    assert(jsx.includes('width: 571, height: 280'), "PA Item 571x280 missing");
    assert(jsx.includes('width: 571, height: 250'), "PA Detail 571x250 missing");
    assert(jsx.includes('width: 571, height: 50'), "PA Color 571x50 missing");
    assert(jsx.includes('state.layoutMode === "paVertical"'), "PA Vertical dispatch missing");

    const renderer = fs.readFileSync(path.join(projectRoot, "src/modules/slider/renderer/index.html"), "utf8");
    assert(renderer.includes('Horizontal <small>Side by Side</small>'));
    assert(renderer.includes('Vertical <small>Stacked</small>'));
    assert(renderer.includes('value="paVertical"'));
}

function testAmazonSourceTypeFilter() {
    const html = fs.readFileSync(path.join(projectRoot, "src/modules/amazon/renderer/index.html"), "utf8");
    const renderer = fs.readFileSync(path.join(projectRoot, "src/modules/amazon/renderer/app.js"), "utf8");

    assert(html.includes('id="sourceTypeFilter"'), "Amazon source-type filter UI missing");
    assert(html.includes('value="psd"'));
    assert(html.includes('value="png"'));
    assert(html.includes('value="jpg"'));
    assert(html.includes('value="webp"'));
    assert(html.includes('value="other"'));
    assert(renderer.includes('function eligibleFiles(variant)'), "Global Amazon filter logic missing");
    assert(renderer.includes('clearSelectionsOutsideSourceFilter'), "Hidden selection cleanup missing");
    assert(renderer.includes('sourceTypeFilter.addEventListener("change"'), "Amazon source-type filter event missing");
}

function testProjectStructure() {
    const required = [
        "src/modules/slider/jsx/sliderEngine.jsx",
        "src/modules/amazon/main/amazonRules.js",
        "src/modules/settings/main/register.js",
        "src/modules/profile/main/register.js",
        "src/modules/profile/main/service.js"
    ];
    required.forEach(file => assert(fs.existsSync(path.join(projectRoot, file)), file));

    const shell = fs.readFileSync(path.join(projectRoot, "src/renderer/index.html"), "utf8");
    assert(!shell.includes("../modules/image-tools/renderer/index.html"));
    assert(!shell.includes("Image Tools"));
    assert(shell.includes("testPhotoshopBtn"));
    assert(shell.includes("Progress & History"));
    assert(shell.includes("authOverlay"));

    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    assert.strictEqual(pkg.build.productName, "Image Workflow Studio");
    assert.strictEqual(pkg.name, "image-workflow-studio");
}

function testProgressionMath() {
    const initial = progression.levelInfo(0);
    assert.strictEqual(initial.level, 1);
    assert.strictEqual(initial.xpForNextLevel, 100);

    const level2 = progression.levelInfo(100);
    assert.strictEqual(level2.level, 2);
    assert.strictEqual(level2.xpIntoLevel, 0);
    assert.strictEqual(progression.rankForLevel(1), "Rookie Operator");
    assert.strictEqual(progression.rankForLevel(51), "Automation Legend");
}

(async () => {
    testProjectStructure();
    testProgressionMath();
    testAmazonSourceTypeFilter();
    testSliderPaVerticalDefinition();
    testSliderPlacementRevision();
    syntaxCheckJsx("src/modules/slider/jsx/sliderEngine.jsx");
    await testAmazonBackgroundPrepHelpers();
    await testScanner();
    await testAmazonVisiblePixelSizing();
    await testAmazonCutPlacement();
    await testAmazonCutCornerLock();
    await testAmazonFirstImageCutFlush();
    await testColorboxByteCopy();
    console.log("Smoke tests passed.");
})().catch(error => {
    console.error(error.stack || error);
    process.exit(1);
});
