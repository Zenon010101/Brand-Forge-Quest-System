"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { buildJobScript } = require("../src/modules/slider/main/jobBuilder");

const root = path.resolve(__dirname, "..");
const enginePath = path.join(root, "src/modules/slider/jsx/sliderEngine.jsx");
const appPath = path.join(root, "src/modules/slider/renderer/app.js");
const htmlPath = path.join(root, "src/modules/slider/renderer/index.html");
const engine = fs.readFileSync(enginePath, "utf8");
const frontend = fs.readFileSync(appPath, "utf8");
const html = fs.readFileSync(htmlPath, "utf8");

// Guard against reintroducing the old limit in either interface, job creation or engine.
for (const [name, source] of [
    ["renderer", frontend],
    ["engine", engine],
    ["job builder", fs.readFileSync(path.join(root, "src/modules/slider/main/jobBuilder.js"), "utf8")]
]) {
    assert(!source.includes("MAX_TOTAL_IMAGES"), `${name} must not impose a fixed image cap`);
    assert(!/Maximum(?: is)? 18 (?:output items|images total)/.test(source), `${name} references old 18-item cap`);
}
assert.match(html, /id="totalCounter">1<\/div>/, "Initial counter must be an actual count, not a quota");

// Exercise the real renderer counter + validation functions with varying output lengths.
function extractFunction(name) {
    const start = frontend.indexOf(`function ${name}()`);
    assert(start >= 0, `Missing ${name}`);
    let depth = 0;
    let opened = false;
    for (let i = frontend.indexOf("{", start); i < frontend.length; i++) {
        if (frontend[i] === "{") { depth++; opened = true; }
        if (frontend[i] === "}") {
            depth--;
            if (opened && depth === 0) return frontend.slice(start, i + 1);
        }
    }
    throw new Error(`Unclosed function: ${name}`);
}
const runUI = new Function(
    "count", "busy",
    `
    const state = { creative: new Array(count).fill({ path: "test.png" }), lineupRows: [], detail: [], busy };
    const productCodeInput = { value: "TEST-001" };
    const totalCounter = { textContent: "", classList: { toggle() {} } };
    const generateBtn = { disabled: null };
    const creativeNavCount = { textContent: "" };
    const lineupNavCount = { textContent: "" };
    const detailNavCount = { textContent: "" };
    function activeSlotCount() { return 2; }
    ${extractFunction("totalOutputs")}
    ${extractFunction("renderCounters")}
    ${extractFunction("validateBeforeGenerate")}
    renderCounters();
    return { total: totalCounter.textContent, disabled: generateBtn.disabled, errors: validateBeforeGenerate() };
    `
);

for (const count of [0, 1, 18, 19, 20, 25, 50]) {
    const result = runUI(count, false);
    assert.equal(result.total, String(count), `Counter for ${count}`);
    assert.equal(result.disabled, count === 0, `Generate button for ${count}`);
    if (count === 0) assert.match(result.errors.join("; "), /Add at least one/);
    else assert.deepEqual(result.errors, [], `Valid job with ${count} output items`);
}
assert.equal(runUI(19, true).disabled, true, "Generate must stay disabled during processing");

// Exercise the full emitted ExtendScript runner: no rejection at 19 or 25.
// Replace only Photoshop's rendering function with a recording stub.
const runJob = (count) => {
    const status = [];
    const job = {
        productCode: "TEST-001",
        creative: Array.from({length: count}, (_, i) => ({path: `C:/temp/source_${i + 1}.png`})),
        detail: [], lineupRows: []
    };
    const script = buildJobScript(enginePath, job);
    const anchor = "/* ============================================================\n   ELECTRON JOB RUNNER";
    const position = script.indexOf(anchor);
    assert(position > 0, "Missing Electron job runner");
    const patched = script.slice(0, position)
        + 'buildUnifiedDocument = function(state) { __captureCount(state.creative.length); return {}; };\n'
        + script.slice(position);
    let received = null;
    const context = {
        File: function(file) { this.fsName = file; this.name = path.basename(file); this.exists = true; },
        app: { preferences: { rulerUnits: "IN", typeUnits: "POINTS", interpolation: "OLD" }, displayDialogs: "YES" },
        DialogModes: { NO: "NO" },
        Units: { PIXELS: "PX" },
        TypeUnits: { PIXELS: "PX" },
        ResampleMethod: { BICUBICSHARPER: "SHARP" },
        __sliderWriteStatus: s => status.push(s),
        __captureCount: n => { received = n; }
    };
    vm.runInNewContext(patched, context, {timeout: 3000});
    assert.equal(status.at(-1), count ? "OK" : "ERROR\nAdd at least one image (Creative, Lineup, or Detail).", `runner status count=${count}`);
    if (count) assert.equal(received, count, `Runner passed ${count} items to PSD builder`);
    else assert.equal(received, null);
};
for (const count of [0, 1, 18, 19, 20, 25, 50]) runJob(count);

console.log("PASS Slider flexible count: Electron UI, validation and Photoshop runner accept 1/18/19/20/25/50; reject only 0");
