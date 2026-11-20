"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
    buildJsxLaunchVbs, parseSuccessfulConnection, connectionAdvice
} = require("../src/shared/photoshopCom");
const { jsxWithBom, writeJsxFile } = require("../src/shared/photoshopFiles");
const { withPhotoshopTask, queueState } = require("../src/shared/photoshopTaskQueue");

(async () => {
    // A status receipt prevents automatic replay of a partially completed JSX.
    const vbs = buildJsxLaunchVbs('C:\\Temp\\商品\\worker.jsx', {
        variableName: "photoshopApp", receiptPath: 'C:\\Temp\\商品\\receipt.txt', reveal: true
    });
    assert(vbs.includes('photoshopApp.DoJavaScriptFile "C:\\Temp\\商品\\worker.jsx"'));
    assert(vbs.includes('photoshopApp.DoJavaScript "$.evalFile(new File('));
    assert(vbs.includes('C:/Temp/商品/worker.jsx'), 'ExtendScript uses normalized file paths');
    assert(vbs.includes('FileExists("C:\\Temp\\商品\\receipt.txt")'));
    assert(vbs.indexOf('If Not BFReceiptExists Then') < vbs.indexOf('photoshopApp.DoJavaScript '));
    assert(vbs.includes('BRANDFORGE_JSX_ERROR|DoJavaScriptFile='));
    assert(vbs.includes('BRANDFORGE_CONNECTED|'));
    // Without a receipt no retries are allowed (avoid duplicate writes).
    assert(buildJsxLaunchVbs('C:\\file.jsx').includes('No receipt path: never risk duplicate invocation'));
    const success = parseSuccessfulConnection('BRANDFORGE_CONNECTED|28.0.1|running|DoJavaScript-evalFile');
    assert.deepEqual(success, { version: "28.0.1", method: "running", invocationMethod: "DoJavaScript-evalFile" });
    assert.match(connectionAdvice('BRANDFORGE_COM_ERROR|0x80080005'), /COM server/);
    assert.match(connectionAdvice('BRANDFORGE_COM_ERROR|0x80080005'), /2027/);

    const file = path.join(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bf-bom-test-')), 'work.jsx');
    try {
        assert(jsxWithBom('test').startsWith('\uFEFF'));
        await writeJsxFile(file, '#target photoshop\nvar label = "ブルー x ブラック";');
        const bytes = await fs.promises.readFile(file);
        assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
        assert(bytes.toString('utf8').includes('ブルー x ブラック'));
        await writeJsxFile(file, '\uFEFFhi');
        assert(! (await fs.promises.readFile(file, 'utf8')).startsWith('\uFEFF\uFEFF'));
    } finally { await fs.promises.rm(path.dirname(file), { recursive: true, force: true }); }

    const events = [];
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const a = withPhotoshopTask('Remove BG', async () => {
        events.push('A+'); await sleep(14); events.push('A-'); throw new Error('Test job failed');
    }).catch(() => events.push('A!'));
    const b = withPhotoshopTask('Slider', async () => { events.push('B+'); await sleep(4); events.push('B-'); });
    const c = withPhotoshopTask('Combine', async () => { events.push('C+'); events.push('C-'); });
    await Promise.all([a, b, c]);
    assert.deepEqual(events, ['A+', 'A-', 'A!', 'B+', 'B-', 'C+', 'C-']);
    assert.deepEqual(queueState(), { activeLabel: '', waiting: 0 });

    for (const name of ['remove-bg', 'amazon', 'slider', 'landing-page']) {
        const code = fs.readFileSync(path.join(__dirname, `../src/modules/${name}/main/photoshopBridge.js`), 'utf8');
        assert(code.includes('withPhotoshopTask('), `Global lock missing in ${name}`);
        assert(code.includes('writeJsxFile('), `Unicode JSX writing missing in ${name}`);
        assert(code.includes('receiptPath:'), `Receipt-guarded fallback missing in ${name}`);
    }
    const settings = fs.readFileSync(path.join(__dirname, '../src/modules/settings/main/register.js'), 'utf8');
    assert(settings.includes('withPhotoshopTask('));
    assert(settings.includes('invocationMethod'));
    console.log('PASS Photoshop 2027: COM fallback, receipt safety, Unicode captions, shared Photoshop task serialization, module wiring');
})().catch(error => { console.error(error); process.exitCode = 1; });
