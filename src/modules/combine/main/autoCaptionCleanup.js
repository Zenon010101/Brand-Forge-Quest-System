"use strict";

// Conservative post-download caption cleanup. We DO NOT remove every OCR word:
// product prints/logos and text over photographs require manual review.
// Originals are never edited; successful Clean Fill output is versioned into
// COMBINE_CLEANED by the existing TextCleanupService.
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const sharp = require("sharp");

const SAFE_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".avif"]);
const NON_CAPTION = /^(?:details?|size|sizes|spec(?:ification)?s?|features?|brand|logo|material|price|line\s*up|item|sku|cm|mm|kg)$/i;

function captionShape(region, width, height, engine = "") {
    const label = String(region?.text || "").trim();
    if (!label || label.length > 42 || NON_CAPTION.test(label) || /(?:https?:|www\.|@|[¥￥$]|\n)/i.test(label)) return false;
    const x = Number(region.x), y = Number(region.y), w = Number(region.width), h = Number(region.height);
    if (![x,y,w,h].every(Number.isFinite) || w < 8 || h < 5 || w > width * .60 || h > height * .09) return false;
    if (w < h * 1.2 || y < height * .40 || x < 0 || y < 0 || x + w > width || y + h > height) return false;
    // Tesseract provides confidence, Windows OCR doesn't. The latter needs a
    // lower-page position plus the strict uniform-background check below.
    const confidence = region.confidence;
    if (confidence == null) return /windows ocr/i.test(engine) && y > height * .57;
    // A wide, high-confidence OCR line may contain two separate labels;
    // rescanning each half sometimes lowers confidence on individual words.
    const cutoff = region.recoveredFromDual && region.parentConfidence >= 85 ? 55 : 72;
    return Number.isFinite(Number(confidence)) && Number(confidence) >= cutoff;
}

function uniformLightBackground(data, width, height, region) {
    const x0 = Math.floor(region.x), y0 = Math.floor(region.y);
    const x1 = Math.ceil(Number(region.x) + Number(region.width));
    const y1 = Math.ceil(Number(region.y) + Number(region.height));
    // Probe a ring OUTSIDE the OCR text box; never infer background from ink.
    // This intentionally rejects captions touching a product silhouette.
    const halo = Math.max(15, Math.min(28, Math.round(region.height * 1.4)));
    const step = Math.max(2, Math.ceil(Math.max(x1-x0,y1-y0)/38));
    const colors = [], bad = [], safeColors = [];
    for (let y = Math.max(0,y0-halo); y < Math.min(height,y1+halo); y += step) {
        for (let x = Math.max(0,x0-halo); x < Math.min(width,x1+halo); x += step) {
            if (x >= x0 - 5 && x < x1 + 5 && y >= y0 - 5 && y < y1 + 5) continue;
            const offset = (y * width + x) * 4;
            const r=data[offset], g=data[offset+1], b=data[offset+2], a=data[offset+3];
            const avg=(r+g+b)/3;
            const good = a >= 245 && avg >= 224 && Math.min(r,g,b) >= 205 && Math.max(r,g,b)-Math.min(r,g,b) <= 48;
            colors.push(avg);
            bad.push(!good);
            if (good) safeColors.push(avg);
        }
    }
    if (colors.length < 14) return false;
    const mean=safeColors.reduce((a,b)=>a+b,0)/safeColors.length;
    const deviation=Math.sqrt(safeColors.reduce((s,v)=>s+(v-mean)**2,0)/safeColors.length);
    // Small patches of a nearby coat can appear above a legitimate caption.
    // Allow a few non-background outliers, but only use clean ring pixels for
    // variance. Actual edits remain bounded by the OCR text box.
    return bad.filter(Boolean).length / colors.length <= .08 && deviation <= 11;
}

// OCR often merges the two color names in a dual-item source into one wide
// line. Detect a genuine large gap between dark glyph columns, then rescan
// each half. Never cut a single long caption in half by word count alone.
function mergedDualLine(data, width, height, region) {
    if (Number(region.width) < width * .60 || Number(region.y) < height * .40 ||
        Number(region.height) > height * .09 || String(region.text || "").length > 110) return false;
    const start=Math.max(0,Math.floor(region.x)), end=Math.min(width,Math.ceil(region.x+region.width));
    const top=Math.max(0,Math.floor(region.y)), bottom=Math.min(height,Math.ceil(region.y+region.height));
    const columns=[];
    for (let x=start;x<end;x++) {
        let ink=false;
        for (let y=top;y<bottom;y+=2) {
            const p=(y*width+x)*4;
            if (data[p+3]>=200 && (data[p]+data[p+1]+data[p+2])/3 < 177) {ink=true;break;}
        }
        columns.push(ink);
    }
    let run=0, longest=0, startGap=0;
    for (let i=0;i<=columns.length;i++) {
        if (i<columns.length && !columns[i]) {run++;continue;}
        const from=i-run;
        if (run>longest && from>columns.length*.22 && i<columns.length*.78) {
            longest=run;startGap=from;
        }
        run=0;
    }
    const midpoint=start+startGap+longest/2;
    return longest>=Math.max(24,columns.length*.12) && Math.abs(midpoint-width/2)<width*.19;
}

async function separateMergedDualNames(filePath, cleanupService, scan) {
    if (!scan.regions?.some(r=>r.width > scan.width*.60)) return scan;
    const {data,info}=await sharp(filePath,{animated:false,limitInputPixels:32_000_000})
        .rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const wide=scan.regions.filter(r=>mergedDualLine(data,info.width,info.height,r));
    if (!wide.length) return scan;
    const parentConfidence=Math.max(...wide.map(r=>Number(r.confidence)||0));
    const folder=await fs.promises.mkdtemp(path.join(os.tmpdir(),"brandforge-dual-ocr-"));
    const blocks=[];
    const half=Math.floor(info.width/2);
    try {
        for (const [left,span] of [[0,half],[half,info.width-half]]) {
            const png=path.join(folder,left ? "right.png" : "left.png");
            await sharp(filePath,{animated:false,limitInputPixels:32_000_000}).rotate()
                .extract({left,top:0,width:span,height:info.height}).flatten({background:"#ffffff"}).png().toFile(png);
            const result=await cleanupService.ocr(png,{workDir:folder});
            for (const b of result.blocks || []) {
                blocks.push({text:String(b.text||"").trim(),x:Number(b.x)+left,y:Number(b.y),
                    width:Number(b.width),height:Number(b.height),confidence:b.confidence,
                    recoveredFromDual:true,parentConfidence});
            }
        }
    } finally {await fs.promises.rm(folder,{recursive:true,force:true}).catch(()=>{});}
    // Treat the original merged rectangle as unsafe if halves could not be
    // recognized independently. Do not silently remove a full-width region.
    const kept=scan.regions.filter(r=>!wide.includes(r));
    return {...scan,regions:[...kept,...blocks], dualRescanFailed:blocks.length===0};
}

async function chooseAutomaticAreas(filePath, scan) {
    const source=await sharp(filePath, {animated:false,limitInputPixels:32_000_000})
        .rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const {data,info}=source;
    const approved=[], needsReview=[];
    for (const region of scan.regions || []) {
        if (!captionShape(region,info.width,info.height,scan.engine)) continue;
        if (!uniformLightBackground(data,info.width,info.height,region)) {
            needsReview.push({text:region.text, reason:"Text may overlap the product or a non-uniform background"});
            continue;
        }
        approved.push({text:region.text,x:region.x,y:region.y,width:region.width,height:region.height});
    }
    return {approved, needsReview};
}

async function autoCleanDownloadedImage(filePath, cleanupService) {
    if (!SAFE_IMAGE_EXTS.has(path.extname(filePath).toLowerCase())) {
        return { status:"needs-review", removedCount:0, warning:"This image format needs manual text cleanup." };
    }
    const added=await cleanupService.addFiles([filePath]);
    if (!added.images.length) throw new Error(added.failed[0]?.error || "Could not register downloaded slide for cleanup.");
    let scan=await cleanupService.scan(filePath);
    if (scan.engine === "Unavailable") {
        return {status:"needs-review",removedCount:0,ocrEngine:scan.engine,
            warning:scan.warning || "OCR is unavailable. Original slide retained."};
    }
    try { scan=await separateMergedDualNames(filePath,cleanupService,scan); }
    catch (_) { scan={...scan, regions:scan.regions.filter(r=>r.width<scan.width*.60),dualRescanFailed:true}; }
    const {approved,needsReview}=await chooseAutomaticAreas(filePath,scan);
    if (scan.dualRescanFailed) needsReview.push({reason:"Two side-by-side captions were not recognized separately"});
    if (!approved.length) {
        return {status:needsReview.length ? "needs-review" : "no-caption", removedCount:0,
            needsReviewCount:needsReview.length,ocrEngine:scan.engine,
            warning:needsReview.length ? "Caption may overlap product/details; review manually." : "No safely removable caption detected."};
    }
    const saved=await cleanupService.save({filePath,areas:approved,engine:"clean",feather:0});
    return {status:needsReview.length ? "partial" : "cleaned",cleanedPath:saved.path,
        removedCount:approved.length,needsReviewCount:needsReview.length,ocrEngine:scan.engine,
        captions:approved.map(({text,x,y})=>({text,x,y})),
        warning:needsReview.length ? "Some text needs manual review; only safe caption regions were cleaned." : "",
        warnings:saved.warnings || []};
}

module.exports={autoCleanDownloadedImage,chooseAutomaticAreas,captionShape,uniformLightBackground,mergedDualLine,separateMergedDualNames};
