"use strict";

const { ipcMain } = require("electron");
const service = require("./service");

ipcMain.handle("profile:get-session", () => service.getSession());
ipcMain.handle("profile:create-account", async (_event, payload) => {
    try {
        const profile = await service.createAccount(payload || {});
        return { ok: true, profile };
    } catch (error) {
        return { ok: false, error: error?.message || String(error) };
    }
});
ipcMain.handle("profile:login", async (_event, payload) => {
    try {
        const profile = await service.login(payload || {});
        return { ok: true, profile };
    } catch (error) {
        return { ok: false, error: error?.message || String(error) };
    }
});
ipcMain.handle("profile:logout", async () => service.logout());
ipcMain.handle("profile:get-dashboard", () => service.getDashboard());
