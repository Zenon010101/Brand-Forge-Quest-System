"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const { validateVirtualBatch } = require("../src/modules/amazon/main/batchWorkspace");
const { withCreativeSecond, findRkPlainFolder, validatedRkPlainFolder, exportRkPlain,
    rkPlainName } = require("../src/modules/amazon/main/amazonExtras");
const thumbs = require("../src/modules/amazon/shared/thumbnailPolicy");

async function run() {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "amazon-extras-v1757-"));
    const output = path.join(root, "amazon");
    const brand = path.join(root, "brand");
    const plain = path.join(brand, "SINGLE", "RAKUTEN", "!!RAK PLAIN!!");
    await fs.promises.mkdir(output, { recursive:true });
    await fs.promises.mkdir(plain, { recursive:true });
    const marker = path.join(plain, "PLAIN.psd");
    const markerBytes = Buffer.from("DO NOT EDIT TEMPLATE");
    await fs.promises.writeFile(marker, markerBytes);
    const colors = [[210,0,0],[0,5,211],[20,173,32],[192,175,10]];
    const files = [];
    try {
        for (const [i,color] of colors.entries()) {
            const file = path.join(root, `input_${i}.png`);
            await sharp({ create:{ width:240,height:240,channels:4,background:{r:color[0],g:color[1],b:color[2],alpha:1} } }).png().toFile(file);
            files.push(file);
        }
        const selected = [files[0], files[2]].map(p=>({path:p,name:path.basename(p)}));
        const payload = { groups: [ { id:"A-100",files:selected,sharedIds:["A-101"] } ], outputFolder:output };
        const checked = await validateVirtualBatch(payload);
        assert(checked.ok,checked.errors.join("; "));
        const enhanced = await withCreativeSecond(checked.parents,files[1]);
        assert.deepStrictEqual(enhanced[0].variants[0].files.map(f=>f.path),[files[0],files[1],files[2]]);
        assert.deepStrictEqual(checked.parents[0].variants[0].files.map(f=>f.path),[files[0],files[2]],"no mutation of selection");
        assert.deepStrictEqual((await withCreativeSecond(checked.parents,"")),checked.parents);
        await assert.rejects(withCreativeSecond(checked.parents,files[0]),/already selected/i);
        const duplicate = {id:"EIGHT",files:Array.from({length:8},()=>selected[0]),sharedIds:[]};
        await assert.rejects(withCreativeSecond([{id:"A",variants:[duplicate]}],files[1]),/at most 7/i);
        await assert.rejects(withCreativeSecond(checked.parents,path.join(root,"missing.psd")),/ENOENT/);
        assert.strictEqual(findRkPlainFolder(brand),fs.realpathSync(plain));
        assert.throws(()=>validatedRkPlainFolder(output),/PLAIN\.psd/i);
        assert.strictEqual(rkPlainName("A-100"),"a-100plain.jpg");
        for (const type of ["one.psd","one.psb","one.tiff","one.heic","one.gif","one.avif", "one.bmp"]) {
            assert(!thumbs.canBackgroundPreview(type),`NEVER auto-preview ${type}`);
        }
        for (const type of ["one.png","one.JPG","one.jpeg","one.webp"]) assert(thumbs.canBackgroundPreview(type));

        const psdId = require.resolve("../src/modules/amazon/main/psdBuilder");
        const sharingId = require.resolve("../src/modules/amazon/main/sharedJob");
        require(psdId);
        const originalPsd = require.cache[psdId].exports;
        require.cache[psdId].exports = {buildAmazonPsd:async (_name,parents,dest)=>{
            assert.deepStrictEqual(parents[0].variants[0].layers.map(l=>l.layerName),["A-100","A-100_2","A-100_3"]);
            await fs.promises.writeFile(dest,"TEST PSD");
        }};
        delete require.cache[sharingId];
        try {
            const sharing=require(sharingId);
            const request={parents:enhanced,outputFolder:output};
            const preflight=await sharing.inspectSharingRequest(request,{baseName:"MASTER",fileName:"MASTER.psd"});
            assert(preflight.ok,preflight.errors?.join("; "));
            assert.strictEqual(preflight.jpgCount,6,"Main 3 + Shared 3");
            const result=await sharing.processSharedAmazonJob({senderFrame:{send() {}}},
                {...request,confirmedExistingFiles:[]},{baseName:"MASTER",fileName:"MASTER.psd"},preflight);
            assert(result.ok && result.successful===2 && result.failed===0);
            const main=path.join(output,"A-100.jpg");
            const creative=path.join(output,"A-100_2.jpg");
            const detail=path.join(output,"A-100_3.jpg");
            assert((await sharp(creative).metadata()).width===1001);
            assert(! (await fs.promises.readFile(main)).equals(await fs.promises.readFile(creative)));
            assert(! (await fs.promises.readFile(detail)).equals(await fs.promises.readFile(creative)));
            for(let i=1;i<=3;i++){
                const suffix=i===1?"":`_${i}`;
                assert((await fs.promises.readFile(path.join(output,`A-100${suffix}.jpg`))).equals(
                    await fs.promises.readFile(path.join(output,`A-101${suffix}.jpg`))), "shared IDs inherit creative #2");
            }
            const items=[{id:"A-100",jpg:main}];
            let exported=await exportRkPlain(items,plain,[],[...files,main,creative,detail]);
            assert(exported.ok && exported.saved.length===1);
            const rk=path.join(plain,"a-100plain.jpg");
            assert((await fs.promises.readFile(rk)).equals(await fs.promises.readFile(main)),"RK Plain copied the rendered main JPG unchanged");
            assert((await fs.promises.readFile(marker)).equals(markerBytes),"marker PSD unmodified");
            exported=await exportRkPlain(items,plain,[],[...files,main]);
            assert(!exported.ok && exported.requiresApproval);
            assert.deepStrictEqual(exported.existing,["a-100plain.jpg"]);
            exported=await exportRkPlain(items,plain,["a-100plain.jpg"],[...files,main]);
            assert(exported.ok && exported.saved.length===1);
            await assert.rejects(exportRkPlain([{id:"A-100",jpg:main},{id:"a-100",jpg:main}],plain,[]),/collision/i);
            // If the user's SOURCE is named like the plain output, it must never be overwritten.
            await assert.rejects(exportRkPlain(items,plain,["a-100plain.jpg"],[rk]),/overwrite a source/i);
        } finally {
            require.cache[psdId].exports=originalPsd;
            delete require.cache[sharingId];
        }
        console.log("PASS Creative #2: exact Main-Creative-Detail order, 8-image cap, shared-ID output and 1001px rendering.");
        console.log("PASS RK Plain: marker auto-discovery, exact first-JPEG copy, safe overwrite, marker and source protected.");
        console.log("PASS background thumbnails: PSD/PSB and Photoshop-only formats are manual; PNG/JPG/WebP are whitelisted.");
    } finally { await fs.promises.rm(root,{recursive:true,force:true}); }
}
run().catch(err=>{console.error(err);process.exitCode=1;});
