"use strict";

const { app, dialog, ipcMain, shell } = require("electron");
const { recordProductionEvent } = require("../../profile/main/service");
const { recordCompletedProduction } = require("../../profile/main/productionEvents");
const { CombineService } = require("./service");
const service = new CombineService();
const { RakutenImporter } = require("./rakutenImporter");
const rakutenImporter = new RakutenImporter();
const sharp = require("sharp");
const { TextCleanupService } = require("./textCleanup");
const textCleanup = new TextCleanupService();
const { autoCleanDownloadedImage } = require("./autoCaptionCleanup");
const { IframeBatchService } = require("./iframeBatchService");
const { ElectronJpegRenderer } = require("./iframeJpegRenderer");
const iframeBatch = new IframeBatchService();
const path = require("path");
const fs = require("fs");
const { iframeUrl, outputStem } = require("./iframeHtml");

const FILTERS = [{ name: "Photoshop and image files", extensions: ["jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "gif", "psd", "psb", "avif", "heic", "heif", "tga", "svg", "jp2", "exr", "hdr"] },
    { name: "All files", extensions: ["*"] }];
function sendProgress(event, update) {
    try {
        const frame = event.senderFrame;
        if (frame && !(typeof frame.isDestroyed === "function" && frame.isDestroyed())) {
            frame.send("combine:progress", update);
        }
    } catch (_) { /* final IPC response is authoritative */ }
}
ipcMain.handle("combine:choose-files", async (_event, section) => {
    const result = await dialog.showOpenDialog({
        title: section === "single" ? "Select Single image" : section === "lineup" ? "Select Line Up images" : "Select Detail images",
        defaultPath: app.getPath("pictures"),
        properties: section === "single" ? ["openFile"] : ["openFile", "multiSelections"], filters: FILTERS
    });
    if (result.canceled) return { images: [], failed: [], added: 0 };
    return service.addFiles(result.filePaths);
});
ipcMain.handle("combine:add-paths", (_event, paths) => service.addFiles(paths));
ipcMain.handle("combine:get-state", () => service.getState());
ipcMain.handle("combine:reset", () => service.reset());
ipcMain.handle("combine:choose-output", async () => {
    const result = await dialog.showOpenDialog({ title: "Choose folder for Combine PSD and JPEG",
        properties: ["openDirectory"], defaultPath: service.outputFolder || app.getPath("pictures") });
    if (result.canceled || !result.filePaths.length) return service.getState();
    return service.setOutputFolder(result.filePaths[0]);
});
ipcMain.handle("combine:preview", (_event, payload) => service.preview(payload || {}));
ipcMain.handle("combine:layout", (_event, payload) => service.layout(payload || {}));
ipcMain.handle("combine:generate", async (event, payload) => {
    const result = await service.generate(payload || {}, p => sendProgress(event, p));
    return recordCompletedProduction("combine", result, {}, recordProductionEvent);
});
ipcMain.handle("combine:open-output", () => {
    if (!service.lastOutput) throw new Error("Generate a Combine file first.");
    shell.showItemInFolder(service.lastOutput);
    return { ok: true };
});
// Rakuten download is independent of the Photoshop generator. All remote
// requests are Rakuten HTTPS allowlisted by rakutenImporter.js.
ipcMain.handle("combine:rakuten-scan", (_event, data) =>
    rakutenImporter.scan(data?.url, data?.html));
ipcMain.handle("combine:rakuten-choose-folder", async () => {
    const result = await dialog.showOpenDialog({title:"Choose local folder for Rakuten slider downloads",
        properties:["openDirectory"],defaultPath:app.getPath("downloads")});
    return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("combine:rakuten-download", (event, request) => {
    const target = typeof request === "string" ? request : request?.folder;
    const autoClean = typeof request === "string" ? false : request?.autoClean === true;
    return rakutenImporter.download(target || app.getPath("downloads"), update => {
        try { event.senderFrame.send("combine:rakuten-progress", update); }
        catch (_) { /* final response is authoritative */ }
    }, {autoClean, autoCleaner:file => autoCleanDownloadedImage(file,textCleanup)});
});
ipcMain.handle("combine:rakuten-open-folder", async () => {
    const destination = rakutenImporter.downloaded?.folder;
    if (!destination) throw new Error("Download slider images first.");
    const error = await shell.openPath(destination);
    if (error) throw new Error(`Could not open the downloaded folder: ${error}`);
    return { ok:true, folder:destination };
});
ipcMain.handle("combine:rakuten-preview", async (_event, request) => {
    const index = typeof request === "object" ? request.index : request;
    const original = typeof request === "object" && request.original === true;
    const item = rakutenImporter.downloaded?.images.find(x => x.index === Number(index));
    if (!item?.path) return null;
    const source = !original && item.cleanup?.cleanedPath ? item.cleanup.cleanedPath : item.path;
    const image = await sharp(source).resize({width:400,height:400,fit:"inside",withoutEnlargement:true}).png().toBuffer();
    return "data:image/png;base64,"+image.toString("base64");
});
// Non-destructive caption cleanup is user-triggered. Downloaded originals remain
// independent of the Combine import queues unless a cleaned copy is approved.
const CLEANUP_FILTERS = [{ name: "Raster images for text cleanup", extensions: ["jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "gif", "avif"] }];
ipcMain.handle("combine:cleanup-choose-files", async () => {
    const picked = await dialog.showOpenDialog({ title: "Choose images for optional text cleanup",
        defaultPath: app.getPath("pictures"), properties: ["openFile", "multiSelections"], filters: CLEANUP_FILTERS });
    return picked.canceled ? { images: [], failed: [] } : textCleanup.addFiles(picked.filePaths);
});
ipcMain.handle("combine:cleanup-add-downloaded", () => {
    const files = (rakutenImporter.downloaded?.images || [])
        .filter(item => item.status === "downloaded" && item.path).map(item => item.path);
    if (!files.length) throw new Error("Download Rakuten slider images first, or choose files for cleanup.");
    return textCleanup.addFiles(files);
});
ipcMain.handle("combine:cleanup-scan", (_event, filePath) => textCleanup.scan(filePath));
ipcMain.handle("combine:cleanup-preview", (_event, payload) => textCleanup.preview(payload || {}));
ipcMain.handle("combine:cleanup-save", async (_event, payload) => {
    const saved = await textCleanup.save(payload || {});
    // The user separately chooses the target Single / Line Up / Details section.
    // A verified cleaned copy is registered for the existing Combine layout.
    const imported = await service.addFiles([saved.path]);
    return { ...saved, imported };
});
// HTML-only Combine, independent of Photoshop and image download/cleanup flows.
ipcMain.handle("combine:html:choose-excel", async () => {
    const result=await dialog.showOpenDialog({title:"Choose iframe list Excel workbook (.xlsx)",
        properties:["openFile"],filters:[{name:"Excel workbook",extensions:["xlsx"]}]});
    return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("combine:html:choose-output", async () => {
    const result=await dialog.showOpenDialog({title:"Choose output folder for Combine HTML batch",
        properties:["openDirectory"],defaultPath:app.getPath("documents")});
    return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("combine:html:inspect-excel", (_event,file) => iframeBatch.inspectExcel(file));
ipcMain.handle("combine:html:preview", async (_event,payload) => {
    const result=await iframeBatch.processIframe(payload?.iframe,{lineupCount:payload?.lineupCount,defaultLineupCount:payload?.defaultLineupCount});
    iframeBatch.lastPreview=result;
    return result;
});
ipcMain.handle("combine:html:batch", async (event,payload) => {
    const result=await iframeBatch.generateExcel(payload,p => sendProgressHtml(event,p));
    if (result.generatedFiles>0) {
        const historyResult=await recordCompletedProduction("combine",{
            ok:true,htmlBatch:true,outputPath:result.excelPath,sourceCount:result.generatedFiles,
            generatedFiles:result.generatedFiles,failed:result.failed,review:result.review
        },{},recordProductionEvent);
        return {...result,progression:historyResult.progression||null,
            progressionWarning:historyResult.progressionWarning||null};
    }
    return result;
});
ipcMain.handle("combine:html:cancel",()=>iframeBatch.cancel());
ipcMain.handle("combine:html:save-single", async (_event,payload) => {
    const base=await fs.promises.realpath(payload?.outputFolder);
    if(!(await fs.promises.stat(base)).isDirectory()) throw new Error("Choose a valid output folder.");
    const url=iframeUrl(payload?.iframe);
    const prepared=iframeBatch.lastPreview;
    if(!prepared || prepared.url!==url || !prepared.document || !prepared.code)
        throw new Error("Generate a valid HTML preview for this iframe before saving.");
    const content=prepared.document;
    const stem=outputStem(url,1).replace(/^00001_/,"");
    for(let v=1;v<=999;v++){
        const name=stem+(v===1?"":`_v${v}`);
        const full=path.join(base,name+".html");
        const jpeg=path.join(base,name+".jpg");
        try { await fs.promises.access(jpeg); continue; }
        catch(e) { if(e.code!=="ENOENT") throw e; }
        try { await fs.promises.writeFile(full,content,{encoding:"utf8",flag:"wx"}); }
        catch(e) { if(e.code==="EEXIST")continue;throw e; }
        const renderer=new ElectronJpegRenderer();
        try {
            await renderer.capture(full,jpeg,{expectedImages:prepared.images.length,renderHtml:prepared.jpegDocument});
            return {path:full,jpegPath:jpeg};
        } catch(error) {
            // Single-file command is all-or-nothing; never leave a half pair.
            await fs.promises.rm(full,{force:true}).catch(()=>{});
            await fs.promises.rm(jpeg,{force:true}).catch(()=>{});
            throw new Error("HTML generated but JPEG failed: "+String(error?.message||error));
        } finally { await renderer.close(); }
    }
    throw new Error("Too many existing versions in the selected folder.");
});
ipcMain.handle("combine:html:open-folder", async (_event,folder) => {
    if(!iframeBatch.lastBatch || folder!==iframeBatch.lastBatch.outputFolder)
        throw new Error("Generate an HTML batch before opening its output.");
    const error=await shell.openPath(folder);
    if(error)throw new Error(error);
    return {ok:true};
});
function sendProgressHtml(event,p){
    try {const frame=event.senderFrame;
        if(frame && !(typeof frame.isDestroyed==="function"&&frame.isDestroyed()))
            frame.send("combine:html:progress",p);
    }catch(_){/* final result is authoritative */}
}
module.exports = { service, rakutenImporter, textCleanup, iframeBatch };
