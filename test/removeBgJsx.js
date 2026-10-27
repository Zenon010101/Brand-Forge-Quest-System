"use strict";

// Sandboxed ExtendScript simulation. Exercises the Photoshop selection flow,
// deliberate failure, output isolation, and document cleanup without Windows.
// Real Photoshop accuracy still requires a Windows workstation QC pass.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const jsx = fs.readFileSync(path.join(__dirname, "../src/modules/remove-bg/jsx/removeBackground.jsx"), "utf8");

function simulate(shouldFindSubject) {
    const calls = [];
    let work = null;
    let cleared = false;
    let selected = null;
    function rect(list) { return list.map(n => ({ as: () => n })); }
    const makeDoc = (name) => ({
        name, mode: "RGB", bitsPerChannel: "EIGHT", width: { as: () => 120 }, height: { as: () => 100 },
        layers: [{ name: "Source pixels", visible: true, typename: "ArtLayer", isBackgroundLayer: false }],
        selection: {
            get bounds() { if (!selected) throw new Error("No selection"); return rect(selected); },
            invert() { calls.push("invert"); },
            clear() { calls.push("clear"); cleared = true; },
            deselect() { selected = null; calls.push("deselect"); }
        },
        artLayers: { add() { const layer = { name: "helper", visible: true, typename: "ArtLayer" }; work.layers.unshift(layer); return layer; } },
        mergeVisibleLayers() { work.layers = [{ name: "Composite", typename: "ArtLayer", visible: true, isBackgroundLayer: false }]; work.activeLayer = work.layers[0]; calls.push("merge"); },
        duplicate() { work = makeDoc("Temporary duplicate"); calls.push("duplicate"); return work; },
        saveAs(file) { calls.push(`save:${file.fsName}`); },
        close(option) { calls.push(`close:${name}`); }
    });
    const source = makeDoc("Original source");
    const app = {
        documents: [], activeDocument: null,
        open() { calls.push("open"); this.documents.push(source); this.activeDocument = source; return source; }
    };
    const context = {
        app, GWS_SOURCE: "C:/test/bag.jpg", GWS_OUTPUT: "C:/test/.temporary-bag.png",
        File: function File(filename) { this.fsName = filename; this.exists = true; },
        DocumentMode: { RGB: "RGB" }, BitsPerChannelType: { EIGHT: "EIGHT" },
        DialogModes: { NO: 0 }, SaveOptions: { DONOTSAVECHANGES: "NO" },
        PNGSaveOptions: function PNGSaveOptions() { this.interlaced = false; },
        Extension: { LOWERCASE: "lowercase" },
        ActionDescriptor: function ActionDescriptor() { this.putReference = () => {}; this.putBoolean = () => {}; },
        ActionReference: function ActionReference() { this.putProperty = () => {}; this.putEnumerated = () => {}; },
        charIDToTypeID: x => x, stringIDToTypeID: x => x,
        executeAction(action) {
            calls.push(`action:${action}`);
            if (action === "setd") selected = cleared ? [15, 12, 106, 95] : [0, 0, 120, 100];
            if (action === "removeBackground") throw new Error("Legacy Quick Action must not be called");
            if (action === "autoCutout") {
                if (!shouldFindSubject) throw new Error("Could not find subject to select");
                selected = [15, 12, 106, 95];
            }
        }
    };
    let failure = null;
    try { vm.runInNewContext(jsx, context, { filename: "removeBackground.jsx" }); }
    catch (error) { failure = error; }
    return { calls, failure, cleared };
}

const success = simulate(true);
assert.equal(success.failure, null, String(success.failure));
assert(success.calls.includes("action:autoCutout"));
assert(!success.calls.includes("action:removeBackground"));
assert(success.calls.includes("invert"));
assert(success.calls.includes("clear"));
assert(success.calls.some(c => c.startsWith("save:C:/test/")));
assert(success.calls.includes("close:Temporary duplicate"));
assert(success.calls.includes("close:Original source"));

const failure = simulate(false);
assert(failure.failure);
assert.match(failure.failure.message, /Preferences.*Cloud/);
assert.equal(failure.cleared, false, "no background deletion on failed selection");
assert(!failure.calls.some(c => c.startsWith("save:")), "no opaque PNG on failed segmentation");
assert(failure.calls.includes("close:Temporary duplicate"));
assert(failure.calls.includes("close:Original source"));
console.log("Photoshop JSX selection and failure handling simulation passed.");
