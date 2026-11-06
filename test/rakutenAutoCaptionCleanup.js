"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");
const { RakutenImporter } = require("../src/modules/combine/main/rakutenImporter");
const { TextCleanupService } = require("../src/modules/combine/main/textCleanup");
const { autoCleanDownloadedImage, captionShape, chooseAutomaticAreas } = require("../src/modules/combine/main/autoCaptionCleanup");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const PNG = async (caption, background = "#f9f9f9") => {
    const objects = [
        {input:Buffer.from('<svg width="600" height="400"><rect x="180" y="40" width="220" height="230" fill="#345a75"/><rect x="250" y="170" width="80" height="20" fill="black"/></svg>')}
    ];
    if (caption) objects.push({input:Buffer.from('<svg width="600" height="400"><rect x="252" y="347" width="100" height="19" fill="black"/></svg>')});
    return sharp({create:{width:600,height:400,channels:3,background}}).composite(objects).png().toBuffer();
};
const PIXEL = (data, width, x, y) => [...data.subarray((y*width+x)*4,(y*width+x)*4+3)];
(async()=>{
    const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),"brandforge-auto-caption-"));
    try {
        const source=path.join(root,"001_main.png");
        const original=await PNG(true);
        await fs.promises.writeFile(source,original);
        const ocr=async (scanPath)=> {
            // A real OCR engine returns only words present in the slide.
            const {data,info}=await sharp(scanPath).ensureAlpha().raw().toBuffer({resolveWithObject:true});
            const hasCaption=PIXEL(data,info.width,270,355)[0] < 50;
            return {engine:"Tesseract (Test OCR)",blocks:[
                ...(hasCaption?[{text:"Off White (012)",x:250,y:344,width:104,height:24,confidence:96}]:[]),
                {text:"BRAND",x:250,y:169,width:82,height:22,confidence:97}
            ]};
        };
        const service=new TextCleanupService({ocr});
        const result=await autoCleanDownloadedImage(source,service);
        assert.equal(result.status,"cleaned");
        assert.equal(result.removedCount,1);
        assert.equal(result.captions[0].text,"Off White (012)");
        assert(result.cleanedPath.includes("COMBINE_CLEANED"));
        assert.equal(sha(await fs.promises.readFile(source)),sha(original),"original bytes unchanged");
        const rawOrig=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
        const rawClean=await sharp(result.cleanedPath).ensureAlpha().raw().toBuffer({resolveWithObject:true});
        assert(PIXEL(rawClean.data,600,275,355)[0]>225,"caption is no longer dark");
        assert.deepEqual(PIXEL(rawClean.data,600,270,179), PIXEL(rawOrig.data,600,270,179),"logo on product protected");
        assert.deepEqual(PIXEL(rawClean.data,600,370,250), PIXEL(rawOrig.data,600,370,250),"product remains unchanged");
        const blank=path.join(root,"002_no_caption.png");
        await fs.promises.writeFile(blank,await PNG(false));
        const empty=await autoCleanDownloadedImage(blank,service);
        assert.equal(empty.status,"no-caption");
        assert(!empty.cleanedPath,"no unnecessary duplicate for image without text");
        const unsafe=path.join(root,"003_text_on_product.png");
        await fs.promises.writeFile(unsafe,await PNG(true,"#395270"));
        const warning=await autoCleanDownloadedImage(unsafe,service);
        assert.equal(warning.status,"needs-review");
        assert(!warning.cleanedPath,"never auto-fill on a varied/dark background");
        assert.equal(warning.needsReviewCount,1);
        const unavailable=new TextCleanupService({ocr:async()=>({engine:"Unavailable",blocks:[],warning:"No OCR engine available"})});
        const noOcr=await autoCleanDownloadedImage(source,unavailable);
        assert.equal(noOcr.status,"needs-review");
        assert.match(noOcr.warning,/OCR engine/i);
        assert.equal(captionShape({text:"DETAILS",x:110,y:350,width:90,height:22,confidence:90},600,400,"Tesseract"),false);
        assert.equal(captionShape({text:"Off White",x:240,y:350,width:110,height:22,confidence:91},600,400,"Tesseract"),true);
        const preview=await chooseAutomaticAreas(source,{engine:"Tesseract",regions:[{text:"White",x:250,y:344,width:104,height:24,confidence:94}]});
        assert.equal(preview.approved.length,1);
        // Tesseract frequently merges two separated color names into ONE
        // full-width OCR line; the automatic stage should rescan the halves.
        const dualSource=path.join(root,"004_two_variants.png");
        const dualInk=Buffer.from('<svg width="600" height="400"><rect x="65" y="345" width="120" height="16" fill="black"/><rect x="365" y="345" width="120" height="16" fill="black"/></svg>');
        await sharp({create:{width:600,height:400,channels:3,background:"#ffffff"}})
            .composite([{input:dualInk}]).png().toFile(dualSource);
        const dualOcr=async (scanPath)=> {
            const file=path.basename(scanPath);
            if(file==="left.png") return {engine:"Tesseract",blocks:[{text:"Off White (012)",x:65,y:345,width:120,height:16,confidence:63}]};
            if(file==="right.png") return {engine:"Tesseract",blocks:[{text:"Spugnola(110)",x:65,y:345,width:120,height:16,confidence:95}]};
            return {engine:"Tesseract",blocks:[{text:"Off White (012) Spugnola(110)",x:65,y:345,width:420,height:16,confidence:94}]};
        };
        const dual=await autoCleanDownloadedImage(dualSource,new TextCleanupService({ocr:dualOcr}));
        assert.equal(dual.status,"cleaned");
        assert.equal(dual.removedCount,2,"both labels are cleaned, not the whole 420px OCR rectangle");
        assert.deepEqual(dual.captions.map(x=>x.text),["Off White (012)","Spugnola(110)"]);

        // Entire post-download flow: downloaded originals keep bytes/order,
        // successful cleanup adds a separate copy, and failure is isolated.
        const PAGE="https://www.rakuten.ne.jp/gold/glv/example/slider.html";
        const imageUrls=["https://image.rakuten.co.jp/glv/cabinet/item_1.png","https://image.rakuten.co.jp/glv/cabinet/item_2.png"];
        const images=[original,await PNG(false)];
        const html=`<ul class="lSPager lSGallery">${imageUrls.map(x=>`<li><img src="${x}"></li>`).join("")}</ul>`;
        const fetcher=async url=>url===PAGE?{buffer:Buffer.from(html),contentType:"text/html"}:
            {buffer:images[imageUrls.indexOf(url)],contentType:"image/png"};
        const importer=new RakutenImporter({fetcher});
        await importer.scan(PAGE);
        const progress=[];
        const run=await importer.download(root,p=>progress.push(p),{autoClean:true,autoCleaner:input=>autoCleanDownloadedImage(input,service)});
        assert.equal(run.autoCleanupEnabled,true);
        assert.equal(run.images.length,2);
        assert.deepEqual(run.images.map(x=>x.status),["downloaded","downloaded"]);
        assert.deepEqual(run.images.map(x=>x.cleanup.status),["cleaned","no-caption"]);
        assert(fs.existsSync(run.images[0].cleanup.cleanedPath));
        assert.equal(sha(await fs.promises.readFile(run.images[0].path)),sha(original));
        assert(progress.some(p=>p.status==="cleaning"));
        const manifest=JSON.parse(await fs.promises.readFile(path.join(run.folder,"slider_manifest.json"),"utf8"));
        assert.equal(manifest.originalsPreserved,true);
        assert.equal(manifest.autoCleanupEnabled,true);
        assert.equal(manifest.images[0].cleanup.captions[0].text,"Off White (012)");
        assert.equal(manifest.images[1].cleanup.status,"no-caption");
        const failure=await importer.download(root,()=>{}, {autoClean:true,autoCleaner:async()=>{throw new Error("OCR crashed");}});
        assert.equal(failure.images[0].status,"downloaded");
        assert.equal(failure.images[0].cleanup.status,"needs-review");
        assert.match(failure.images[0].cleanup.warning,/OCR crashed/);
        const old=await importer.download(root,()=>{});
        assert.equal(old.images[0].status,"downloaded");
        assert(!old.images[0].cleanup);
        assert.equal(old.autoCleanupEnabled,false);
        console.log("PASS: automatic conservative captions, logo safety, OCR fallback, originals, ordered manifest, download error isolation");
    } finally {await fs.promises.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
