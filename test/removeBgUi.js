"use strict";

// Electron module iframe regression test, running the actual renderer app.js
// with a minimal DOM and NO incoming progress events. Before v1.5.2, the
// parent webContents got the progress event and the iframe permanently showed
// 0 PNG ready / disabled Add Shadow, despite successful Photoshop exports.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const renderer = fs.readFileSync(path.join(__dirname, "../src/modules/remove-bg/renderer/app.js"), "utf8");

class Element {
    constructor(id = "") {
        this.id = id;
        this.disabled = false;
        this.hidden = false;
        this.checked = false;
        this.textContent = "";
        this.style = {};
        this.dataset = {};
        this.attrs = {};
        this.listeners = new Map();
        this.classList = {
            add() {}, remove() {}, toggle() {}, contains() { return false; }
        };
    }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    fire(type, event = {}) { return this.listeners.get(type)?.(event); }
    append() {}
    appendChild() {}
    replaceChildren() {}
    setAttribute(name, value) { this.attrs[name] = value; }
    removeAttribute(name) { delete this.attrs[name]; }
    querySelector(selector) { return new Element(selector); }
    remove() {}
}

function createUi(api) {
    const nodes = new Map();
    const document = {
        getElementById(id) {
            if (!nodes.has(id)) nodes.set(id, new Element(id));
            return nodes.get(id);
        },
        createDocumentFragment: () => new Element(),
        createElement: id => new Element(id),
        addEventListener() {}
    };
    const sandbox = {
        window: { removeBgApp: api }, document,
        Map, Set, Date, Promise, Math,
        setInterval: () => 1, clearInterval() {}
    };
    vm.runInNewContext(renderer, sandbox, { filename: "remove-bg-renderer-app.js" });
    return id => document.getElementById(id);
}

const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
};

const src = ["bag01.jpg", "bag02.jpg", "bag03.jpg"].map(name => `C:\\Products\\${name}`);
const added = src.map((p, i) => ({
    path: p, name: `bag0${i + 1}.jpg`, extension: ".jpg", size: 1000,
    originalPreviewPath: p, originalUrl: `file:///C:/Products/bag0${i + 1}.jpg`,
    status: "Original", message: "Ready for background removal.",
    pngPath: null, psdPath: null, pngUrl: null
}));
const pngVersion = item => ({
    ...item, status: "PNG Ready", message: "Transparent PNG ready for QC.",
    pngPath: item.path.replace(/\.jpg$/, ".png"),
    pngUrl: item.originalUrl.replace(/\.jpg$/, ".png")
});
const psdVersion = item => ({
    ...item, status: "Shadow Ready", message: "PSD saved.",
    psdPath: item.path.replace(/\.jpg$/, ".psd")
});

async function run() {
    // Simulate the actual failure: remove-bg:progress never reaches the
    // iframe. Only the completion reply has accurate data.
    let backend = [];
    let removeCalls = 0;
    let shadowCalls = 0;
    let lastShadowPaths = [];
    const api = {
        onProgress() { return () => {}; }, // intentionally NEVER call callback
        getState: async () => ({ ok: true, active: false, items: backend }),
        selectImages: async () => {
            backend = added.map(x => ({ ...x }));
            return { added: added.map(x => ({ ...x })), rejected: [], skipped: [] };
        },
        removeBackground: async ({ paths }) => {
            removeCalls++;
            assert.deepEqual(Array.from(paths), src);
            backend = backend.map(pngVersion);
            return { ok: true, success: 3, failed: 0, results: backend.map(x => ({ ...x, ok: true })) };
        },
        addShadow: async ({ paths }) => {
            shadowCalls++;
            lastShadowPaths = Array.from(paths);
            backend = backend.map(psdVersion);
            return { ok: true, success: 3, failed: 0, results: backend.map(x => ({ ...x, ok: true })) };
        },
        getPreview: async () => ({ ok: false, error: "not needed by status test" })
    };
    const el = createUi(api);
    await flush();
    await el("addImages").fire("click");
    await flush();
    assert.equal(el("removeBackground").disabled, false);
    assert.equal(el("addShadow").disabled, true);
    el("removeBackground").fire("click");
    await flush();
    assert.equal(removeCalls, 1);
    assert.equal(el("statusCounts").textContent, "3 PNG ready · 0 PSD ready");
    assert.equal(el("addShadow").disabled, false, "Add Shadow must enable without live progress events");
    assert.equal(el("pngTab").disabled, false, "PNG preview must be available without live progress");

    // iframe reload while the Electron main process retains its in-memory
    // queue must not lose the approved PNGs.
    const reloaded = createUi(api);
    await flush();
    assert.equal(reloaded("statusCounts").textContent, "3 PNG ready · 0 PSD ready");
    assert.equal(reloaded("addShadow").disabled, false);

    el("addShadow").fire("click");
    await flush();
    assert.equal(shadowCalls, 1);
    assert.deepEqual(lastShadowPaths, src);
    assert.equal(removeCalls, 1, "Add Shadow must not remove backgrounds a second time");
    assert.equal(el("statusCounts").textContent, "3 PNG ready · 3 PSD ready");
    assert.equal(el("addShadow").disabled, true, "Finished PSDs must not be run twice");

    // If even the extra state refresh fails, final invoke results must still
    // update the queue and unlock the button.
    let failingState = [];
    const offlineApi = {
        ...api,
        getState: async () => { throw new Error("Simulated queue refresh error"); },
        selectImages: async () => ({ added: added.map(x => ({ ...x })), rejected: [], skipped: [] }),
        removeBackground: async () => {
            failingState = added.map(pngVersion);
            return { ok: true, success: 3, failed: 0, results: failingState.map(x => ({ ...x, ok: true })) };
        }
    };
    const offline = createUi(offlineApi);
    await flush();
    await offline("addImages").fire("click");
    offline("removeBackground").fire("click");
    await flush();
    assert.equal(offline("addShadow").disabled, false, "Final batch results survive snapshot failures");
    assert.equal(offline("statusCounts").textContent, "3 PNG ready · 0 PSD ready");
    console.log("Remove BG iframe lost-progress and Add Shadow button regression tests passed.");
}

run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
