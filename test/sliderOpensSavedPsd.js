"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { buildJobScript } = require("../src/modules/slider/main/jobBuilder");
const { buildOpenSavedPsdScript } = require("../src/modules/slider/main/openSavedPsd");

const jsxEngine = path.join(__dirname, "../src/modules/slider/jsx/sliderEngine.jsx");
const generated = buildJobScript(jsxEngine, {
    productCode: "TEST-001", creative: [], detail: [], lineupRows: [],
    outputPsdPath: "C:/Temp/stage.psd"
});
assert(generated.includes("__builtDoc.saveAs("));
assert(/__builtDoc\.saveAs\([\s\S]*?__builtDoc\.close\(SaveOptions\.DONOTSAVECHANGES\)/.test(generated),
    "Saved staging document must close before publishing final PSD");
assert(/if \(!__success && __builtDoc\)/.test(generated), "Failed build still closes temporary document");

const register = fs.readFileSync(path.join(__dirname, "../src/modules/slider/main/register.js"), "utf8");
assert(register.includes('Select a Slider PSD output folder or link your Google Drive brand project before generating.'),
    "Slider must require a real save location, not leave an unsaved temporary Photoshop document");
assert(register.indexOf("await publishGroup(") < register.indexOf("buildOpenSavedPsdScript(finalPsdPath)"),
    "Opening PSD must happen after verified file publishing, not before");

const target = path.win32.resolve("C:/Slider Output/PRODUCT PSD.psd");
function simulate({ oldOpen = false, dirty = false, exists = true } = {}) {
    const docs = [];
    let openCount = 0;
    let closeCount = 0;
    const saved = (file) => ({
        fullName: { fsName: file }, saved: true,
        close() { closeCount++; docs.splice(docs.indexOf(this), 1); }
    });
    if (oldOpen) {
        const old = saved(target);
        old.saved = !dirty;
        docs.push(old);
    }
    const logs = [];
    const app = {
        displayDialogs: "YES", documents: docs, activeDocument: null,
        open(file) { openCount++; const item = saved(file.fsName); docs.push(item); return item; },
        bringToFront() { this.focused = true; }
    };
    const context = {
        File: function(p) { this.fsName = p; this.exists = exists; },
        app, DialogModes: { NO: "NO" }, SaveOptions: { DONOTSAVECHANGES: "NO" },
        __sliderWriteStatus: s => logs.push(s), String, Error
    };
    vm.runInNewContext(buildOpenSavedPsdScript(target), context, { timeout: 1000 });
    return { app, docs, logs, openCount, closeCount };
}
const fresh = simulate();
assert.equal(fresh.openCount, 1);
assert.equal(fresh.docs.length, 1);
assert.equal(fresh.app.activeDocument.fullName.fsName, target);
assert.equal(fresh.logs[0], "OK");
assert.equal(fresh.app.displayDialogs, "YES");
assert(fresh.app.focused);

const replace = simulate({ oldOpen: true });
assert.equal(replace.closeCount, 1);
assert.equal(replace.openCount, 1);
assert.equal(replace.docs.length, 1);
assert.equal(replace.logs[0], "OK");

const dirty = simulate({ oldOpen: true, dirty: true });
assert.equal(dirty.openCount, 0);
assert.equal(dirty.closeCount, 0);
assert.equal(dirty.docs.length, 1);
assert.match(dirty.logs[0], /ERROR.*unsaved edits/s);

const missing = simulate({ exists: false });
assert.equal(missing.openCount, 0);
assert.match(missing.logs[0], /ERROR.*missing/s);

console.log("Slider final PSD opening tests PASS: temp close, verified publish, real file opening, stale tab reload, unsaved edit protection");
