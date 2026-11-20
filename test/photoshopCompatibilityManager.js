"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {EventEmitter} = require("node:events");
const {
    setPreferredMajor, getPreferredMajor, versionMatches, validatePreferredMajor
} = require("../src/shared/photoshopVersionPolicy");
const { buildComConnectVbs, buildJsxLaunchVbs, runVbsScript, explainFailure } = require("../src/shared/photoshopCom");
const {
    MODULES, scanSourceModules, buildScratchJsx, javascriptSyntax,
    readState, persistState, runCheck, REPORT_FILE
} = require("../src/modules/settings/main/compatibilityManager");

function fakeSpawn(response) {
    return () => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        process.nextTick(() => {
            child.stdout.emit("data", Buffer.from(response.stdout || ""));
            child.stderr.emit("data", Buffer.from(response.stderr || ""));
            child.emit("close", response.code);
        });
        return child;
    };
}
(async () => {
    // A preferred major is a safety guard, not an installation switch.
    assert.throws(() => validatePreferredMajor(29), /Auto/);
    assert.throws(() => validatePreferredMajor(3), /Auto/);
    setPreferredMajor(27);
    assert.equal(getPreferredMajor(), 27);
    assert(versionMatches("27.12"));
    assert(!versionMatches("28.0"));
    let vbs = buildJsxLaunchVbs("C:\\temp\\worker.jsx", {receiptPath: "C:\\temp\\status.txt"});
    assert.match(vbs, /BRANDFORGE_VERSION_MISMATCH\|required=27/);
    assert(vbs.indexOf('BRANDFORGE_VERSION_MISMATCH') < vbs.indexOf('DoJavaScriptFile'),
        "Guard must run before any JSX method");
    setPreferredMajor(28);
    assert.match(buildComConnectVbs("p"), /required=28/);
    assert.match(explainFailure({code:55, stdout:"BRANDFORGE_VERSION_MISMATCH|required=28|actual=27.11"}, "Slider"), /wrong|different Photoshop version/i);
    let recovered = 0;
    const alternate = await runVbsScript("launch.vbs", {
        spawnProcess: fakeSpawn({code:55,stdout:"BRANDFORGE_VERSION_MISMATCH|required=28|actual=27.10"}),
        rotFallback: {jsxPath:"C:\\scratch.jsx",receiptPath:"C:\\scratch.txt"},
        rotRunner: async () => { recovered++; return {code:0,stdout:"BRANDFORGE_CONNECTED|28.1|rot|ROT-DoJavaScriptFile",stderr:""}; }
    });
    assert.equal(alternate.code,0);
    assert.equal(recovered,1);
    await runVbsScript("launch.vbs", {
        spawnProcess: fakeSpawn({code:53,stdout:"BRANDFORGE_JSX_ERROR|Some error"}),
        rotFallback: {jsxPath:"C:\\scratch.jsx",receiptPath:"C:\\scratch.txt"},
        rotRunner: async () => { recovered++; throw Error("Should not retry"); }
    });
    assert.equal(recovered,1, "Never replay a task after JSX may have started");
    setPreferredMajor(0);
    assert.doesNotMatch(buildComConnectVbs(), /BRANDFORGE_VERSION_MISMATCH/);

    const scripts = scanSourceModules();
    assert.equal(scripts.length, 7);
    assert.deepEqual(scripts.map(x=>x.id), MODULES.map(x=>x.id));
    assert(scripts.every(x=>x.sourceStatus !== 'FAILED'));
    assert.equal(scripts.find(x=>x.id==='slider').checked,2, "Must parse generated Slider worker, not only source");
    assert.equal(scripts.find(x=>x.id==='amazon').sourceStatus, 'PARTIAL', "Dynamic JSX must not be falsely certified");
    const scratchScript = buildScratchJsx({receipt:'C:\\商品\\status.txt',psd:'C:\\商品\\test.psd',jpeg:'C:\\商品\\test.jpg'});
    assert.doesNotThrow(() => javascriptSyntax(scratchScript,'scratch.jsx'));
    assert.match(scratchScript, /DONOTSAVECHANGES/);
    assert.match(scratchScript, /save_psd/);
    assert.match(scratchScript, /save_jpeg/);
    assert(!scratchScript.includes('app.open('), "Scratch must never open a user source file");

    const folder = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'brandforge-manager-test-'));
    const registration = {clsid:'{GUID}',server:'"C:\\Adobe\\2027\\Photoshop.exe" /Automation', executable:'C:\\Adobe\\2027\\Photoshop.exe',exists:true};
    const dependencies = {
        userDataPath:folder,
        platform:'win32',
        getRegistration:async()=>registration,
        getInstallations:async()=>['C:\\Adobe\\2026\\Photoshop.exe','C:\\Adobe\\2027\\Photoshop.exe'],
        clock:()=>new Date('2026-11-20T01:00:00Z')
    };
    try {
        const quick = await runCheck({...dependencies,mode:'quick'});
        assert.equal(quick.overall,'STATIC_CHECK_PASSED');
        assert.equal(quick.modules.find(x=>x.id==='slider').status,'NOT_LIVE_TESTED');
        assert(!quick.connection);
        assert.equal((await readState(folder)).lastWorking,null);
        const live = await runCheck({...dependencies,mode:'full',
            connectionProbe:async()=>({ok:true,version:'28.1',method:'rot',invocationMethod:'ROT-DoJavaScriptFile'}),
            scratchProbe:async()=>({ok:true,steps:['create_document','create_layer','create_text','save_psd','save_jpeg'],version:'28.1'})
        });
        assert.equal(live.overall,'PREFLIGHT_PASSED');
        assert.equal(live.lastWorking.version,'28.1');
        assert(live.modules.every(x=>x.status==='PREFLIGHT_PASSED'));
        const reportText = await fs.promises.readFile(path.join(folder,REPORT_FILE),'utf8');
        assert.match(reportText,/NOT A REAL OUTPUT TEST/);
        assert.match(reportText,/BrandForge.*scratch|Temporary PSD/i);
        assert.match(reportText,/28\.1/);

        const state = await readState(folder);
        state.preferredMajor = 27;
        await persistState(folder,state);
        assert.equal((await readState(folder)).preferredMajor,27);
        const failed = await runCheck({...dependencies,mode:'full',connectionProbe:async()=>({ok:false,error:'COM 429'}),
            scratchProbe:async()=>{ throw Error('Scratch must not run after connection failure'); }});
        assert.equal(failed.overall,'FAILED');
        assert.equal(failed.lastWorking.version,'28.1', 'Failure must preserve last working version');
        assert(failed.modules.every(x=>x.status==='BLOCKED'));
        assert.equal(failed.preferredMajor,27);

        // Version-path fingerprint catches updates installed over the SAME Photoshop.exe path.
        const fakeExe = path.join(folder, "Photoshop.exe");
        await fs.promises.writeFile(fakeExe, "installation-v1");
        const samePath = { ...registration, executable: fakeExe, exists: true };
        await runCheck({...dependencies, getRegistration:async()=>samePath, mode:'full',
            connectionProbe:async()=>({ok:true,version:'28.3',method:'rot'}),
            scratchProbe:async()=>({ok:true,steps:[],version:'28.3'})});
        await fs.promises.writeFile(fakeExe, "installation-v2-updated");
        const updatedExe = await runCheck({...dependencies, getRegistration:async()=>samePath, mode:'quick'});
        assert.equal(updatedExe.hasExecutableChanged,true, 'Changed executable content should trigger the update warning');
        assert.match(updatedExe.note,/Photoshop changed/);

        // Updated Photoshop must be flagged even when the new version passes preflight.
        const changed = await runCheck({...dependencies,mode:'full',connectionProbe:async()=>({ok:true,version:'27.12',method:'running'}),
            scratchProbe:async()=>({ok:true,steps:[],version:'27.12'})});
        assert.equal(changed.hasVersionChanged,true);
        assert.match(changed.note,/changed since/);
    } finally { await fs.promises.rm(folder,{recursive:true,force:true}); }

    const ps1 = fs.readFileSync(path.join(__dirname,'../src/shared/photoshopRot.ps1'),'utf8');
    assert.match(ps1,/BRANDFORGE_REQUIRED_MAJOR/);
    assert.match(ps1,/Find\(string required\)/);
    assert.doesNotMatch(ps1,/regsvr32|Set-ItemProperty|New-ItemProperty/i);
    const settings = fs.readFileSync(path.join(__dirname,'../src/modules/settings/main/register.js'),'utf8');
    for (const channel of ['settings:compat:get','settings:compat:scan','settings:compat:set-preference','settings:compat:open-report']) {
        assert(settings.includes(channel),`Missing ${channel}`);
    }
    const html = fs.readFileSync(path.join(__dirname,'../src/renderer/index.html'),'utf8');
    for (const id of ['compatPreferredVersion','compatQuickBtn','compatLiveBtn','compatModuleGrid','compatStatus','compatOpenReportBtn']) {
        assert(html.includes(`id="${id}"`),`UI control missing: ${id}`);
    }
    const ui = fs.readFileSync(path.join(__dirname,'../src/renderer/compatibilityUi.js'),'utf8');
    assert.doesNotThrow(()=>new (require('node:vm').Script)(ui));
    assert(ui.includes('textContent'), 'User paths/logs must be rendered as text, not injected HTML');
    console.log('PASS Compatibility Manager: static probes, scratch JSX, Photoshop 27/28 guard, safe ROT fallback, reports, saved stable version, IPC and UI');
})().catch(error => {console.error(error);process.exitCode=1;}).finally(()=>setPreferredMajor(0));
