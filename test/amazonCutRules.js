"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const rules = require("../src/modules/amazon/main/amazonRules");

function rgbAt(raw, info, x, y) {
    const p = (y * info.width + x) * info.channels;
    return [raw[p], raw[p + 1], raw[p + 2]];
}

async function visibleDarkEdges(buffer) {
    const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const dark = (x, y) => {
        const [r, g, b] = rgbAt(data, info, x, y);
        return r < 125 && g < 125 && b < 125;
    };
    const result = { left: false, right: false, top: false, bottom: false };
    for (let y = 0; y < info.height; y++) {
        if (dark(0, y)) result.left = true;
        if (dark(info.width - 1, y)) result.right = true;
    }
    for (let x = 0; x < info.width; x++) {
        if (dark(x, 0)) result.top = true;
        if (dark(x, info.height - 1)) result.bottom = true;
    }
    return result;
}

async function opaqueFixture({ x, y, width, height, canvasWidth = 300, canvasHeight = 300, format = "png" }) {
    const base = sharp({
        create: { width: canvasWidth, height: canvasHeight, channels: 3, background: "#ffffff" }
    });
    const composited = base.composite([{
        input: { create: { width, height, channels: 3, background: "#151515" } },
        left: x,
        top: y
    }]);
    return format === "jpeg"
        ? composited.jpeg({ quality: 97 }).toBuffer()
        : composited.png().toBuffer();
}

async function transparentFixture({ x, y, width, height, canvasWidth = 300, canvasHeight = 300 }) {
    return sharp({
        create: { width: canvasWidth, height: canvasHeight, channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 0 } }
    }).composite([{
        input: { create: { width, height, channels: 4,
            background: { r: 21, g: 21, b: 21, alpha: 255 } } },
        left: x,
        top: y
    }]).png().toBuffer();
}

async function assertCut(source, expected, label) {
    const detected = await rules.detectCutSides(source);
    assert.deepStrictEqual(detected, expected, `${label}: cut detection mismatch`);
    for (const position of [1, 2]) {
        const rendered = await rules.renderAmazonImage(source, position, detected);
        const meta = await sharp(rendered.jpgBuffer).metadata();
        assert.strictEqual(meta.width, 1001, `${label}: JPEG width`);
        assert.strictEqual(meta.height, 1001, `${label}: JPEG height`);
        const edges = await visibleDarkEdges(rendered.jpgBuffer);
        for (const side of ["left", "right", "top", "bottom"]) {
            if (expected[side]) {
                assert(edges[side], `${label}: Amazon image ${position} ${side} must have dark item pixels at canvas edge`);
            }
        }
    }
}

async function run() {
    const fixtures = [
        { name: "left cut", shape: { x: 0, y: 75, width: 210, height: 150 }, sides: { left: true, right: false, top: false, bottom: false } },
        { name: "right cut", shape: { x: 90, y: 75, width: 210, height: 150 }, sides: { left: false, right: true, top: false, bottom: false } },
        { name: "top cut", shape: { x: 75, y: 0, width: 150, height: 210 }, sides: { left: false, right: false, top: true, bottom: false } },
        { name: "bottom cut", shape: { x: 75, y: 90, width: 150, height: 210 }, sides: { left: false, right: false, top: false, bottom: true } },
        { name: "left + bottom cut", shape: { x: 0, y: 100, width: 200, height: 200 }, sides: { left: true, right: false, top: false, bottom: true } },
        { name: "right + top cut", shape: { x: 100, y: 0, width: 200, height: 200 }, sides: { left: false, right: true, top: true, bottom: false } },
        { name: "left + right cut", shape: { x: 0, y: 85, width: 300, height: 130 }, sides: { left: true, right: true, top: false, bottom: false } },
        { name: "top + bottom cut", shape: { x: 85, y: 0, width: 130, height: 300 }, sides: { left: false, right: false, top: true, bottom: true } }
    ];
    for (const fixture of fixtures) {
        await assertCut(await opaqueFixture(fixture.shape), fixture.sides, `${fixture.name} opaque PNG`);
    }
    await assertCut(await opaqueFixture({ x: 0, y: 100, width: 200, height: 200, format: "jpeg" }),
        { left: true, right: false, top: false, bottom: true }, "JPEG left + bottom");
    await assertCut(await transparentFixture({ x: 100, y: 0, width: 200, height: 200 }),
        { left: false, right: true, top: true, bottom: false }, "transparent right + top");

    // A handful of antialiased/translucent pixels on an otherwise opaque
    // source must not make every white background pixel "product".
    const mostlyOpaque = await opaqueFixture({ x: 0, y: 100, width: 200, height: 200 });
    const rgba = await sharp(mostlyOpaque).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    rgba.data[3] = 220;
    const lightlyTranslucent = await sharp(rgba.data, {raw: {
        width: rgba.info.width, height: rgba.info.height, channels: rgba.info.channels
    }}).png().toBuffer();
    assert.deepStrictEqual(await rules.detectCutSides(lightlyTranslucent),
        { left: true, right: false, top: false, bottom: true },
        "Single partly transparent border pixel must not break opaque cut detection");

    // An antialiased/transparent 8px fringe on a large source should not
    // turn a clipped product into an ordinary 801/921-safe-area image.
    const nearlyCut = await transparentFixture({
        x: 8, y: 170, width: 780, height: 830, canvasWidth: 1000, canvasHeight: 1000
    });
    const nearSides = await rules.detectCutSides(nearlyCut);
    assert(nearSides.left && nearSides.bottom, "Near-edge mask fringe must preserve cut alignment");
    const nearRender = await rules.renderAmazonImage(nearlyCut, 2, nearSides);
    const nearEdges = await visibleDarkEdges(nearRender.jpgBuffer);
    assert(nearEdges.left && nearEdges.bottom, "Near-edge mask must be flush in final JPG");

    const safe = await opaqueFixture({ x: 65, y: 60, width: 170, height: 180 });
    assert.deepStrictEqual(await rules.detectCutSides(safe),
        { left: false, right: false, top: false, bottom: false },
        "Normal centered item must not be treated as cut");
    for (const [pos, margin] of [[1, 100], [2, 40]]) {
        const rendered = await rules.renderAmazonImage(safe, pos, await rules.detectCutSides(safe));
        const { data, info } = await sharp(rendered.jpgBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const d = (x, y) => rgbAt(data, info, x, y).every(c => c < 125);
        for (let i = 0; i < margin; i++) {
            assert(!d(i, 500) && !d(500, i), `No-cut image ${pos} must preserve safe-area margin`);
        }
    }

    // A clipped product can leave a white triangle at an opaque photo corner.
    // Corner anchoring must find the PRODUCT, not the JPG's opaque background.
    const triangleSvg = Buffer.from('<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg">' +
        '<polygon points="0,180 180,0 299,0 299,299 0,299" fill="#111111"/></svg>');
    const corner = await sharp({create:{width:300,height:300,channels:3,background:'#ffffff'}})
        .composite([{input:triangleSvg,left:0,top:0}]).png().toBuffer();
    const sides = await rules.detectCutSides(corner);
    assert.deepStrictEqual(sides, { left:true,right:true,top:true,bottom:true });
    const anchor = await rules.getOpaqueCornerAnchor(corner, sides);
    assert(anchor && anchor.normalizedDistance > 0.1,
        "Opaque-image corner anchor must find real product pixels, not white background");
    const result = await rules.renderAmazonImage(corner, 2, sides);
    const edges = await visibleDarkEdges(result.jpgBuffer);
    assert.deepStrictEqual(edges, { left:true,right:true,top:true,bottom:true },
        "Corner-cropped image must reach all requested canvas edges");

    const smallTriangleSvg = Buffer.from('<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg">' +
        '<polygon points="0,35 35,0 299,0 299,299 0,299" fill="#111111"/></svg>');
    const tinyGap = await sharp({create:{width:300,height:300,channels:3,background:'#ffffff'}})
        .composite([{ input: smallTriangleSvg, left: 0, top: 0 }]).png().toBuffer();
    const tinyCut = await rules.detectCutSides(tinyGap);
    const tinyRendered = await rules.renderAmazonImage(tinyGap, 2, tinyCut);
    const tinyRgb = await sharp(tinyRendered.jpgBuffer).raw().toBuffer({ resolveWithObject: true });
    assert(rgbAt(tinyRgb.data, tinyRgb.info, 0, 0).every(channel => channel < 125),
        "Cut corner must contain solid product, not a nearly white antialiased pixel");

    console.log("Amazon cut-edge regression tests passed.");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
