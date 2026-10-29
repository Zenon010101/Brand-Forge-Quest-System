"use strict";
const fs = require("fs");
const path = require("path");
const { app, dialog, BrowserWindow, ipcMain } = require("electron");
const { discoverProject, resolveSelections, verifyLinkedProject, pathKey } = require("./projectPaths");

function filePath() { return path.join(app.getPath("userData"), "brand-project-links.json"); }
function readStore() {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath(), "utf8"));
        return { lastRoot: parsed.lastRoot || "", projects: Array.isArray(parsed.projects) ? parsed.projects : [] };
    } catch (error) { return { lastRoot: "", projects: [] }; }
}
function writeStore(store) {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    const temp = `${filePath()}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(temp, JSON.stringify(store, null, 2), { encoding: "utf8", flag: "w" });
        fs.renameSync(temp, filePath());
    } finally { try { fs.rmSync(temp, { force: true }); } catch (error) {} }
}
function getStoredLink(root) {
    const saved = readStore().projects.find(item => pathKey(item.root) === pathKey(root));
    if (!saved) throw new Error("Project isn't linked yet. Scan the project and select Use Detected Paths first.");
    return verifyLinkedProject(saved);
}
function safeLastProject() {
    const state = readStore();
    if (!state.lastRoot) return { lastRoot: "", project: null };
    try { return { lastRoot: state.lastRoot, project: getStoredLink(state.lastRoot) }; }
    catch (error) { return { lastRoot: state.lastRoot, project: null, warning: error.message }; }
}
function chooseOwner(event) {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window && !window.isDestroyed() ? window : null;
}
function registerIpc() {
    ipcMain.handle("brand-project:last", async () => safeLastProject());
    ipcMain.handle("brand-project:choose-root", async event => {
        const options = {
            title: "Choose a Google Drive brand/project folder (not D: raw images)",
            defaultPath: (() => { const p = readStore().lastRoot; return p && fs.existsSync(p) ? p : undefined; })(),
            properties: ["openDirectory"]
        };
        const owner = chooseOwner(event);
        const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
        return result.canceled || !result.filePaths.length ? null : { root: result.filePaths[0] };
    });
    ipcMain.handle("brand-project:scan", async (_event, data) => {
        try { return { ok: true, project: discoverProject(data?.root) }; }
        catch (error) { return { ok: false, error: error.message || String(error) }; }
    });
    ipcMain.handle("brand-project:link", async (_event, data) => {
        try {
            const project = resolveSelections(data?.root, data?.selectedMarkers);
            const store = readStore();
            store.projects = store.projects.filter(entry => pathKey(entry.root) !== pathKey(project.root));
            store.projects.unshift({ ...project, linkedAt: new Date().toISOString() });
            store.projects = store.projects.slice(0, 30);
            store.lastRoot = project.root;
            writeStore(store);
            return { ok: true, project };
        } catch (error) { return { ok: false, error: error.message || String(error) }; }
    });
}
registerIpc();
module.exports = { getStoredLink, readStore };
