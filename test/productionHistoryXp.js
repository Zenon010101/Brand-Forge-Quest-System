"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { makeProductionEvent, recordCompletedProduction } = require("../src/modules/profile/main/productionEvents");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brandforge-history-exp-"));
const load = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === "electron") return { app: { getPath: () => tmp } };
    return load.call(this, request, parent, isMain);
};
const profile = require("../src/modules/profile/main/service");
Module._load = load;

(async () => {
    try {
        const created = await profile.createAccount({ username: "history-tester", password: "test-password" });
        assert.equal(created.xp, 0);
        const recorder = profile.recordProductionEvent;
        const lp = await recordCompletedProduction("landing-page", {
            ok: true, psdPath: "D:/Products/SHOES-LP.psd", counts: { rasterParts: 2 }
        }, { hasSingle: true }, recorder);
        assert.equal(lp.progression.xpEarned, 26);
        assert.equal(lp.progression.historyItem.kind, "landing-page");
        assert.equal(lp.progression.historyItem.itemCount, 3);
        assert.equal(lp.progression.historyItem.outputFiles, 1);

        const folderLp = await recordCompletedProduction("lp-folder", {
            ok: true, outputPath: "D:/LP/SHOESlp.psd", layerCount: 4,
            jpegPaths: ["SHOESlp_01.jpg", "SHOESlp_02.jpg"]
        }, {}, recorder);
        assert.equal(folderLp.progression.xpEarned, 28);
        assert.equal(folderLp.progression.historyItem.outputFiles, 3);

        const combine = await recordCompletedProduction("combine", {
            ok: true, outputPath: "D:/Combine/SHOEScombine.psd", sourceCount: 5,
            lineupCount: 2, detailCount: 3, jpegPaths: ["SHOEScombine.jpg"]
        }, {}, recorder);
        assert.equal(combine.progression.xpEarned, 30);
        assert.equal(combine.progression.historyItem.kind, "combine");

        const bg = await recordCompletedProduction("remove-bg", {
            ok: true, success: 2, failed: 1,
            results: [{ ok: true, pngPath: "D:/Products/a.png" }, { ok: false }, { ok: true, pngPath: "D:/Products/c.png" }]
        }, {}, recorder);
        assert.equal(bg.progression.xpEarned, 18);
        assert.equal(bg.progression.historyItem.status, "partial");
        assert.equal(bg.progression.historyItem.outputPath, "D:/Products/a.png");

        const shadow = await recordCompletedProduction("shadow", {
            ok: true, success: 2, failed: 0,
            results: [{ ok: true, psdPath: "D:/Products/a.psd" }, { ok: true, psdPath: "D:/Products/c.psd" }]
        }, {}, recorder);
        assert.equal(shadow.progression.xpEarned, 20);
        assert.equal(shadow.progression.historyItem.kind, "shadow");

        let called = 0;
        const never = async () => { called++; throw Error("should not record failed or no-op"); };
        const noOp = { ok: true, success: 0, failed: 0, results: [] };
        assert.equal(await recordCompletedProduction("remove-bg", noOp, {}, never), noOp);
        assert.equal(await recordCompletedProduction("shadow", noOp, {}, never), noOp);
        const failed = { ok: false, outputPath: "D:/unused.psd" };
        assert.equal(await recordCompletedProduction("combine", failed, {}, never), failed);
        const noOutput = { ok: true, sourceCount: 3 };
        assert.equal(await recordCompletedProduction("combine", noOutput, {}, never), noOutput);
        assert.equal(called, 0);
        assert.equal(makeProductionEvent("landing-page", { ok: false }, { hasSingle: true }), null);

        const dashboard = await profile.getDashboard();
        assert.equal(dashboard.recentHistory.length, 5);
        assert.deepEqual(dashboard.recentHistory.map(x => x.kind),
            ["shadow", "remove-bg", "combine", "lp-folder", "landing-page"]);
        assert.equal(dashboard.profile.xp, 122);
        assert.equal(dashboard.profile.stats.totalJobs, 5);
        assert.equal(dashboard.profile.stats.landingPageJobs, 1);
        assert.equal(dashboard.profile.stats.lpFolderJobs, 1);
        assert.equal(dashboard.profile.stats.combineJobs, 1);
        assert.equal(dashboard.profile.stats.removeBgJobs, 1);
        assert.equal(dashboard.profile.stats.shadowJobs, 1);
        assert.equal(dashboard.profile.stats.outputFiles, 1 + 3 + 2 + 2 + 2);
        assert.equal(dashboard.profile.stats.successStreak, 1, "Partial background batch should reset streak");
        assert.equal(dashboard.profile.stats.bestStreak, 3);
        assert.equal(dashboard.weekly.days.length, 5);

        const saved = await recordCompletedProduction("combine", {
            ok: true, outputPath: "D:/Combine/SECOND.psd", sourceCount: 1, jpegPaths: []
        }, {}, async () => { throw new Error("Simulated profile storage failure"); });
        assert.equal(saved.ok, true, "Export remains successful if the XP store fails");
        assert.equal(saved.progression, null);
        assert.match(saved.progressionWarning, /History\/EXP could not be updated/);
        assert.equal((await profile.getDashboard()).recentHistory.length, 5, "Failed history write did not grant EXP");

        // A second profile must not see another operator's EXP or history.
        const secondAccount = await profile.createAccount({ username: "second-operator", password: "another-password" });
        assert.equal(secondAccount.xp, 0);
        assert.equal((await profile.getDashboard()).recentHistory.length, 0);
        await profile.login({ username: "history-tester", password: "test-password" });
        assert.equal((await profile.getDashboard()).recentHistory.length, 5);

        const dashboardHtml = fs.readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
        for (const id of ["lifetimeLandingPage", "lifetimeLpFolder", "lifetimeCombine", "lifetimeRemoveBg", "lifetimeShadow"]) {
            assert(dashboardHtml.includes(`id="${id}"`), `Missing lifetime counter ${id}`);
        }
        for (const [moduleName,kind] of [
            ["landing-page", "landing-page"],
            ["lp-folder", "lp-folder"],
            ["combine", "combine"],
            ["remove-bg", "remove-bg"]
        ]) {
            const source = fs.readFileSync(path.join(__dirname, `../src/modules/${moduleName}/main/register.js`), "utf8");
            assert(source.includes(`recordCompletedProduction("${kind}"`), `Missing ${moduleName} event wiring`);
        }
        const removeRegister = fs.readFileSync(path.join(__dirname, "../src/modules/remove-bg/main/register.js"), "utf8");
        assert(removeRegister.includes('recordCompletedProduction("shadow"'), "Missing shadow EXP wiring");
        const mainView = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8");
        for (const kind of ["landing-page", "lp-folder", "combine", "remove-bg", "shadow"]) {
            assert(mainView.includes(`kind === "${kind}"`), `Missing history badge for ${kind}`);
        }
        console.log("Production History and EXP: 5 real recorded jobs, counters, profile persistence, failures, and UI wiring PASS");
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
