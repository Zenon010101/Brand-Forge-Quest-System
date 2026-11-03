"use strict";

const { app, dialog, ipcMain, shell } = require("electron");
const { CombineService } = require("./service");
const service = new CombineService();
const { RakutenImporter } = require("./rakutenImporter");
const rakutenImporter = new RakutenImporter();
const sharp = require("sharp");

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
ipcMain.handle("combine:generate", (event, payload) => service.generate(payload || {}, p => sendProgress(event, p)));
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
ipcMain.handle("combine:rakuten-download", (event, target) =>
    rakutenImporter.download(target || app.getPath("downloads"), update => {
        try { event.senderFrame.send("combine:rakuten-progress", update); }
        catch (_) { /* final response is authoritative */ }
    }));
ipcMain.handle("combine:rakuten-open-folder", async () => {
    const destination = rakutenImporter.downloaded?.folder;
    if (!destination) throw new Error("Download slider images first.");
    const error = await shell.openPath(destination);
    if (error) throw new Error(`Could not open the downloaded folder: ${error}`);
    return { ok:true, folder:destination };
});
ipcMain.handle("combine:rakuten-preview", async (_event, index) => {
    const item = rakutenImporter.downloaded?.images.find(x => x.index === Number(index));
    if (!item?.path) return null;
    const image = await sharp(item.path).resize({width:400,height:400,fit:"inside",withoutEnlargement:true}).png().toBuffer();
    return "data:image/png;base64,"+image.toString("base64");
});
module.exports = { service, rakutenImporter };
