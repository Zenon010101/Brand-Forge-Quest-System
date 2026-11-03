"use strict";
const assert=require("node:assert/strict");
const fs=require("fs");
const os=require("os");
const path=require("path");
const sharp=require("sharp");
const {RakutenImporter,findSliderImages,iframeUrls,safeUrl} = require("../src/modules/combine/main/rakutenImporter");
const {preparedEntry} = require("../src/modules/combine/main/photoshop");

const PAGE="https://www.rakuten.ne.jp/gold/glv/six/lavenham/LVH-97.html";
const ITEM="https://item.rakuten.co.jp/glv/lvh-97/";
const ORIGIN="https://image.rakuten.co.jp/glv/cabinet/lavenham/";
const URLS=Array.from({length:14},(_,i)=>ORIGIN+"lvh-97_"+(i+1)+".jpg");
const HTML=`<html><body><ul class="lSPager lSGallery" style="transform:translate3d(0px, 0px, 0px)">`+
    URLS.map(url=>`<li><a href="#"><img src="${url}"></a></li>`).join("")+
    `</ul></body></html>`;
async function run(){
    const list=findSliderImages(HTML,PAGE);
    assert.equal(list.method,"lightslider-gallery");
    assert.deepEqual(list.urls,URLS,"Keep the website slider order");
    assert.deepEqual(findSliderImages(HTML.replace("lSPager lSGallery","imageGallery"),PAGE).urls,URLS);
    assert.deepEqual(iframeUrls(`<iframe src="${PAGE}"></iframe>`,ITEM),[PAGE]);
    assert.deepEqual(iframeUrls(`<iframe data-src="${PAGE}"></iframe>`,ITEM),[PAGE]);
    assert.equal(safeUrl(ITEM),ITEM);
    assert.throws(()=>safeUrl("http://item.rakuten.co.jp/glv/lvh-97/"),/Only public HTTPS/);
    assert.throws(()=>safeUrl("https://item.rakuten.co.jp.evil.net/fake"),/Only public HTTPS/);
    assert.throws(()=>safeUrl("https://localhost/private"),/Only public HTTPS/);

    const jpeg=await sharp({create:{width:120,height:80,channels:3,background:"#2c4555"}}).jpeg({quality:83}).toBuffer();
    const fakeItemImage=`https://image.rakuten.co.jp/glv/cabinet/item/thumb_1.jpg`;
    const misleadingItem=`<html><body><img src="${fakeItemImage}"><img src="${fakeItemImage.replace('_1.', '_2.')}"><iframe src="${PAGE}"></iframe></body></html>`;
    const fetcher=async url=>{
        if(url===ITEM) return {buffer:Buffer.from(misleadingItem),contentType:"text/html; charset=utf-8"};
        if(url===PAGE) return {buffer:Buffer.from(HTML),contentType:"text/html"};
        if(url===URLS[7]) throw new Error("simulated image timeout");
        if(URLS.includes(url)) return {buffer:jpeg,contentType:"image/jpeg"};
        throw new Error("unknown url: "+url);
    };
    const importer=new RakutenImporter({fetcher});
    const scanned=await importer.scan(ITEM);
    assert.equal(scanned.sourcePage,ITEM);
    assert.equal(scanned.sliderPage,PAGE);
    assert.equal(scanned.images.length,14);
    assert.deepEqual(scanned.images.map(x=>x.url),URLS);
    assert(scanned.images.every(x=>!Object.hasOwn(x,"suggestedCategory")),"Do not classify slider images");

    const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),"rakuten-download-only-"));
    try {
        const progress=[];
        const downloaded=await importer.download(root,p=>progress.push(p));
        assert.equal(downloaded.images.length,14);
        assert.equal(downloaded.images.filter(x=>x.status==="downloaded").length,13);
        assert.equal(downloaded.images[7].status,"failed");
        assert.equal(progress.length,14);
        const first=downloaded.images[0];
        assert.equal(path.dirname(first.path),downloaded.folder,"Keep numbered originals directly in the product folder");
        assert(path.basename(first.path).startsWith("001_lvh-97_1.jpg"));
        assert.deepEqual(await fs.promises.readFile(first.path),jpeg,"Download must not recompress, crop, or resize");
        const listing=await fs.promises.readdir(downloaded.folder);
        assert(listing.includes("slider_manifest.json"));
        assert(!listing.includes("00_ORIGINAL_SLIDES"));
        assert(!listing.includes("COMBINE_READY"));
        const manifest=JSON.parse(await fs.promises.readFile(path.join(downloaded.folder,"slider_manifest.json"),"utf8"));
        assert.equal(manifest.outputMode,"download-only");
        assert.equal(manifest.imageOrder,"website");
        assert.deepEqual(manifest.images.map(x=>x.index),Array.from({length:14},(_,i)=>i+1));
        assert(!Object.hasOwn(manifest,"classificationNote"));
        const downloadedAgain=await importer.download(root);
        assert.notEqual(downloadedAgain.folder,downloaded.folder,"Never overwrite older downloads");
        assert(!fs.existsSync(path.join(downloadedAgain.folder,"COMBINE_READY")));
        await importer.scan(PAGE);
        assert.equal(importer.scanned.sliderPage,PAGE);
    } finally {await fs.promises.rm(root,{recursive:true,force:true});}

    const failedItem=new RakutenImporter({fetcher:async url=>({buffer:Buffer.from('<html><body>No slider</body></html>'),contentType:'text/html'})});
    await assert.rejects(failedItem.scan(ITEM),/No slider images found/);

    const source=await fs.promises.mkdtemp(path.join(os.tmpdir(),"rakuten-no-stretch-test-"));
    try {
        const small=path.join(source,"small.jpg");
        await sharp({create:{width:120,height:80,channels:3,background:"#2c4555"}}).jpeg().toFile(small);
        const prepared=await preparedEntry({path:small,name:"small.jpg",width:120,height:80,
            slotX:3,slotY:615,slotWidth:293,slotHeight:293,isPhotoshop:false},0,source,new Map());
        const meta=await sharp(prepared.input).metadata();
        assert.equal(meta.width,120);
        assert.equal(meta.height,80);
        assert.equal(prepared.placedWidth,120);
        assert.equal(prepared.placedHeight,80);
        const jsx=fs.readFileSync(path.join(__dirname,"../src/modules/combine/jsx/compose.jsx"),"utf8");
        assert(jsx.includes("var factor = Math.min"));
        assert(!jsx.includes("100 * Number(dest.placedHeight) / b.h"));
    } finally {await fs.promises.rm(source,{recursive:true,force:true});}
    console.log("PASS: Rakuten product URL iframe discovery, ordered download-only output, byte preservation, failure isolation, and no-stretch Combine");
}
run().catch(error=>{console.error(error);process.exitCode=1;});
