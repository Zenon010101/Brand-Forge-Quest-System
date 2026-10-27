"use strict";

const path = require("path");
const { app, ipcMain, dialog } = require("electron");
const { LandingPageService } = require("./service");
const { uniqueSourceOrder, checkImageFile } = require("./planner");

const service = new LandingPageService();
let lastInputFolder = null;
let lastOutputFolder = null;

function notify(event, data) {
    try {
        const frame = event.senderFrame;
        if (frame && !(typeof frame.isDestroyed === "function" && frame.isDestroyed())) frame.send("landing-page:progress", data);
    } catch (_) { /* final invoke response is authoritative */ }
}

ipcMain.handle("landing-page:select-screenshots", async () => {
    const response = await dialog.showOpenDialog({
        title: "Select landing-page screenshots in order", defaultPath: lastInputFolder || app.getPath("pictures"),
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Screenshot images", extensions: ["jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "gif", "avif"] }]
    });
    if (response.canceled) return [];
    if (response.filePaths.length) lastInputFolder = path.dirname(response.filePaths[0]);
    response.filePaths.forEach(checkImageFile);
    return response.filePaths;
});

ipcMain.handle("landing-page:select-single", async () => {
    const response = await dialog.showOpenDialog({
        title: "Select optional Single image", defaultPath: lastInputFolder || app.getPath("pictures"),
        properties: ["openFile"],
        filters: [{ name: "Single images", extensions: ["jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "gif", "avif"] }]
    });
    if (response.canceled || !response.filePaths[0]) return null;
    lastInputFolder = path.dirname(response.filePaths[0]);
    return checkImageFile(response.filePaths[0]);
});

ipcMain.handle("landing-page:select-output", async () => {
    const response = await dialog.showOpenDialog({
        title: "Choose Landing Page output folder", defaultPath: lastOutputFolder || app.getPath("pictures"),
        properties: ["openDirectory", "createDirectory"]
    });
    if (response.canceled || !response.filePaths[0]) return null;
    lastOutputFolder = response.filePaths[0];
    return lastOutputFolder;
});

ipcMain.handle("landing-page:validate-files", (_event, payload) => {
    const screenshots = uniqueSourceOrder(payload?.screenshots || []);
    const single = payload?.singlePath ? checkImageFile(payload.singlePath) : null;
    if (single && screenshots.includes(single)) throw new Error("Single image is also in screenshot queue.");
    return { ok: true, count: screenshots.length };
});

ipcMain.handle("landing-page:analyze", (event, payload) => service.analyze(payload, data => notify(event, data)));
ipcMain.handle("landing-page:get-analysis", () => service.publicSession());
ipcMain.handle("landing-page:preview", async (_event, payload) => service.preview(payload));
ipcMain.handle("landing-page:generate", (event, payload) => service.generate(payload, data => notify(event, data)));
ipcMain.handle("landing-page:discard", () => service.dispose());

app.on("before-quit", () => { void service.dispose(); });

module.exports = { service };
