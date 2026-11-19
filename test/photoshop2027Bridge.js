"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const {
    buildComConnectVbs, buildJsxLaunchVbs, runVbsScript,
    parseSuccessfulConnection, explainFailure, connectionAdvice
} = require("../src/shared/photoshopCom");
const {
    parseRegDefault, extractExecutable, getComRegistration, formatReport
} = require("../src/modules/settings/main/photoshopDiagnostics");

(async () => {
    const connect = buildComConnectVbs("photoshopApp");
    assert(connect.indexOf('GetObject(, "Photoshop.Application")') >= 0);
    assert(connect.indexOf('CreateObject("Photoshop.Application")') > connect.indexOf('GetObject(, "Photoshop.Application")'));
    assert(connect.includes("BRANDFORGE_COM_ERROR|"));
    assert(connect.includes("BFGetNumber"));
    assert(connect.includes("BFCreateNumber"));
    assert(connect.includes('WScript.Quit 52'));
    assert(!connect.includes("Photoshop.Application.2027"), "Do not invent a versioned COM ProgID");
    assert.throws(() => buildComConnectVbs('ps\nWScript.Quit'), /Invalid VBScript/);

    // Regression for v1.7.42 Windows cscript compilation failure at probe.vbs(2, 10):
    // VBScript identifiers MUST begin with a letter (not an underscore).
    assert.throws(() => buildComConnectVbs('_ps'), /Invalid VBScript/);
    const scriptForValidation = buildJsxLaunchVbs('C:\\Temp\\test.jsx');
    assert(!scriptForValidation.includes('__bf'), 'old invalid __bf identifiers must not appear');
    for (const line of scriptForValidation.split(/\r?\n/)) {
        if (!/^Dim\s+/i.test(line)) continue;
        for (const identifier of line.replace(/^Dim\s+/i, '').split(',').map(x => x.trim())) {
            assert.match(identifier, /^[A-Za-z][A-Za-z0-9_]*$/, `Invalid VBScript declaration: ${identifier}`);
        }
    }
    const fixtureVbs = '\uFEFF' + scriptForValidation;
    const bytes = Buffer.from(fixtureVbs, 'utf16le');
    assert.deepEqual(Array.from(bytes.subarray(0, 2)), [0xff, 0xfe], 'VBS must be UTF-16LE with BOM');
    assert.equal(bytes.toString('utf16le').slice(1), scriptForValidation);


    const script = buildJsxLaunchVbs('C:\\Users\\Jo "Test"\\AppData\\Temp\\worker.jsx', { variableName: "photoshopApp", reveal: true });
    assert(script.includes('photoshopApp.DoJavaScriptFile "C:\\Users\\Jo ""Test""\\AppData\\Temp\\worker.jsx"'));
    assert(script.includes("photoshopApp.Visible = True"));
    assert(script.includes("BRANDFORGE_JSX_ERROR|"));
    assert(script.includes("BRANDFORGE_CONNECTED|"));
    assert.deepEqual(parseSuccessfulConnection("\r\nBRANDFORGE_CONNECTED|28.0.0|running\r\n"), {version: "28.0.0", method: "running"});
    assert.equal(parseSuccessfulConnection("BRANDFORGE_COM_ERROR|failure"), null);

    const failed = { code: 52, stdout: "BRANDFORGE_COM_ERROR|GetObject=-2147221021: Unavailable | CreateObject=429: ActiveX component can't create object", stderr: "" };
    assert.match(explainFailure(failed, "Slider"), /Photoshop COM could not connect/);
    assert.match(explainFailure(failed, "Slider"), /GetObject=/);
    assert.match(connectionAdvice("BRANDFORGE_JSX_ERROR|failure"), /refused the JSX command/);
    const compileFailed = {code: 1, stdout: 'C:\\Temp\\probe.vbs(2, 10) Microsoft VBScript compilation error: Invalid character', stderr: ''};
    assert.match(explainFailure(compileFailed, 'Photoshop connection test'), /launcher failed before Photoshop was contacted/);
    assert.match(explainFailure(compileFailed, 'Photoshop connection test'), /probe\.vbs\(2, 10\)/);

    // Mock cscript.exe so the test checks output capture and close semantics
    // on Linux without claiming that Windows Photoshop 2027 was exercised.
    const childFactory = (_cmd, args, opts) => {
        assert.equal(_cmd, "cscript.exe");
        assert.deepEqual(args, ["//nologo", "C:\\Temp\\probe.vbs"]);
        assert.equal(opts.windowsHide, true);
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        setImmediate(() => {
            child.stdout.emit("data", Buffer.from("BRANDFORGE_CONNECTED|28.0|created\r\n"));
            child.emit("close", 0);
        });
        return child;
    };
    const processResult = await runVbsScript("C:\\Temp\\probe.vbs", { timeoutMs: 2000, spawnProcess: childFactory });
    assert.equal(processResult.code, 0);
    assert.equal(parseSuccessfulConnection(processResult.stdout).version, "28.0");

    assert.equal(parseRegDefault('HKEY_CLASSES_ROOT\\Photoshop.Application\\CLSID\r\n    (Default)    REG_SZ    {1271048C-E6B0-4EB2-96C5-F5EEC769A313}\r\n'), '{1271048C-E6B0-4EB2-96C5-F5EEC769A313}');
    assert.equal(extractExecutable('"C:\\Program Files\\Adobe\\Adobe Photoshop 2027\\Photoshop.exe" /Automation'), 'C:\\Program Files\\Adobe\\Adobe Photoshop 2027\\Photoshop.exe');
    const mockRegistry = async (_command, args) => ({ stdout: args[1].includes("LocalServer32") ?
        'LocalServer32    REG_SZ    "C:\\Program Files\\Adobe\\Adobe Photoshop 2027\\Photoshop.exe" /Automation' :
        '(Default)   REG_SZ   {1271048C-E6B0-4EB2-96C5-F5EEC769A313}' });
    const registry = await getComRegistration({ platform: "win32", execCommand: mockRegistry });
    assert.match(registry.server, /2027/);
    assert.match(registry.clsid, /1271048C/i);

    const report = formatReport({ result: { ok: false, error: "ActiveX component can't create object", stdout: failed.stdout, stderr: "" }, registration: registry, installations: [], date: new Date("2026-11-17T04:00:00.000Z") });
    assert.match(report, /Photoshop 2027/);
    assert.match(report, /COM\/JSX test result: FAIL/);
    assert.match(report, /LocalServer32/);
    assert.match(report, /Never changed/i); // note uses never changed

    const root = path.join(__dirname, "../src/modules");
    for (const name of ["amazon", "slider", "landing-page", "remove-bg"]) {
        const file = fs.readFileSync(path.join(root, name, "main/photoshopBridge.js"), "utf8");
        assert(file.includes("buildJsxLaunchVbs"), `${name} must use shared connection`);
        assert(!file.includes('CreateObject("Photoshop.Application")'), `${name} must not duplicate the COM launcher`);
        assert(file.includes('"utf16le"'), `${name} must write Unicode VBScript for Windows`);
    }
    const settings = fs.readFileSync(path.join(root, "settings/main/register.js"), "utf8");
    assert(settings.includes("settings:test-photoshop"));
    assert(settings.includes("settings:open-photoshop-diagnostics"));
    assert(settings.includes("statusFileJsx"), "Settings tests JSX execution in addition to COM");
    console.log("Photoshop 2027 shared COM launcher, diagnostic and module integration tests PASS (mocked; Windows COM needs field QA)");
})().catch(error => { console.error(error); process.exitCode = 1; });
