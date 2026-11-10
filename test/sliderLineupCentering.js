"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const engine = fs.readFileSync(path.join(__dirname, "../src/modules/slider/jsx/sliderEngine.jsx"), "utf8");

const a = engine.indexOf("function lineupVisibleCenterShift(");
const b = engine.indexOf("function buildHorizontalLineupGroup(");
assert(a > 0 && b > a, "Missing JSX center functions");
const helpers = engine.slice(a, b);
const ctx = {
    CANVAS_SIZE: 600,
    isFinite,
    Math,
    getSliderPlacementBounds: layer => layer.bounds,
    layerBoundsPx: group => group.bounds,
    UnitValue: function(value, units) { this.value = value; this.units = units; }
};
vm.createContext(ctx);
vm.runInContext(helpers, ctx);
function groupFrom(bounds, textBounds) {
    const layers = bounds.map(b => ({ bounds: { ...b } }));
    const captions = [{ x: textBounds?.left ?? 20, y: 500 }, { x: textBounds?.right ?? 320, y: 500 }];
    const shadows = [{ x: 80, y: 120 }, { x: 480, y: 120 }];
    return {
        bounds: textBounds || { left: 0, right: 600 }, layers, captions, shadows, shiftedX: 0, shiftedY: 0,
        translate(x, y) {
            assert.equal(x.units, "px");
            assert.equal(y.units, "px");
            this.shiftedX += x.value;
            this.shiftedY += y.value;
            for (const layer of layers) {
                layer.bounds.left += x.value; layer.bounds.right += x.value;
                layer.bounds.top += y.value; layer.bounds.bottom += y.value;
            }
            for (const cap of captions) { cap.x += x.value; cap.y += y.value; }
            for (const shadow of shadows) { shadow.x += x.value; shadow.y += y.value; }
        }
    };
}
function checkCentered(group) {
    const left = Math.min(...group.layers.map(p => p.bounds.left));
    const right = Math.max(...group.layers.map(p => p.bounds.right));
    assert(Math.abs(left - (600 - right)) < 0.001, `not centered: left=${left} right=${right}`);
}
for (const bounds of [
    [{ left: 17, right: 265, top: 20, bottom: 320 }, { left: 338, right: 574, top: 22, bottom: 318 }],
    [{ left: 25, right: 410, top: 20, bottom: 300 }, { left: 40, right: 595, top: 18, bottom: 305 }],
    [{ left: 100, right: 245, top: 30, bottom: 440 }, { left: 315, right: 545, top: 32, bottom: 435 }]
]) {
    const g = groupFrom(bounds, { left: 0, right: 600 });
    const dx = ctx.lineupVisibleCenterShift(bounds, 600);
    const oldGap = g.layers.length > 1 ? g.layers[1].bounds.left - g.layers[0].bounds.right : 0;
    ctx.centerLineupVisibleProducts(g, g.layers, null);
    assert(Math.abs(g.shiftedX - dx) < 0.001);
    assert(Math.abs(g.shiftedY) < 0.001, "multi-item lineup should not vertical-shift");
    checkCentered(g);
    if (g.layers.length > 1) assert.equal(g.layers[1].bounds.left - g.layers[0].bounds.right, oldGap);
    assert.equal(g.captions[0].x, (0 + dx), "Labels must move with photo group");
    assert.equal(g.shadows[0].x, 80 + dx, "Shadows must move with photos");
}
const empty = groupFrom([]);
ctx.centerLineupVisibleProducts(empty, [], null);
assert.equal(empty.shiftedX, 0);
assert.equal(empty.shiftedY, 0);
// Source PSDs may retain opaque canvas bounds spanning 0..600; centering
// must follow visible product bounds instead of being blocked by that canvas.
const padded = groupFrom([{ left: 17, right: 230, top: 22, bottom: 500 }], { left: 0, right: 600 });
ctx.centerLineupVisibleProducts(padded, padded.layers, null);
checkCentered(padded);
// Single-slot lineups should stay in their original slot and only be centered
// inside that slot, not dragged into the middle of the whole 600px canvas.
const single = groupFrom([{ left: 40, right: 210, top: 60, bottom: 420 }], { left: 0, right: 600 });
const targetBox = { x: 17, y: 20, width: 266, height: 480 };
const expectedDx = (targetBox.x + (targetBox.width / 2)) - ((40 + 210) / 2);
const expectedDy = (targetBox.y + (targetBox.height / 2)) - ((60 + 420) / 2);
ctx.centerLineupVisibleProducts(single, single.layers, targetBox);
assert(Math.abs(single.shiftedX - expectedDx) < 0.001, `single dx=${single.shiftedX} expected ${expectedDx}`);
assert(Math.abs(single.shiftedY - expectedDy) < 0.001, `single dy=${single.shiftedY} expected ${expectedDy}`);
const singleBounds = single.layers[0].bounds;
assert(Math.abs(((singleBounds.left + singleBounds.right) / 2) - (targetBox.x + targetBox.width / 2)) < 0.001, "single item not centered inside slot horizontally");
assert(Math.abs(((singleBounds.top + singleBounds.bottom) / 2) - (targetBox.y + targetBox.height / 2)) < 0.001, "single item not centered inside slot vertically");
assert(singleBounds.right < 400, "single item should remain in its original slot, not full-canvas centered");
assert.equal(single.captions[0].x, 0 + expectedDx, "Single-slot labels must move with product");
assert.equal(single.captions[0].y, 500 + expectedDy, "Single-slot labels must keep vertical gap");
// All four generated layout groups must call the same centering helper.
for (const name of ["buildHorizontalLineupGroup", "buildVerticalLineupGroup", "buildPaVerticalLineupGroup", "buildFourCutGroup"]) {
    const start = engine.indexOf(`function ${name}(`);
    const next = engine.indexOf("\nfunction ", start + 10);
    const body = engine.slice(start, next < 0 ? undefined : next);
    assert(body.includes("centerLineupVisibleProducts(group,"), `${name} lacks final centering`);
}
// Unchanged frame: the center math must not resize or crop images or alter shadows.
assert(!helpers.includes(".resize("));
assert(!helpers.includes(".crop("));
console.log("Slider Line Up centering: multi-item group center + single-slot optical balance PASS");
