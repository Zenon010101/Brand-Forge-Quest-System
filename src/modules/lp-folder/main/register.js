"use strict";

const { app, dialog, ipcMain, shell } = require("electron");
const { LPFolderService } = require("./service");
const service = new LPFolderService();
let lastFolder = null;

function notify(event, progress) {
    // Embedded iframe needs an event in its own frame, not parent webContents.
    try {
        const frame = event.senderFrame;
        if (frame && !(typeof frame.isDestroyed === "function" && frame.isDestroyed())) {
            frame.send("lp-folder:progress", progress);
        }
    } catch (_) { /* final invoke result remains authoritative */ }
}

ipcMain.handle("lp-folder:choose-folder", async () => {
    const result = await dialog.showOpenDialog({ title: "Select folder containing all LP images",
        defaultPath: lastFolder || app.getPath("pictures"), properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    const scanned = await service.chooseFolder(result.filePaths[0]);
    lastFolder = scanned.folder;
    return scanned;
});
ipcMain.handle("lp-folder:refresh", () => {
    if (!service.snapshot) throw new Error("Choose a source folder first.");
    return service.chooseFolder(service.snapshot.folder);
});
ipcMain.handle("lp-folder:get-state", () => service.getState());
ipcMain.handle("lp-folder:preview", (_event, payload) => service.preview(payload || {}));
ipcMain.handle("lp-folder:layout", (_event, payload) => service.layout(payload || {}));
ipcMain.handle("lp-folder:generate", (event, payload) => service.generate(payload || {}, p => notify(event, p)));
ipcMain.handle("lp-folder:open-output", async () => {
    if (!service.lastOutput) throw new Error("Generate an LP first.");
    const result = await shell.showItemInFolder(service.lastOutput);
    return { ok: true, result: result || null };
});

module.exports = { service };
