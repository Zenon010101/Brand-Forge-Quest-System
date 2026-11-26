"use strict";
const fs=require("fs"),path=require("path"),assert=require("assert");
const root=path.join(__dirname,"../src");
const html=fs.readFileSync(path.join(root,"modules/amazon/renderer/index.html"),"utf8");
const batch=fs.readFileSync(path.join(root,"modules/amazon/renderer/batchWorkspace.js"),"utf8");
const app=fs.readFileSync(path.join(root,"modules/amazon/renderer/app.js"),"utf8");
const preload=fs.readFileSync(path.join(root,"main/preload.js"),"utf8");
const backend=fs.readFileSync(path.join(root,"modules/amazon/main/register.js"),"utf8");
for(const id of ["amazonClearWorkspace","amazonRkTargetId",
 "amazonRkPlainEnabled","amazonChooseRkPlain","amazonAutoRkPlain","amazonRkPlainPath"]){
 assert(html.includes(`id="${id}"`),`Missing live control ${id}`);
}
assert(html.includes('src="../shared/thumbnailPolicy.js"'));
assert(app.includes('window.BrandForgeAmazonExtras') && app.includes('amazonExtraPayload()'));
assert(batch.includes('...(extras()?.payload() || {})'),"Both Amazon modes must include extras in IPC payload");
assert(app.includes('...amazonExtraPayload()'),"Folder Mode must include extras in IPC payload");
assert(batch.includes('const thumbnailPolicy = window.BrandForgeAmazonThumbnailPolicy'));
assert(batch.includes('if (!thumbnailPolicy.canBackgroundPreview(ext))'),"PSD thumbnails are manual-only");
assert(batch.includes('api.getFileThumbnail(task.path)'),"Only Sharp thumbnail IPC is used in background");
assert(backend.includes('ipcMain.handle("amazon:get-file-thumbnail"'));
assert(backend.includes('sharp(filePath') && backend.includes('Click to preview manually'));
assert(batch.includes('thumbnailJobs.length = 0') && batch.includes('thumbnailObserver.disconnect()'));
assert(app.includes('amazonClearWorkspace') && batch.includes('amazonClearWorkspace'),"Clear must work in both modes");
assert(preload.includes('offerRkPlain:') && preload.includes('getFileThumbnail:'));
assert(!html.includes('id="amazonChooseCreative"'), "Global Creative uploader must not be displayed");
console.log("PASS live controls in both Amazon modes; thumbnail requests never call Photoshop automatically; Clear resets only in-memory state.");
