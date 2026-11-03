"use strict";

// Regression checks for the photographic TIFF and split-layout JPEG failures:
// opaque photo backgrounds must NEVER be mistaken for removable blank pixels.
const assert = require("assert");
const sharp = require("sharp");
const rules = require("../src/modules/amazon/main/amazonRules");

function point(image, x, y) {
    const i = (y * image.info.width + x) * image.info.channels;
    return Array.from(image.data.subarray(i, i + 3));
}
async function pixels(buffer) {
    return sharp(buffer).removeAlpha().raw().toBuffer({resolveWithObject:true});
}
async function beigePortrait() {
    return sharp({
        create:{width:300,height:450,channels:3,background:{r:227,g:219,b:207}}
    }).composite([{
        input:{create:{width:102,height:320,channels:3,
            background:{r:45,g:43,b:48}}}, left:100, top:67
    }]).png().toBuffer();
}
async function twoPanelPhoto() {
    return sharp({
        create:{width:600,height:600,channels:3,background:"#ffffff"}
    }).composite([{
        input:{create:{width:231,height:600,channels:3,
            background:{r:214,g:209,b:197}}},left:369,top:0
    },{
        input:{create:{width:86,height:340,channels:3,
            background:{r:115,g:76,b:63}}},left:452,top:115
    }]).jpeg({quality:98,chromaSubsampling:"4:4:4"}).toBuffer();
}
async function isolatedProduct() {
    return sharp({
        create:{width:420,height:420,channels:3,background:"#ffffff"}
    }).composite([{
        input:{create:{width:130,height:160,channels:3,
            background:"#181818"}},left:140,top:140
    }]).png().toBuffer();
}
async function run() {
    // Non-white backdrop like the actual uploaded 2100 x 3150 TIFF portraits.
    const portrait = await beigePortrait();
    assert.equal(await rules.isCreativeFrame(portrait),true);
    assert.deepStrictEqual(await rules.detectCutSides(portrait),{
        left:true,right:true,top:true,bottom:true
    });
    const portraitBounds = await rules.getContentBounds(portrait);
    assert.deepStrictEqual([portraitBounds.left,portraitBounds.top,
        portraitBounds.width,portraitBounds.height],[0,0,300,450]);
    const portraitResult = await rules.renderAmazonImage(portrait,2,
        await rules.detectCutSides(portrait));
    assert.equal(portraitResult.placement.width,1041);
    assert.equal(portraitResult.placement.height,1562);
    assert.equal(portraitResult.placement.left,-20);
    assert.equal(portraitResult.placement.top,-280);
    assert.deepStrictEqual(portraitResult.placement.limitedCutSides, [],
        "Four-edge creatives must no longer use portrait contain caps");
    const portraitViewport = await pixels(portraitResult.jpgBuffer);
    assert(point(portraitViewport,0,0)[0] > 210,
        "Full-bleed photo should cover the left edge with its original backdrop");
    assert(point(portraitViewport,1000,1000)[0] > 210,
        "Full-bleed photo should cover the bottom-right edge");
    assert(portraitResult.smartObjectBuffer,
        "full portrait must survive in the master PSD Smart Object");
    const portraitSmart = await pixels(portraitResult.smartObjectBuffer);
    assert(point(portraitSmart,4,4)[0] > 210,
        "photographic corner background must remain intact");
    assert(point(portraitSmart,Math.floor(portraitSmart.info.width/2),800)[0] < 70,
        "subject must remain in its original place within the frame");
    const first = await rules.renderAmazonImage(portrait,1,
        await rules.detectCutSides(portrait));
    assert.equal(first.placement.height,801,
        "old Amazon Image 1 rule remains 801px, even for creative photos");
    assert.equal(first.placement.overflow,false);
    assert.equal(first.smartObjectBuffer,null);

    // Half-white + half-beige layout from CSC-91003-JP_3.jpg. The previous
    // renderer trimmed off its white left half and resized only the photo.
    const twoPanel = await twoPanelPhoto();
    assert.equal(await rules.isCreativeFrame(twoPanel),true,
        "split white/photo layout must be kept as one complete image");
    const splitBounds = await rules.getContentBounds(twoPanel);
    assert.deepStrictEqual([splitBounds.left,splitBounds.top,
        splitBounds.width,splitBounds.height],[0,0,600,600]);
    const split = await rules.renderAmazonImage(twoPanel,2,
        await rules.detectCutSides(twoPanel));
    assert.equal(split.placement.width,1041);
    assert.equal(split.placement.height,1041);
    const splitPixels = await pixels(split.jpgBuffer);
    const whiteSpace = point(splitPixels,120,500);
    const beigeSpace = point(splitPixels,920,50);
    assert(whiteSpace.every(value=>value>245),
        `left-side white composition lost: ${whiteSpace}`);
    assert(beigeSpace[0] > 190 && beigeSpace[0] < 235,
        `right-side photo backdrop lost: ${beigeSpace}`);
    assert(split.smartObjectBuffer,
        "creative full bleed must keep off-canvas Smart Object content");

    // Normal isolated product images must still trim blank padding, fit the
    // old 801/921 safe areas, and never be mistaken for full-frame photos.
    const isolated = await isolatedProduct();
    assert.equal(await rules.isCreativeFrame(isolated),false);
    assert.deepStrictEqual(await rules.detectCutSides(isolated),{
        left:false,right:false,top:false,bottom:false
    });
    for (const [slot,expected] of [[1,801],[2,921],[8,921]]) {
        const rendered=await rules.renderAmazonImage(isolated,slot,
            await rules.detectCutSides(isolated));
        assert.equal(rendered.placement.width,
            Math.round(130*(expected/160)));
        assert.equal(rendered.placement.height,expected);
        assert.equal(rendered.placement.overflow,false);
    }
    console.log("Amazon photographic-frame, four-edge and old 801/921 rule tests passed.");
}
run().catch(error=>{console.error(error);process.exitCode=1});
