"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { DIM, buildCombineLayout } = require("../src/modules/combine/main/planner");
const { preparedEntry } = require("../src/modules/combine/main/photoshop");
const { CombineService } = require("../src/modules/combine/main/service");
const { detectedCaptionLayout, verticalPositions } = require("../src/modules/combine/shared/captionLayout");
const source = (name, data={}) => ({path:path.join(os.tmpdir(),name),name,width:600,height:600,
    visibleWidth:190,visibleHeight:290,colorName:"クラウドホワイト/コアブラック",
    colorNameRight:"コアブラック/クラウドホワイト",...data});

async function run() {
    // A vertical source keeps its FULL 600x600 composition, including blank
    // caption areas. It must not be halved/split like regular Line Up images.
    const vertical = buildCombineLayout({single:null,lineup:[source("shoes.png",{rowMode:"vertical",
        captionTopY:255/600, captionBottomY:556/600})],details:[],outputName:"SHOES"});
    assert.equal(vertical.lineupRowCount,1);
    assert.equal(vertical.lineupRows[0].kind,"vertical");
    assert.equal(vertical.lineup[0].placedWidth,594);
    assert.equal(vertical.lineup[0].placedHeight,594);
    assert.equal(vertical.lineup[0].labels.length,2);
    assert.deepEqual(vertical.lineup[0].labels.map(v=>v.side),["top","bottom"]);
    assert.equal(vertical.lineup[0].labels[0].y,Math.round(594*255/600));
    assert.equal(vertical.lineup[0].labels[1].y,Math.round(594*556/600));
    assert(vertical.lineup[0].labels[0].y+36<vertical.lineup[0].labels[1].y);
    assert(vertical.height>=vertical.lineup[0].placedHeight);
    assert(vertical.height<vertical.lineup[0].placedHeight+36, "No unnecessary caption row appended");
    const horiz=buildCombineLayout({single:null,lineup:[source("horizontal.png",{rowMode:"dual"})],
        details:[],outputName:"HORIZONTAL"});
    assert.equal(horiz.lineupRows[0].kind,"dual");
    assert(horiz.lineup[0].labels[0].y>=horiz.lineup[0].placedHeight);
    const single=buildCombineLayout({single:null,lineup:[source("normal.png",{rowMode:"single"})],
        details:[],outputName:"SINGLE"});
    assert.equal(single.lineupRows[0].kind,"regular");
    assert.throws(()=>buildCombineLayout({single:null,lineup:[source("bad.png",{rowMode:"vertical",captionTopY:0.9})],
        details:[],outputName:"BAD"}),/caption positions/i);
    assert.throws(()=>buildCombineLayout({single:null,lineup:[source("overlap.png",{rowMode:"vertical",
        colorName:"クラウドホワイトクラウドホワイトクラウドホワイト",colorNameRight:"B",captionTopY:0.60,captionBottomY:0.70})],
        details:[],outputName:"OVERLAP"}),/overlap/i);
    assert.deepEqual(verticalPositions(null,null),{topY:0.44,bottomY:0.925});
    const found=detectedCaptionLayout([
        {text:"TOP SHOE",x:130,y:255,width:350,height:21},
        {text:"BOTTOM SHOE",x:137,y:555,width:336,height:23}
    ],600,600);
    assert.equal(found.mode,"vertical");
    assert.equal(found.topY,255/600);
    assert.equal(found.bottomY,555/600);
    const sideways=detectedCaptionLayout([
        {text:"LEFT",x:78,y:540,width:85,height:22},
        {text:"RIGHT",x:380,y:540,width:90,height:22}
    ],600,600);
    assert.equal(sideways.mode,"dual");
    assert.equal(detectedCaptionLayout([{text:"one",x:22,y:250}],600,600),null);
    assert.equal(detectedCaptionLayout([{text:"one",x:22,y:250},{text:"two",x:23,y:300}],600,600),null);

    const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),"brandforge-vertical-"));
    try {
        const original=path.join(root,"001_shoes.png");
        // Deliberate large white margins between and below the products.
        const png=await sharp({create:{width:600,height:600,channels:3,background:"#ffffff"}})
            .composite([
                {input:{create:{width:240,height:170,channels:3,background:"#324c69"}},left:170,top:40},
                {input:{create:{width:260,height:190,channels:3,background:"#333333"}},left:160,top:310}
            ]).png().toBuffer();
        await fs.promises.writeFile(original,png);
        const layout=buildCombineLayout({single:null,lineup:[source("001_shoes.png",{path:original,rowMode:"vertical",
            captionTopY:255/600,captionBottomY:555/600})],details:[],outputName:"FROM_SOURCE"});
        const prepared=await preparedEntry(layout.lineup[0],0,root,new Map());
        const meta=await sharp(prepared.input).metadata();
        assert.equal(meta.width,594);
        assert.equal(meta.height,594,"Full canvas, not visible-bounds trim");
        assert.equal(prepared.labels[0].y,layout.lineup[0].labels[0].y);
        assert.equal(prepared.labels[1].y,layout.lineup[0].labels[1].y);
        const data=await sharp(prepared.input).raw().toBuffer();
        const pixel=(x,y)=>(y*meta.width+x)*meta.channels;
        assert(data[pixel(15,275)]>240,"Original white gap between shoes was preserved");
        assert(data[pixel(15,540)]>240,"Original white gap near bottom caption was preserved");
        assert(data[pixel(290,80)]<150,"Product pixels preserved");
        // Downloaded auto-cleaned images can recover the two captions and their
        // original placement from slider_manifest.json, without rerunning OCR.
        const cleanFolder=path.join(root,"COMBINE_CLEANED");
        await fs.promises.mkdir(cleanFolder);
        const cleanedPath=path.join(cleanFolder,"001_shoes_textclean.png");
        await fs.promises.copyFile(original,cleanedPath);
        await fs.promises.writeFile(path.join(root,"slider_manifest.json"), JSON.stringify({images:[
            {path:original,width:600,height:600,cleanup:{cleanedPath,captions:[
                {text:"TOP WHITE",x:139,y:255},{text:"BOTTOM BLACK",x:145,y:555}]}}
        ]}));
        const service=new CombineService();
        const imported=await service.addFiles([cleanedPath]);
        assert.equal(imported.images[0].suggestedLineup.mode,"vertical");
        assert.equal(imported.images[0].suggestedLineup.first,"TOP WHITE");
        assert.equal(imported.images[0].suggestedLineup.second,"BOTTOM BLACK");
        const plan=service.layout({singlePath:null,lineup:[{path:cleanedPath,rowMode:"vertical",
            colorName:"TOP WHITE",colorNameRight:"BOTTOM BLACK",captionTopY:255/600,captionBottomY:555/600}],
            details:[],outputName:"FROM_MANIFEST"});
        assert.equal(plan.lineup[0].labels[1].side,"bottom");
    } finally {await fs.promises.rm(root,{recursive:true,force:true});}
    const jsx=fs.readFileSync(path.join(__dirname,"../src/modules/combine/jsx/compose.jsx"),"utf8");
    assert(jsx.includes('"_TOP"') && jsx.includes('"_BOTTOM"'));
    console.log("PASS: vertical Line Up geometry, original caption gaps, untrimmed products, OCR manifest, JSX layers, and horizontal regression");
}
run().catch(e=>{console.error(e);process.exitCode=1;});
