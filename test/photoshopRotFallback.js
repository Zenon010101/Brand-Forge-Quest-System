"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { runVbsScript, runRotFallback, parseSuccessfulConnection, explainFailure } = require("../src/shared/photoshopCom");

function fakeSpawnFactory({ code = 52, stdout = "", stderr = "" } = {}) {
    return (exe, args, opts) => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        process.nextTick(() => {
            child.stdout.emit("data", Buffer.from(stdout));
            child.stderr.emit("data", Buffer.from(stderr));
            child.emit("close", code);
        });
        return child;
    };
}
(async () => {
    const vbsFailure = fakeSpawnFactory({ code: 52, stdout: "BRANDFORGE_COM_ERROR|GetObject=429 | CreateObject=429" });
    const jsx = "C:\\Users\\Test User\\商品\\worker.jsx";
    const receipt = "C:\\Users\\Test User\\商品\\status.txt";
    let fallbackCalls = 0;
    const recovered = await runVbsScript("launch.vbs", {
        spawnProcess: vbsFailure, rotFallback: { jsxPath: jsx, receiptPath: receipt },
        rotRunner: async ({jsxPath, receiptPath}) => {
            fallbackCalls++;
            assert.equal(jsxPath, jsx);
            assert.equal(receiptPath, receipt);
            return {code:0, stdout:"BRANDFORGE_CONNECTED|28.0|rot|ROT-DoJavaScriptFile", stderr:""};
        }
    });
    assert.equal(fallbackCalls, 1);
    assert.equal(recovered.code, 0);
    assert.deepEqual(parseSuccessfulConnection(recovered.stdout), { version:"28.0", method:"rot", invocationMethod:"ROT-DoJavaScriptFile" });

    fallbackCalls = 0;
    const directSuccess = await runVbsScript("launch.vbs", {
        spawnProcess: fakeSpawnFactory({code:0, stdout:"BRANDFORGE_CONNECTED|27.11|running|DoJavaScriptFile"}),
        rotFallback: {jsxPath:jsx,receiptPath:receipt}, rotRunner: async () => {fallbackCalls++; throw new Error("Should not run");}
    });
    assert.equal(directSuccess.code,0);
    assert.equal(fallbackCalls,0, "Never retry a successful Photoshop operation");

    const scriptFailure = await runVbsScript("launch.vbs", {
        spawnProcess: fakeSpawnFactory({code:53, stdout:"BRANDFORGE_JSX_ERROR|worker failed"}),
        rotFallback: {jsxPath:jsx,receiptPath:receipt}, rotRunner: async () => {fallbackCalls++; throw new Error("Should not run");}
    });
    assert.equal(scriptFailure.code,53);
    assert.equal(fallbackCalls,0,"Never replay a possibly partial JSX task");

    const unavailable = await runVbsScript("launch.vbs", {
        spawnProcess: vbsFailure, rotFallback: {jsxPath:jsx,receiptPath:receipt},
        rotRunner: async () => ({code:54, stdout:"BRANDFORGE_ROT_UNAVAILABLE|no registered application", stderr:""})
    });
    assert.equal(unavailable.code,52);
    assert.match(unavailable.stdout,/BRANDFORGE_COM_ERROR/);
    assert.match(unavailable.stdout,/BRANDFORGE_ROT_UNAVAILABLE/);
    assert.match(explainFailure(unavailable,"Remove Background"), /ROT/);

    const error = await runVbsScript("launch.vbs", {
        spawnProcess: vbsFailure, rotFallback: {jsxPath:jsx,receiptPath:receipt},
        rotRunner: async () => {throw new Error("PowerShell blocked by policy");}
    });
    assert.match(error.stdout,/PowerShell blocked by policy/);
    assert.equal(error.code,52);

    const psCode = fs.readFileSync(path.join(__dirname, "../src/shared/photoshopRot.ps1"), "utf8");
    assert.match(psCode,/GetRunningObjectTable/);
    assert.match(psCode,/5DE90358-4D0B-4FA1-BA3E-C91BBA863F32/);
    assert.match(psCode,/Version/);
    assert.match(psCode,/DoJavaScriptFile/);
    assert.match(psCode,/BRANDFORGE_ROT_UNAVAILABLE/);
    assert.doesNotMatch(psCode, /Set-ItemProperty|New-ItemProperty|reg\.exe|regsvr32|ExecutionPolicy Bypass/i);

    let powershell = null;
    const psResult = await runRotFallback({jsxPath:jsx, receiptPath:receipt, spawnProcess:(exe, args, opts) => {
        powershell={exe,args,opts};
        return fakeSpawnFactory({code:54,stdout:"BRANDFORGE_ROT_ERROR|test"})(exe,args,opts);
    }});
    assert.equal(powershell.exe,"powershell.exe");
    assert.equal(powershell.opts.env.BRANDFORGE_ROT_JSX,jsx);
    assert.equal(powershell.opts.env.BRANDFORGE_ROT_RECEIPT,receipt);
    assert(!powershell.args.includes("Bypass"));
    assert.equal(psResult.code,54);

    const modules = ["remove-bg","slider","amazon","landing-page"];
    for (const name of modules) {
        const code = fs.readFileSync(path.join(__dirname,`../src/modules/${name}/main/photoshopBridge.js`),"utf8");
        assert.match(code,/rotFallback:/,`ROT fallback missing in ${name}`);
    }
    assert.match(fs.readFileSync(path.join(__dirname,"../src/modules/settings/main/register.js"),"utf8"),/rotFallback:/);
    console.log("PASS Photoshop 2027 ROT non-activating fallback, receipt safety, failure visibility, and module integration");
})().catch(e=>{console.error(e);process.exitCode=1;});
