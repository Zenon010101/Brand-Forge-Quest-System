"use strict";
const path = require("path");
const { app, ipcMain } = require("electron");
const profileService = require("../../profile/main/service");
const store = require("./scoreStore");
let operationQueue = Promise.resolve();
function enqueue(task) {
    const next = operationQueue.then(task, task);
    operationQueue = next.then(() => undefined, () => undefined);
    return next;
}
async function currentUser() {
    const session = await profileService.getSession();
    if (!session?.authenticated || !session.profile?.id) throw new Error("Sign in to save Arcade scores.");
    return session.profile;
}
const scorePath = () => path.join(app.getPath("userData"), "arcade-scores.json");
ipcMain.handle("arcade:get-state", async () => {
    const profile = await currentUser();
    return { ...store.getState(scorePath(), profile.id), profileId: profile.id, displayName: profile.displayName || profile.username };
});
ipcMain.handle("arcade:save-score", (_event, game, score) => enqueue(async () => {
    const profile = await currentUser();
    return store.saveScore(scorePath(), profile.id, game, score);
}));
ipcMain.handle("arcade:set-sound", (_event, enabled) => enqueue(async () => {
    const profile = await currentUser();
    return store.saveSound(scorePath(), profile.id, enabled);
}));
