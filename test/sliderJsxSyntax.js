"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const { buildSliderWorkerJsx } = require("../src/modules/slider/main/photoshopBridge");
const { buildJobScript } = require("../src/modules/slider/main/jobBuilder");
const { explainFailure } = require("../src/shared/photoshopCom");

function unTarget(text) {
    return text.replace(/^\uFEFF?\s*#target\s+photoshop\s*\n/i, "");
}

function runWorker(body) {
    let status = null;
    const files = [];
    const context = {
        app: { bringToFront() { this.broughtToFront = true; } },
        File: function (target) {
            this.encoding = "";
            this.open = () => true;
            this.write = text => { status = String(text); };
            this.close = () => { files.push(target); };
        },
        Error, String
    };
    const jsx = buildSliderWorkerJsx(body, "C:\\Users\\Design Team\\商品\\slider status.txt");
    vm.runInNewContext(unTarget(jsx), context, { filename: "slider-worker.jsx", timeout: 3000 });
    return { status, files, script: jsx };
}

const ok = runWorker("var a = 1;");
assert.equal(ok.status, "OK");
assert.equal(ok.files.length, 1);
assert.equal(ok.files[0], "C:\\Users\\Design Team\\商品\\slider status.txt");

const alreadyReported = runWorker('__sliderWriteStatus("OK");');
assert.equal(alreadyReported.status, "OK");
assert.equal(alreadyReported.files.length, 1, "An already completed worker must not be stamped again");

const fails = runWorker('throw new Error("simulated JSX failure");');
assert.equal(fails.status, "ERROR\nsimulated JSX failure");
assert.match(fails.script, /__sliderWriteStatus\("ERROR\\n" \+ __sliderMessage\);/,
    "Error prefix must contain escaped \\n, never a raw newline inside the JSX string literal");

const enginePath = path.join(__dirname, "../src/modules/slider/jsx/sliderEngine.jsx");
for (const job of [
    { productCode: "TEST_CODE", creative: [], detail: [], lineupRows: [], outputPsdPath: "C:\\Slider\\TEST_CODE.psd" },
    { productCode: "商品-01", creative: [{ path: "C:\\日本語\\assets\\1.jpg", name: "白色.jpg" }], detail: [],
      lineupRows: [{ variant1: "赤 / 黒", photo1: { path: "C:\\日本語\\assets\\2.jpg", name: "赤い靴.jpg" } }],
      outputPsdPath: "D:\\出力\\商品-01.psd" }
]) {
    const jobJsx = buildJobScript(enginePath, job);
    const worker = buildSliderWorkerJsx(jobJsx, "C:\\Work\\status.txt");
    assert.match(worker, /function __sliderWriteStatus\(text\)/);
    assert.match(worker, /buildUnifiedDocument\(/, "Must test the complete real Slider engine, not just a fixture");
    // This reproduces the Photoshop 2027 "Error 4: Unterminated string constant"
    // failure without contacting Adobe. The original v1.7.53 wrapper fails here.
    assert.doesNotThrow(() => new vm.Script(unTarget(worker), {filename:"worker.jsx"}),
        "Complete generated Photoshop worker must be syntactically valid JavaScript");
}

const scriptError = explainFailure({code:52,
    stdout: 'BRANDFORGE_COM_ERROR|GetObject=429 | CreateObject=429\nBRANDFORGE_ROT_ERROR|General Photoshop error occurred. Photoshop. - Error 4: Unterminated string constant.',
    stderr: ''}, 'TEST_CODE slider build');
assert.match(scriptError, /ROT fallback reached Photoshop/i);
assert.match(scriptError, /rejected the generated JSX/i);
assert.doesNotMatch(scriptError, /Photoshop COM could not connect/);

const realComError = explainFailure({code:52,
    stdout: 'BRANDFORGE_COM_ERROR|GetObject=429 | CreateObject=429\nBRANDFORGE_ROT_UNAVAILABLE|No compatible Photoshop 28.x object', stderr:''},
    'TEST_CODE slider build');
assert.match(realComError, /Photoshop COM could not connect/);

console.log("PASS Slider Photoshop JSX: complete engine parses, Unicode paths, status success/failure, and accurate ROT error diagnosis");
