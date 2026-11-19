"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname,"../src");
const html = fs.readFileSync(path.join(root,"modules/slider/renderer/index.html"),"utf8");
const ui = fs.readFileSync(path.join(root,"modules/slider/renderer/combineNewBrandUi.js"),"utf8");
const preload = fs.readFileSync(path.join(root,"main/preload.js"),"utf8");
const register = fs.readFileSync(path.join(root,"modules/slider/main/register.js"),"utf8");
assert.match(html,/id="sliderCombineOpen"/);
assert.match(html,/src="combineNewBrandUi.js"/);
for (const match of ui.matchAll(/\bel\("([A-Za-z0-9_-]+)"\)/g)) {
    assert.ok(html.includes(`id="${match[1]}"`),`Missing Slider UI element: ${match[1]}`);
}
for (const action of ["slider:combine:get-settings","slider:combine:choose-single","slider:combine:choose-output",
    "slider:combine:suggest","slider:combine:generate","slider:combine:progress","slider:combine:open-output"]) {
    assert.ok(preload.includes(action),`Missing bridge exposure: ${action}`);
    assert.ok(register.includes(action),`Missing IPC registration: ${action}`);
}
for (const marker of ["sliderCombineReviewed","sliderCombinePsd","sliderCombinePublicUrl","sliderCombineOutputPath"]) {
    assert.ok(html.includes(marker));
}
assert.match(ui, /api\.suggestNewBrandCombine\(buildJob\(\)\)/);
assert.match(ui, /moveReviewedItem\(combine\.items/);
console.log("PASS: Slider New Brand Combine UI panel, review controls, folder selector, IPC channels");
