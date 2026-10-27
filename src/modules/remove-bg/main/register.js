"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const sharp = require("sharp");
const { app, dialog, ipcMain } = require("electron");
const { RemoveBgProcessor } = require("./processor");
const { pathKey } = require("./files");
const { jsxFromFile, runPhotoshopJSX } = require("./photoshopBridge");
const { sendProgressToRequestFrame } = require("./ipc");

const processor = new RemoveBgProcessor();
let lastFolder = null;

ipcMain.handle("remove-bg:select-images", async () => {
    const selected = await dialog.showOpenDialog({
        title: "Add images to Remove Background + Shadow",
        defaultPath: lastFolder || app.getPath("pictures"),
        properties: ["openFile", "multiSelections"],
        filters: [{
            name: "Photoshop raster images",
            extensions: ["jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "gif", "psd", "psb", "tga", "heic", "heif"]
        }]
    });
    if (selected.canceled || !selected.filePaths.length) return { added: [], rejected: [], skipped: [] };
    lastFolder = path.dirname(selected.filePaths[0]);
    return processor.add(selected.filePaths);
});

ipcMain.handle("remove-bg:add-paths", (_event, paths) => processor.add(paths));
ipcMain.handle("remove-bg:forget", (_event, paths) => processor.removeFromQueue(paths));
ipcMain.handle("remove-bg:get-state", () => processor.getState());

ipcMain.handle("remove-bg:remove-background", async (event, payload) => processor.batch(
    "remove", payload && payload.paths, payload && payload.overwrite,
    data => { sendProgressToRequestFrame(event, data); }
));

ipcMain.handle("remove-bg:add-shadow", async (event, payload) => processor.batch(
    "shadow", payload && payload.paths, payload && payload.overwrite,
    data => { sendProgressToRequestFrame(event, data); }
));

ipcMain.handle("remove-bg:get-preview", async (_event, payload) => {
    const source = typeof payload?.filePath === "string" ? path.resolve(payload.filePath) : "";
    const maxEdge = Math.max(96, Math.min(2800, Number(payload?.maxEdge) || 1600));
    const belongs = Array.from(processor.items.values()).some(item =>
        pathKey(item.path) === pathKey(source) ||
        (item.originalBackupPath && pathKey(item.originalBackupPath) === pathKey(source)) || (item.pngReady && pathKey(item.png) === pathKey(source))
    );
    if (!source || !belongs) return { ok: false, error: "File is not in the current queue." };
    try {
        let result;
        try {
            result = await sharp(source, { limitInputPixels: 268402689 })
                .rotate()
                .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
                .png().toBuffer();
        } catch (sharpError) {
            if (processor.active) throw new Error("Photoshop is busy. Select the preview again after this batch finishes.");
            const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "gws-preview-"));
            try {
                const exported = path.join(tempDir, "source-preview.png");
                await runPhotoshopJSX(jsxFromFile("preview.jsx", {
                    GWS_PREVIEW_SOURCE: source,
                    GWS_PREVIEW_OUTPUT: exported
                }), `Preview: ${path.basename(source)}`, 120000);
                result = await sharp(exported)
                    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
                    .png().toBuffer();
            } finally {
                await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
            }
        }
        return { ok: true, dataUrl: `data:image/png;base64,${result.toString("base64")}` };
    } catch (error) {
        return { ok: false, error: error?.message || String(error) };
    }
});

module.exports = { processor };
