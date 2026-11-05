"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { TextCleanupService, renderCleanPng } = require("../src/modules/combine/main/textCleanup");
const { normalizeStrokes, createSelectionMask, cleanFillPixels } = require("../src/modules/combine/main/maskCleanup");
(async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-precision-"));
    try {
        const file = path.join(dir, "dual-row.png");
        const width = 240, height = 160;
        const background = { r: 242, g: 238, b: 231 };
        const svg = Buffer.from(`<svg width="240" height="160">
          <rect x="30" y="50" width="45" height="53" fill="#207ba4"/>
          <rect x="98" y="111" width="44" height="13" fill="black"/>
          <rect x="175" y="10" width="50" height="18" fill="#de2066"/>
        </svg>`);
        await sharp({create:{width,height,channels:3,background}})
            .composite([{input:svg,top:0,left:0}]).png().toFile(file);
        const source = await fs.promises.readFile(file);
        const pixels = async buff => sharp(buff).ensureAlpha().raw().toBuffer({resolveWithObject:true});
        const color = (img,x,y) => [...img.data.subarray((y*img.info.width+x)*4,(y*img.info.width+x)*4+4)];
        const original = await pixels(source);
        const options = {engine:"clean",areas:[{x:25,y:87,width:128,height:48}],strokes:[
            {mode:"erase",size:44,points:[[52,96]]},
            {mode:"add",size:19,points:[[110,117],[130,117]]},
            {mode:"erase",size:8,points:[[110,117]]}
        ]};
        const result = await renderCleanPng(file,options.areas,options.engine,options.strokes,0);
        const after = await pixels(result.png);
        assert.deepEqual(result.methods,["Clean Fill (selected pixels only)"]);
        assert.deepEqual(color(after,52,96),color(original,52,96),"Eraser must protect pixels inside an approved OCR area");
        assert.deepEqual(color(after,190,19),color(original,190,19),"Unselected logo must be byte-identical");
        assert.deepEqual(color(after,200,120),color(original,200,120),"Pixels outside the mask must remain unchanged");
        assert.notDeepEqual(color(after,125,117),color(original,125,117),"Caption pixel inside mask must be cleaned");
        assert.deepEqual(color(after,125,117),[242,238,231,255],"Clean Fill on a plain background must restore background color");
        assert.deepEqual(color(after,110,117),color(original,110,117),"Eraser hole must preserve even caption pixels");
        const onlyBrush = [{mode:"add",size:27,points:[[120,117]]},{mode:"erase",size:9,points:[[120,117]]}];
        const brushResult = await renderCleanPng(file,[],"clean",onlyBrush,0);
        const brushPixels = await pixels(brushResult.png);
        assert.deepEqual(color(brushPixels,120,117),color(original,120,117),"Brush-only erase-hole remains untouched");
        assert.notDeepEqual(color(brushPixels,131,117),color(original,131,117),"Brush-only selection removes text outside eraser hole");
        assert.throws(()=>normalizeStrokes([{mode:"erase",size:20,points:[[NaN,5]]}],width,height),/out of bounds/);
        assert.throws(()=>createSelectionMask(width,height,[],[]),/No pixels are selected/);
        assert.throws(()=>normalizeStrokes([{mode:"generate",size:50,points:[[20,20]]}],width,height),/Invalid brush/);
        const mask = createSelectionMask(20,20,[],normalizeStrokes([{mode:"add",size:10,points:[[10,10]]},{mode:"erase",size:4,points:[[10,10]]}],20,20));
        assert.equal(mask.mask[10*20+10],0);
        assert.equal(mask.mask[10*20+14],1);
        const flatSrc = Buffer.alloc(20*20*4,255);
        const clean = cleanFillPixels(flatSrc,20,20,mask.mask);
        for (let i = 0; i < mask.mask.length; i++) if (!mask.mask[i]) {
            assert.deepEqual([...clean.result.subarray(i*4,i*4+4)],[255,255,255,255]);
        }
        await assert.rejects(renderCleanPng(file,options.areas,"photoshop",options.strokes),/require Clean Fill/);
        await assert.rejects(renderCleanPng(file,[],"clean",[{mode:"erase",size:5,points:[[80,80]]}]),/at least one caption area/);
        const svc = new TextCleanupService({ocr:async()=>({engine:"fixture",blocks:[]})});
        await svc.addFiles([file]);
        const prev = await svc.preview({filePath:file, ...options});
        assert(prev.previewDataUrl.startsWith("data:image/png;base64,"));
        const saved = await svc.save({filePath:file,...options});
        assert(saved.path.includes("COMBINE_CLEANED"));
        assert.deepEqual(await fs.promises.readFile(file),source,"Original downloaded bytes never change");
        const final = await pixels(await fs.promises.readFile(saved.path));
        assert.deepEqual(color(final,52,96),color(original,52,96));
        console.log("PASS Combine precision: mask add/erase, eraser holes, no edits outside mask, brush-only cleanup, safe original and save, Photoshop brush guard");
    } finally { await fs.promises.rm(dir,{recursive:true,force:true}); }
})().catch(err => {console.error(err);process.exitCode=1;});
