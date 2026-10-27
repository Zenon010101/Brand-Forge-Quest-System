const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { configureSessionCache } = require("./sessionCache");

// Only one BrandForge instance may use its Chromium session cache at a time.
// A second launch raises the existing window instead of starting another
// Chromium process which could lock GPUCache on Windows.
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
    app.quit();
} else {
    // Set the sessionData path BEFORE app.ready. Do not change userData:
    // local profiles, EXP, history, and remembered folders live there.
    configureSessionCache(app);

    // Register every production module before any renderer is loaded.
    require("../modules/profile/main/register");
    require("../modules/slider/main/register");
    require("../modules/amazon/main/register");
    require("../modules/remove-bg/main/register");
    require("../modules/landing-page/main/register");
    require("../modules/lp-folder/main/register");
    require("../modules/settings/main/register");

    function createMainWindow() {
        const win = new BrowserWindow({
            width: 1560,
            height: 960,
            minWidth: 1080,
            minHeight: 700,
            backgroundColor: "#141414",
            title: "Image Workflow Studio",
            show: false,
            webPreferences: {
                preload: path.join(__dirname, "preload.js"),
                contextIsolation: true,
                nodeIntegration: false,
                nodeIntegrationInSubFrames: true,
                sandbox: true,
                webSecurity: true
            }
        });

        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        win.webContents.on("will-navigate", (event, url) => {
            if (!url.startsWith("file://")) event.preventDefault();
        });

        win.once("ready-to-show", () => win.show());
        win.loadFile(path.join(__dirname, "../renderer/index.html"));
    }

    // Focus the already-open window when the app is launched a second time.
    app.on("second-instance", () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win || win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
    });

    ipcMain.handle("app:get-info", () => ({
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform
    }));

    app.whenReady().then(() => {
        createMainWindow();

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
        });
    });

    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") app.quit();
    });
}
