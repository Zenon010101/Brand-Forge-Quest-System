"use strict";

// Reproduces the 2100x3150 TIFF portrait problem with an included synthetic
// TIFF fixture: four-edge photos must cover the whole 1001x1001 JPG viewport
// even when the complete portrait extends far above/below the canvas.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const rules = require("../src/modules/amazon/main/amazonRules");
const { processVariant } = require("../src/modules/amazon/main/imageProcessor");
const { toJsxData } = require("../src/modules/amazon/main/psdBuilder");

async function makePortraitTiff(target) {
    const width = 210, height = 315;
    const subject = await sharp({
        create: { width: 80, height: 210, channels: 3, background: "#222222" }
    }).png().toBuffer();
    await sharp({
        create: { width, height, channels: 3, background: "#ded5c7" }
    }).composite([{ input: subject, left: 65, top: 52 }])
        .tiff({ compression: "lzw" }).toFile(target);
}

async function run() {
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "amazon-portrait-cover-"));
    try {
        const input = path.join(tmp, "portrait.tif");
        await makePortraitTiff(input);
        const source = await sharp(input).rotate().ensureAlpha().png().toBuffer();
        const cut = await rules.detectCutSides(source);
        assert.deepStrictEqual(cut, {left:true,right:true,top:true,bottom:true});
        assert.equal(await rules.isCreativeFrame(source), true);

        const result = await rules.renderAmazonImage(source, 2, cut);
        assert.equal(result.placement.width, 1041);
        assert(Math.abs(result.placement.height - 1562) <= 1,
            "Uniform resize may round portrait height by one pixel");
        assert.equal(result.placement.left, -20);
        assert.equal(result.placement.top,
            Math.round((1001 - result.placement.height) / 2));
        assert.deepStrictEqual(result.placement.limitedCutSides, []);
        const jpg = await sharp(result.jpgBuffer).metadata();
        assert.equal(jpg.width, 1001);
        assert.equal(jpg.height, 1001);
        const viewport = await sharp(result.pngBuffer).raw().toBuffer({resolveWithObject:true});
        for(const [x,y] of [[0,0],[1000,0],[0,1000],[1000,1000]]) {
            const i=(y*viewport.info.width+x)*viewport.info.channels;
            assert.equal(viewport.data[i+3],255,`Full-bleed must cover canvas corner ${x},${y}`);
        }
        const smart = await sharp(result.smartObjectBuffer).metadata();
        assert.equal(smart.width,1041);
        assert.equal(smart.height,result.placement.height);
        assert(smart.height > 1001, "Full-height source retained for PSD");

        // Verify genuine TIFF loading through the same path as real Amazon runs.
        const processed = await processVariant({ id:"TIFF-TEST", files:[
            {name:"portrait.tif",path:input}, {name:"portrait.tif",path:input}
        ]}, path.join(tmp,"exports"), path.join(tmp,"working"));
        assert.equal(processed.jpgs.length,2);
        assert(!processed.layers[0].smartPngPath,
            "Image 1 retains the original centered 801px rule");
        assert(processed.layers[1].smartPngPath,
            "Image 2 retains the complete portrait for PSD placement");
        assert(Math.abs((await sharp(processed.layers[1].smartPngPath).metadata()).height - 1562) <= 1);
        const jsxData = toJsxData([{parentId:"TIFF",variants:[{
            variantId:"TIFF-TEST",layers:processed.layers
        }]}]);
        assert.deepStrictEqual(jsxData[0].variants[0].layers[1].position,
            { left:-20,top:result.placement.top,width:1041,height:result.placement.height });
        assert.equal(jsxData[0].variants[0].layers[1].file,
            processed.layers[1].smartPngPath);
        console.log("Amazon portrait TIFF cover, centered viewport, full PSD source passed.");
    } finally {
        await fs.promises.rm(tmp,{recursive:true,force:true});
    }
}
run().catch(err=>{console.error(err);process.exitCode=1});
