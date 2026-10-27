"use strict";

// A Photoshop DOM simulation for the actual ExtendScript body. This catches
// regressions in the importing/positioning/grouping logic on non-Windows CI.
// It does not replace a real Windows + Photoshop integration test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const jsx = fs.readFileSync(path.join(__dirname, "../src/modules/landing-page/jsx/buildLandingPage.jsx"), "utf8")
    .replace(/^\s*#target\s+photoshop[^\n]*\n?/, "");

function simulate(options = {}) {
    const sourceDocs = [];
    const outputDocs = [];
    let clipboardCalls = 0;
    let duplicateCalls = 0;
    const placements = [];
    const ElementPlacement = { INSIDE: "inside" };

    function pixel(num) { return { as: unit => { assert.equal(unit, "px"); return Number(num); } }; }
    function detach(layer) {
        if (!layer.parent) return;
        const siblings = layer.parent.children;
        const index = siblings.indexOf(layer);
        if (index >= 0) siblings.splice(index, 1);
        layer.parent = null;
    }
    function attach(layer, parent) {
        detach(layer);
        assert.ok(parent.children, "Target must be a Photoshop Document or LayerSet");
        layer.parent = parent;
        parent.children.unshift(layer);
    }
    class ArtLayer {
        constructor(parent, filename = null, x = 0, y = 0) {
            this.parent = null;
            this.filename = filename;
            this.x = x; this.y = y;
            this.visible = true;
            this.kind = "normal";
            this.name = "Layer";
            this.textItem = {};
            if (parent) attach(this, parent);
        }
        get bounds() { return [pixel(this.x), pixel(this.y), pixel(this.x + 200), pixel(this.y + 150)]; }
        duplicate(destination, placement) {
            assert.equal(placement, ElementPlacement.INSIDE);
            assert.equal(app.activeDocument, this.parent, "Original layer must be active when duplicating");
            if (options.rejectFile && this.filename === options.rejectFile) {
                throw new Error("simulated Photoshop duplicate failure");
            }
            duplicateCalls++;
            const target = new ArtLayer(destination, this.filename, 50, 60);
            placements.push(target);
            return target;
        }
        move(parent, placement) { assert.equal(placement, ElementPlacement.INSIDE); attach(this, parent); }
        translate(dx, dy) { this.x += dx.value; this.y += dy.value; }
    }
    class LayerSet {
        constructor(parent) {
            this.children = [];
            this.name = "Unnamed";
            this.visible = true;
            this.parent = null;
            attach(this, parent);
        }
        get layerSets() { return { add: () => new LayerSet(this) }; }
    }
    class PhotoshopDocument {
        constructor() {
            this.children = [];
            this.closed = false;
            this.saved = false;
            this.artLayers = { add: () => new ArtLayer(this) };
        }
        get layerSets() { return { add: () => new LayerSet(this) }; }
        saveAs(file, saveOpts) {
            assert.equal(file.path, options.outputPath || "C:/product.psd");
            assert.equal(saveOpts.layers, true);
            assert.ok(this.children.length);
            this.saved = true;
        }
        close() { this.closed = true; }
    }
    const app = {
        documents: {
            add(width, height) {
                assert.equal(width, 1000);
                assert.equal(height, 2150);
                const doc = new PhotoshopDocument();
                outputDocs.push(doc);
                app.activeDocument = doc;
                return doc;
            }
        },
        activeDocument: null,
        open(file) {
            const doc = new PhotoshopDocument();
            doc.filename = file.path;
            doc.activeLayer = new ArtLayer(doc, file.path);
            doc.artLayers = [doc.activeLayer];
            // A regression to Copy Merged would fail this test deliberately.
            doc.selection = {
                selectAll() { clipboardCalls++; throw new Error("selection must not be used"); },
                copy() { clipboardCalls++; throw new Error("clipboard must not be used"); }
            };
            doc.paste = () => { clipboardCalls++; throw new Error("paste must not be used"); };
            sourceDocs.push(doc);
            app.activeDocument = doc;
            return doc;
        }
    };
    const layout = {
        code: "TEST_LP", width: 1000, height: 2150, format: "psd",
        hasSingle: true, singlePath: "C:/single.png", fontLatin: "ArialMT", fontJapanese: "YuGothic-Regular",
        parts: [
            { group: "02_LP_PART_01", y: 1000, normalizedPath: "C:/ref1.png", basePath: "C:/base1.png",
                images: [{ file: "C:/image1.png", name: "IMG_01", left: 140, top: 90 }],
                text: [{ name: "TITLE", text: "Test Text", x: 100, y: 20, height: 40, fontSize: 30, editable: true, color: "#222222" }] },
            { group: "03_LP_PART_02", y: 1700, normalizedPath: "C:/ref2.png", basePath: "C:/base2.png",
                images: [], text: [] }
        ]
    };
    function UnitValue(value, unit) { assert.equal(unit, "px"); return { value: Number(value) }; }
    class File { constructor(filePath) { this.path = filePath; } }
    class PhotoshopSaveOptions {}
    class SolidColor { constructor() { this.rgb = {}; } }
    const globals = {
        app, File, UnitValue, ElementPlacement, PhotoshopSaveOptions, SolidColor,
        LargeDocumentFormatSaveOptions: PhotoshopSaveOptions, LP_DATA: layout,
        LP_OUTPUT: options.outputPath || "C:/product.psd",
        SaveOptions: { DONOTSAVECHANGES: "discard" },
        NewDocumentMode: { RGB: "rgb" }, DocumentFill: { TRANSPARENT: "transparent" },
        LayerKind: { TEXT: "text" }, TextType: { POINTTEXT: "point" },
        Justification: { LEFT: "left" }, Extension: { LOWERCASE: "lowercase" }
    };
    let error = null;
    try { vm.runInNewContext(jsx, globals, { filename: "buildLandingPage.jsx", timeout: 10000 }); }
    catch (cause) { error = cause; }
    return { outputDocs, sourceDocs, clipboardCalls, duplicateCalls, placements, error };
}

const successful = simulate();
assert.equal(successful.error, null, String(successful.error));
assert.equal(successful.clipboardCalls, 0);
assert.equal(successful.duplicateCalls, 6, "Two references, two fallback backgrounds, one image block and one Single");
assert.ok(successful.sourceDocs.every(doc => doc.closed), "All temporary input PNG documents must be closed");
assert.ok(successful.outputDocs[0].closed);
assert.ok(successful.outputDocs[0].saved);
const outputDoc = successful.outputDocs[0];
assert.deepEqual(outputDoc.children.map(group => group.name), ["01_SINGLE", "02_LP_PART_01", "03_LP_PART_02"]);
const single = outputDoc.children[0].children.find(x => x.name === "Single");
assert.ok(single);
assert.equal(single.y, 0);
const part1 = outputDoc.children[1];
const allChildren = part1.children.flatMap(group => group.children);
assert.ok(allChildren.some(child => child.name === "BG_RASTER_FALLBACK" && child.y === 1000));
assert.ok(allChildren.some(child => child.name === "IMG_01" && child.x === 140 && child.y === 1090));
assert.ok(allChildren.some(child => child.name === "TITLE" && child.kind === "text" && child.visible));
assert.ok(allChildren.some(child => child.name === "ORIGINAL_REFERENCE (hidden)" && !child.visible));
const part2 = outputDoc.children[2];
assert.ok(part2.children.flatMap(group => group.children).some(child => child.name === "BG_RASTER_FALLBACK" && child.y === 1700));

const failed = simulate({ rejectFile: "C:/base1.png" });
assert.ok(failed.error);
assert.match(String(failed.error), /Cannot import BG_RASTER_FALLBACK from C:\/base1\.png: simulated Photoshop duplicate failure/);
assert.ok(failed.sourceDocs.every(doc => doc.closed), "Failed PSD import must clean up all opened input PNGs");
assert.ok(failed.outputDocs.every(doc => doc.closed && !doc.saved), "Failed PSD import must discard incomplete output");
console.log("Landing Page JSX tests passed: clipboard-free PNG duplication, group ordering, exact placement, editable text, reference visibility, and failure cleanup.");
