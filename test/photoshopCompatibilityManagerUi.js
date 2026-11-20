"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeElement {
    constructor(name) {
        this.id = name; this.children=[]; this.handlers={}; this.textContent="";
        this.className=""; this.value="0"; this.disabled=false; this.hidden=false;
    }
    addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...items) { this.children = [...items]; }
    async trigger(type) { for(const fn of this.handlers[type]||[]) await fn({target:this}); }
}
(async()=>{
    const elements = new Map();
    const document = {
        getElementById(id) { if (!elements.has(id)) elements.set(id,new FakeElement(id)); return elements.get(id); },
        createElement(tag) { return new FakeElement(tag); }
    };
    const source = fs.readFileSync(path.join(__dirname,"../src/renderer/compatibilityUi.js"),"utf8");
    const calls=[];
    let major=0;
    const report={ mode:"quick",overall:"STATIC_CHECK_PASSED", checkedAt:"2026-11-20T01:00:00Z", preferredMajor:0,
        registration:{executable:"C:\\Adobe\\Photoshop 2027\\Photoshop.exe",server:'"C:\\Adobe\\Photoshop 2027\\Photoshop.exe"'},
        installations:["C:\\Adobe\\Photoshop 2026\\Photoshop.exe","C:\\Adobe\\Photoshop 2027\\Photoshop.exe"],
        modules:[{label:'Slider <script>',status:'NOT_LIVE_TESTED',detail:'Script parses.',failures:[]}]
    };
    const working={version:"28.0",method:"rot",checkedAt:"2026-11-20T01:00:00Z"};
    const window={settingsApp:{
        async getCompatibility(){calls.push('get');return{preferredMajor:major,lastCheck:report,lastWorking:working};},
        async scanCompatibility(mode){calls.push(mode);return{...report,mode,overall:mode==='full'?'PREFLIGHT_PASSED':'STATIC_CHECK_PASSED',
            preferredMajor:major,lastWorking:working, connection:mode==='full'?{ok:true,version:'28.0',method:'rot'}:null,
            scratch:mode==='full'?{ok:true,steps:[]}:null,
            modules:report.modules.map(x=>({...x,status:mode==='full'?'PREFLIGHT_PASSED':x.status}))};},
        async setPhotoshopPreference(n){calls.push('preference:'+n); major=n;return{preferredMajor:n,note:'Selected preference saved.'};},
        async openCompatibilityReport(){calls.push('report');return{ok:true};}
    }};
    const context=vm.createContext({window,document,console,Date,String,Number});
    vm.runInContext(source,context,{filename:'compatibilityUi.js'});
    await window.initCompatibilityManager();
    assert(calls.includes('get'));
    const status=document.getElementById('compatStatus');
    assert.match(status.textContent,/Source scan passed/);
    const modules=document.getElementById('compatModuleGrid');
    assert.equal(modules.children.length,1);
    assert.equal(modules.children[0].children[0].children[0].textContent,'Slider <script>');
    assert(!modules.children[0].innerHTML, 'Labels should not be inserted as HTML');
    const select=document.getElementById('compatPreferredVersion');
    select.value='27';await select.trigger('change');
    assert.equal(major,27);
    assert(calls.includes('preference:27'));
    await document.getElementById('compatUseLastWorkingBtn').trigger('click');
    assert.equal(major,28, 'Use Last Working must restore saved major');
    await document.getElementById('compatQuickBtn').trigger('click');
    assert(calls.includes('quick'));
    await document.getElementById('compatLiveBtn').trigger('click');
    assert(calls.includes('full'));
    assert.match(status.textContent,/Live preflight passed/);
    await document.getElementById('compatOpenReportBtn').trigger('click');
    assert(calls.includes('report'));
    console.log('PASS Compatibility Manager UI: loaded report, safe labels, version selection, last-working guard, quick/live scans, report opening');
})().catch(e=>{console.error(e);process.exitCode=1;});
