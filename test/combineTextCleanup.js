"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { TextCleanupService, normalizeAreas, suggestion } = require("../src/modules/combine/main/textCleanup");
const { CombineService } = require("../src/modules/combine/main/service");
const hash = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
(async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-cleanup-tests-"));
    try {
        const source = path.join(root, "001_rakuten_original.png");
        const background = { r: 235, g: 224, b: 212 };
        const svg = Buffer.from('<svg width="600" height="400"><rect x="130" y="320" width="95" height="20" fill="black"/><rect x="20" y="22" width="52" height="15" fill="#254c76"/></svg>');
        await sharp({ create:{width:600,height:400,channels:3,background} })
            .composite([{ input: svg, top:0, left:0 }]).png().toFile(source);
        const before = hash(source);
        const ocr = async () => ({ engine:"Test OCR: Japanese + English", blocks:[
            { x:125,y:316,width:106,height:26,text:"ブラック",confidence:94 },
            { x:20,y:15,width:40,height:17,text:"BRAND",confidence:91 }
        ] });
        const svc = new TextCleanupService({ ocr });
        const added = await svc.addFiles([source, path.join(root,"not-found.png")]);
        assert.equal(added.images.length,1);
        assert.equal(added.failed.length,1);
        assert.equal(added.images[0].width,600);
        const scan = await svc.scan(source);
        assert.equal(scan.engine,"Test OCR: Japanese + English");
        assert.equal(scan.regions.length,2);
        assert.equal(scan.regions[0].text,"ブラック");
        assert.equal(scan.regions[0].suggested,true);
        assert.equal(scan.regions[1].suggested,false);
        assert(scan.previewDataUrl.startsWith("data:image/png;base64,"));
        assert.equal(suggestion("Long paragraph that is not a color label", 30,{x:0,y:380,height:15},400),false);
        assert.throws(()=>normalizeAreas([],600,400),/at least one/);
        assert.throws(()=>normalizeAreas([{x:0,y:0,width:600,height:400}],600,400),/too large/);
        const areas = [{x:125,y:316,width:106,height:26}];
        const preview = await svc.preview({filePath:source,areas});
        assert(preview.previewDataUrl.startsWith("data:image/png;base64,"));
        assert.equal(preview.width,600);
        assert.deepEqual(preview.methods,["matched flat background"]);
        const saved = await svc.save({filePath:source,areas});
        assert(saved.path.includes("COMBINE_CLEANED"));
        assert(path.basename(saved.path).endsWith("_textclean.png"));
        assert.equal(hash(source),before,"Original source image must be byte-for-byte identical");
        const srcPixel = await sharp(source).raw().toBuffer({resolveWithObject:true});
        const dstPixel = await sharp(saved.path).raw().toBuffer({resolveWithObject:true});
        const px = (raw,x,y) => [...raw.data.subarray((y*raw.info.width+x)*raw.info.channels,(y*raw.info.width+x)*raw.info.channels+3)];
        assert.deepEqual(px(srcPixel,170,330),[0,0,0]);
        assert.deepEqual(px(dstPixel,170,330),[235,224,212]);
        assert.deepEqual(px(srcPixel,40,30),[37,76,118]);
        assert.deepEqual(px(srcPixel,40,30),px(dstPixel,40,30),"Unselected logo pixels must be identical");
        const saved2 = await svc.save({filePath:source,areas});
        assert.notEqual(saved.path,saved2.path,"Never overwrite an earlier cleaned PNG");
        assert(path.basename(saved2.path).endsWith("_textclean_v2.png"));
        // Real cleaned copies are ordinary images in the existing Combine pipeline.
        const combine = new CombineService();
        await combine.addFiles([saved.path]);
        const layout = combine.layout({singlePath:null,lineup:[{path:saved.path,colorName:"ブラック"}],details:[],outputName:"TEXTCLEAN_NO_SINGLE"});
        assert.equal(layout.single,null);
        assert.equal(layout.lineup[0].slotY,0);
        assert.equal(layout.lineup[0].labelLines[0],"ブラック");
        await fs.promises.writeFile(source,"new image bytes");
        await assert.rejects(svc.preview({filePath:source,areas}),/changed since selection/);
        console.log("PASS cleanup: Japanese/English OCR mapping, suggested captions, preview, pixel restoration, original safety, versioned output, Combine import and stale-source protection");
    } finally { await fs.promises.rm(root,{recursive:true,force:true}); }
})().catch(error=>{ console.error(error); process.exitCode=1; });
