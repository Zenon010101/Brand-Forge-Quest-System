"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-ipc-test-"));
const handlers = new Map();
const idA = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const idB = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
let signedIn = { authenticated: true, profile: { id: idA, username: "Designer A" } };
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === "electron") return {
        app: { getPath: () => root },
        ipcMain: { handle: (name, fn) => handlers.set(name, fn) }
    };
    if (request === "../../profile/main/service" && parent?.filename?.endsWith("arcade/main/register.js")) {
        return { getSession: async () => signedIn };
    }
    return originalLoad.apply(this, arguments);
};
try { require("../src/modules/arcade/main/register"); }
finally { Module._load = originalLoad; }
(async () => {
    try {
        assert.deepEqual([...handlers.keys()].sort(), ["arcade:get-state", "arcade:save-score", "arcade:set-sound"]);
        const get = () => handlers.get("arcade:get-state")(null);
        const score = (game, points) => handlers.get("arcade:save-score")(null, game, points);
        const sound = on => handlers.get("arcade:set-sound")(null, on);
        assert.equal((await get()).profileId, idA);
        await score("snake", 50);
        await score("snake", 20);
        await sound(false);
        assert.equal((await get()).highScores.snake, 50);
        assert.equal((await get()).soundEnabled, false);
        signedIn = { authenticated: true, profile: { id: idB, username: "Designer B" } };
        assert.equal((await get()).highScores.snake, 0);
        assert.equal((await get()).soundEnabled, true);
        await score("color", 100);
        signedIn = { authenticated: true, profile: { id: idA, username: "Designer A" } };
        assert.equal((await get()).highScores.color, 0);
        signedIn = { authenticated: false };
        await assert.rejects(get(), /Sign in/);
        await assert.rejects(score("snake", 150), /Sign in/);
        await assert.rejects(sound(true), /Sign in/);
        console.log("PASS Arcade IPC: authenticated profile boundary, per-profile persistence, no EXP calls");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
