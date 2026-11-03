"use strict";
const assert = require("assert");
const sharp = require("sharp");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { processVariant } = require("../src/modules/amazon/main/imageProcessor");
const rules = require("../src/modules/amazon/main/amazonRules");
const { toJsxData } = require("../src/modules/amazon/main/psdBuilder");

async function fullPhoto(width,height) {
    const pixels=Buffer.alloc(width*height*4);
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
        const i=(y*width+x)*4;
        pixels[i]=Math.floor(250*x/width);
        pixels[i+1]=Math.floor(220*y/height);
        pixels[i+2]=90;
        pixels[i+3]=255;
    }
    return sharp(pixels,{raw:{width,height,channels:4}}).png().toBuffer();
}
async function boundsAndPixel(buf,x,y) {
    const {data,info}=await sharp(buf).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const p=(y*info.width+x)*info.channels;
    return [data[p],data[p+1],data[p+2],data[p+3]];
}
async function run() {
    const source=await fullPhoto(400,400);
    const cut=await rules.detectCutSides(source);
    assert.deepStrictEqual(cut,{left:true,right:true,top:true,bottom:true});
    for (const position of [1,2,8]) {
        const result=await rules.renderAmazonImage(source,position,cut);
        const layout=result.placement;
        const expected = position === 1 ? 801 : 1041;
        const origin = position === 1 ? 100 : -20;
        assert.strictEqual(layout.width,expected,"Keep original 801 main; full-bleed the other slots");
        assert.strictEqual(layout.height,expected);
        assert.strictEqual(layout.left,origin);
        assert.strictEqual(layout.top,origin);
        if (position > 1) {
            assert(layout.overflow,"4-edge detail can extend beyond canvas");
            assert(result.smartObjectBuffer,"Off-canvas detail remains editable inside Smart Object");
            const smart=await sharp(result.smartObjectBuffer).metadata();
            assert.strictEqual(smart.width,1041);
            assert.strictEqual(smart.height,1041);
        } else {
            assert(!layout.overflow,"First Amazon image retains the original 801px safe area");
            assert(!result.smartObjectBuffer);
        }
        const output=await sharp(result.jpgBuffer).metadata();
        assert.strictEqual(output.width,1001);
        assert.strictEqual(output.height,1001);
        const left=await boundsAndPixel(result.pngBuffer,position===1 ? 105 : 10,500);
        const middle=await boundsAndPixel(result.pngBuffer,500,500);
        const right=await boundsAndPixel(result.pngBuffer,position===1 ? 895 : 990,500);
        assert(left[0] < middle[0] && middle[0] < right[0],"Left-right source gradient stays in order");
    }
    const normal=await sharp({create:{width:400,height:400,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
        .composite([{input:{create:{width:100,height:180,channels:4,background:{r:50,g:60,b:70,alpha:255}}},left:150,top:110}]).png().toBuffer();
    assert.deepStrictEqual(await rules.detectCutSides(normal),{left:false,right:false,top:false,bottom:false});
    const main=await rules.renderAmazonImage(normal,1,await rules.detectCutSides(normal));
    assert.strictEqual(main.placement.overflow,false);
    assert.strictEqual(main.smartObjectBuffer,null);
    assert(main.placement.width <= 801 && main.placement.height <=801);

    const shared={ parentId:"P",variants:[
        {variantId:"A", layers:[{pngPath:"/tmp/a.png",smartPngPath:"/tmp/a_full.png",
            placement:{left:-20,top:-20,width:1041,height:1041},layerName:"A"}]},
        {variantId:"A-SHARED",layers:[{pngPath:"/tmp/a.png",smartPngPath:"/tmp/a_full.png",
            placement:{left:-20,top:-20,width:1041,height:1041},layerName:"A-SHARED"}]}
    ]};
    const mapping=toJsxData([shared]);
    assert.equal(mapping[0].variants[0].layers[0].file,"/tmp/a_full.png");
    assert.deepStrictEqual(mapping[0].variants[0].layers[0].position,{left:-20,top:-20,width:1041,height:1041});
    assert.equal(mapping[0].variants[1].layers[0].file,"/tmp/a_full.png");
    assert.equal(mapping[0].variants[1].layers[0].name,"A-SHARED");
    assert.equal(toJsxData([{parentId:"P",variants:[{variantId:"NORMAL",layers:[{pngPath:"/tmp/n.png",layerName:"N"}]}]}])[0].variants[0].layers[0].position,null);
    // Verify the REAL Amazon source processor stores a separate full image
    // for an overflowing Smart Object while exporting the normal JPG view.
    const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),"amazon-full-bleed-test-"));
    try {
        const input=path.join(root,"source.png");
        await fs.promises.writeFile(input,source);
        const processed=await processVariant({id:"TEST-FOUR", files:[
            {name:"source.png",path:input}, {name:"source.png",path:input}
        ]},
            path.join(root,"jpg"),path.join(root,"work"));
        assert.equal(processed.jpgs.length,2);
        assert.equal(processed.layers.length,2);
        assert(!processed.layers[0].smartPngPath,"First image must use 801px safe area");
        const layer=processed.layers[1];
        assert(layer.smartPngPath && fs.existsSync(layer.smartPngPath));
        assert.deepStrictEqual({left:layer.placement.left,top:layer.placement.top},
            {left:-20,top:-20});
        assert.strictEqual((await sharp(layer.smartPngPath).metadata()).width,1041);
        assert.strictEqual((await sharp(layer.pngPath).metadata()).width,1001);
        assert.strictEqual((await sharp(processed.jpgs[0]).metadata()).width,1001);
        const jsxData=toJsxData([{parentId:"TEST",variants:[{variantId:"TEST-FOUR",layers:processed.layers}]}]);
        assert.equal(jsxData[0].variants[0].layers[1].file,layer.smartPngPath);
        assert.deepStrictEqual(jsxData[0].variants[0].layers[1].position,
            {left:-20,top:-20,width:1041,height:1041});
    } finally {
        await fs.promises.rm(root,{recursive:true,force:true});
    }
    console.log("Amazon 4-edge full-bleed, no-stretch and Smart Object mapping tests passed.");
}
run().catch(error=>{console.error(error);process.exitCode=1});
