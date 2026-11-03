"use strict";
const assert = require("assert");
const sharp = require("sharp");
const rules = require("../src/modules/amazon/main/amazonRules");

function opaqueWithTransparentHole(width, height, colorForY) {
    const raw = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const p = (y * width + x) * 4;
            const [r, g, b] = colorForY(y);
            raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
            raw[p + 3] = x >= 10 && x < 30 && y >= Math.floor(height / 2) - 5 &&
                y < Math.floor(height / 2) + 5 ? 0 : 255;
        }
    }
    return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
async function read(buffer) {
    return sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
function pixel(img, x, y) {
    const i = (y * img.info.width + x) * img.info.channels;
    return Array.from(img.data.subarray(i, i + 4));
}
async function alphaBounds(buffer) {
    const img = await read(buffer);
    let x1 = img.info.width, y1 = img.info.height, x2 = -1, y2 = -1;
    for (let y = 0; y < img.info.height; y++) {
        for (let x = 0; x < img.info.width; x++) {
            if (pixel(img, x, y)[3] < 20) continue;
            x1 = Math.min(x1, x); y1 = Math.min(y1, y);
            x2 = Math.max(x2, x); y2 = Math.max(y2, y);
        }
    }
    return { left:x1, top:y1, right:x2 + 1, bottom:y2 + 1,
        width:x2-x1+1, height:y2-y1+1 };
}
async function testTallSourceCoversCanvasAndKeepsFullSmartObject() {
    const src = await opaqueWithTransparentHole(280, 720, y =>
        y < 160 ? [210, 20, 20] : y >= 560 ? [20, 30, 210] : [20, 150, 20]);
    const cut = await rules.detectCutSides(src);
    assert.deepStrictEqual(cut, { left:true, right:true, top:true, bottom:true });
    for (const position of [1, 2, 8]) {
        const result = await rules.renderAmazonImage(src, position, cut);
        if (position === 1) {
            assert(!result.placement.overflow);
            assert(!result.smartObjectBuffer);
            const safe = await alphaBounds(result.pngBuffer);
            assert(safe.height <= 801 && safe.width <= 801);
            continue;
        }
        assert(result.placement.overflow);
        assert(result.smartObjectBuffer, "Off-canvas full item must remain available for PSD");
        const bounds = await alphaBounds(result.pngBuffer);
        const canvas = await read(result.pngBuffer);
        const full = await read(result.smartObjectBuffer);
        assert.equal(bounds.width, 1001, "Four-edge portrait must fill entire canvas width");
        assert.equal(bounds.height, 1001, "Four-edge portrait must fill entire canvas height");
        assert(result.placement.left < 0 && result.placement.top < 0,
            "Tall cut photo must be centered and overflow vertically");
        assert.equal(result.placement.width, 1041);
        assert(result.placement.height > 2000);
        const centerX = 500;
        assert(pixel(canvas, centerX, 6)[1] > 120, "Central green image section remains on canvas");
        assert(pixel(canvas, centerX, 994)[1] > 120, "Central green image section remains on canvas");
        assert(pixel(full, Math.floor(full.info.width/2), 2)[0] > 180,
            "Full Smart Object must preserve original upper red pixels");
        assert(pixel(full, Math.floor(full.info.width/2), full.info.height-3)[2] > 180,
            "Full Smart Object must preserve original lower blue pixels");
        assert.deepStrictEqual(result.placement.limitedCutSides, [],
            "Four-edge cover is no longer limited by a portrait cap");
    }
}
async function testWideSourceHasFullSmartObject() {
    const src = await opaqueWithTransparentHole(720, 280, y =>
        y < 140 ? [230, 30, 15] : [25, 30, 210]);
    const result = await rules.renderAmazonImage(src, 2,
        {left:true,right:true,top:true,bottom:true});
    const bounds = await alphaBounds(result.pngBuffer);
    assert.equal(bounds.width, 1001);
    assert.equal(bounds.height, 1001);
    assert(result.placement.left < 0 && result.placement.top < 0);
    assert.deepStrictEqual(result.placement.limitedCutSides, []);
    const full = await read(result.smartObjectBuffer);
    assert(full.info.width > 1001, "Oversized horizontal source is retained inside PSD Smart Object");
    assert(pixel(full, 2, Math.floor(full.info.height/3))[0] > 180);
    assert(pixel(full, full.info.width-3, Math.floor(full.info.height*3/4))[2] > 180);
}
async function testOneSidedCutEnlargesButAlignsOnlyCutAxis() {
    const src = await sharp({ create:{ width:300,height:300,channels:4,
        background:{r:0,g:0,b:0,alpha:0}} })
        .composite([{ input:{create:{width:180,height:100,channels:4,
            background:{r:20,g:40,b:60,alpha:255}}}, left:0,top:80 }])
        .png().toBuffer();
    const cut = await rules.detectCutSides(src);
    assert.deepStrictEqual(cut, {left:true,right:false,top:false,bottom:false});
    for (const pos of [1,2]) {
        const output = await rules.renderAmazonImage(src, pos, cut);
        const bounds = await alphaBounds(output.pngBuffer);
        assert.equal(bounds.left, pos === 1 ? 100 : 0,
            "First image keeps the safe area; later cut images align left");
        const expected = Math.round(pos === 1 ? 801 : 921 * rules.CUT_ENLARGEMENT);
        assert(Math.abs(bounds.width - expected) <= 1,
            "Image 1 stays 801px and later cut images enlarge by 4%");
        assert(Math.abs((bounds.top + bounds.bottom) / 2 - 500.5) <= 1,
            "Other axis stays centered");
        assert(!output.smartObjectBuffer, "No need for full-sized extra PSD layer when item fits");
    }
}
function testPlacementAllowsControlledOverflowButNotNormalProducts() {
    const patterns = [
        {left:false,right:false,top:false,bottom:false},
        {left:true,right:false,top:false,bottom:false},
        {left:false,right:true,top:false,bottom:false},
        {left:false,right:false,top:true,bottom:false},
        {left:false,right:false,top:false,bottom:true},
        {left:true,right:true,top:false,bottom:false},
        {left:false,right:false,top:true,bottom:true},
        {left:true,right:true,top:true,bottom:true},
        {left:true,right:false,top:false,bottom:true},
        {left:false,right:true,top:true,bottom:false}
    ];
    for (const [w,h] of [[1,500],[500,1],[50,800],[800,50],[120,400],[400,120],[234,234]]) {
        for (const cut of patterns) {
            const isNormal = !Object.values(cut).some(Boolean);
            for (const position of [1,2,8]) {
                const p = rules.calculateAmazonPlacement(w,h,position,cut);
                assert(p.width > 0 && p.height > 0);
                if (position > 1 && Object.values(cut).every(Boolean)) {
                    assert(p.width >= 1001 && p.height >= 1001,
                        "Every four-edge creative fills both canvas dimensions");
                    assert(p.left <= 0 && p.top <= 0,
                        "Full-bleed image must be centered with any overflow off canvas");
                    assert(Math.abs(p.left - Math.round((1001-p.width)/2)) <= 1);
                    assert(Math.abs(p.top - Math.round((1001-p.height)/2)) <= 1);
                } else {
                    assert(p.width <= 1001*1.12*rules.CUT_ENLARGEMENT+2 &&
                        p.height <= 1001*1.12*rules.CUT_ENLARGEMENT+2,
                        "Only four-edge creatives may use unlimited proportional overflow");
                }
                // Both displayed dimensions are independently rounded to
                // whole pixels from ONE underlying scale; allow <= 0.5px
                // rounding on each side even for 1px-tall extreme images.
                const integerRoundingError = Math.abs(p.width*h - p.height*w);
                assert(integerRoundingError <= 0.51*(w+h),
                    "Uniform scaling must preserve aspect ratio within pixel rounding");
                if (isNormal) {
                    assert(!p.overflow, "Normal centered Amazon product must not extend beyond canvas");
                }
            }
        }
    }
}
async function run() {
    await testTallSourceCoversCanvasAndKeepsFullSmartObject();
    await testWideSourceHasFullSmartObject();
    await testOneSidedCutEnlargesButAlignsOnlyCutAxis();
    testPlacementAllowsControlledOverflowButNotNormalProducts();
    console.log("Amazon full-bleed coverage, non-destructive overflow and Smart Object tests passed.");
}
run().catch(error=>{console.error(error);process.exitCode=1});
