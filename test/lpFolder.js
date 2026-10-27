"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const sharp = require("sharp");
const planner = require("../src/modules/lp-folder/main/planner");
const { makeEntryFile, planJPEGParts } = require("../src/modules/lp-folder/main/photoshop");
const { publish, publishLP, fingerprint, familyRegex } = require("../src/modules/lp-folder/main/output");
const { LPFolderService } = require("../src/modules/lp-folder/main/service");

function psdHeader(width, height, psb) {
    const buf = Buffer.alloc(26);
    buf.write("8BPS", 0, 4, "ascii");
    buf.writeUInt16BE(psb ? 2 : 1, 4);
    buf.writeUInt16BE(3, 12);
    buf.writeUInt32BE(height, 14);
    buf.writeUInt32BE(width, 18);
    buf.writeUInt16BE(8, 22);
    buf.writeUInt16BE(3, 24);
    return buf;
}
async function writePsd(file, width, height, psb = false) { await fs.promises.writeFile(file, psdHeader(width, height, psb)); }
async function createImage(file, width, height) {
    return sharp({ create: { width, height, channels: 4, background: { r: 180, g: 80, b: 40, alpha: 1 } } }).toFile(file);
}
function fakeLayer(group, name) {
    return { group, name, kind: "Smart Object", bounds: [0, 0, 600, 500], visible: true };
}
function runJsxSim(sliced = false) {
    const src = fs.readFileSync(path.join(__dirname, "../src/modules/lp-folder/jsx/compose.jsx"), "utf8").replace(/^#target photoshop[^\n]*\n/, "");
    assert(!/copyMerged|selection\.copy|paste\(/i.test(src), "JSX must not use Copy Merged or clipboard");
    const created = [];
    const saves = [];
    const sliceDocs = [];
    let document;
    const bounds = nums => nums.map(n => ({ as: () => n }));
    const jpegParts = sliced ? [
        { path: "C:/TEST_LP_01.jpg", top: 0, height: 60000 },
        { path: "C:/TEST_LP_02.jpg", top: 60000, height: 2 }
    ] : [{ path: "C:/TEST_LP.jpg", top: 0, height: 2600 }];
    const session = {
        FOLDER_LP_JOB: { width: 1000, height: sliced ? 60002 : 2600, baseName: "TEST_LP", format: sliced ? "psb" : "psd", jpegParts,
            sections: [{ name: "01.png", input: "C:/01.png", group: "02_LP_PART_01", layerName: "01", x: 0, y: 1000, placedWidth: 1000, placedHeight: 1600 }],
            single: { name: "Single.png", input: "C:/Single.png", x: 0, y: 0, placedWidth: 1000, placedHeight: 1000 } },
        FOLDER_LP_DEST: sliced ? "C:/TEST_LP.psb" : "C:/TEST_LP.psd",
        isFinite, Number, String, Math, Error,
        File: function(f) { this.path = f; this.exists = true; },
        UnitValue: function(n) { this.value = n; },
        app: { preferences: { rulerUnits: "in" }, documents: { add(width,height) {
            document = { width,height, closed:false, flattened:false, groups:[], activeLayer:null,
                layerSets: { add() { const g={ name:"", layers:[], visible:true }; document.groups.unshift(g); return g; } },
                saveAs(file) { saves.push({ file:file.path, flattened:document.flattened }); },
                flatten() { document.flattened = true; },
                duplicate(name) {
                    const obj = {
                        name, cropped:null, closed:false,
                        crop(b) { this.cropped = b.map(x=>x.value); },
                        saveAs(file) { saves.push({ file:file.path, flattened:true, crop:this.cropped }); },
                        close() { this.closed = true; }
                    };
                    sliceDocs.push(obj);
                    return obj;
                },
                close() { document.closed=true; }
            };
            return document;
        } } },
        ActionDescriptor: function() { this.putPath=()=>{}; this.putEnumerated=()=>{}; },
        charIDToTypeID: x => x,
        executeAction: function() {
            const obj = { name:"", visible:true, x:0,y:0,w:600,h:600,
                move(group) { group.layers.push(this); },
                resize(xPct,yPct) { this.w *= xPct/100; this.h *= yPct/100; },
                translate(dx,dy) { this.x += dx.value; this.y += dy.value; },
                get bounds() { return bounds([this.x,this.y,this.x+this.w,this.y+this.h]); } };
            session.app.activeDocument.activeLayer = obj; created.push(obj);
        },
        DialogModes: { NO: 0 },
        AnchorPosition: { TOPLEFT: 0 }, ElementPlacement: { INSIDE: 0 },
        NewDocumentMode: { RGB: 0 }, DocumentFill: { TRANSPARENT: 0 },
        SaveOptions: { DONOTSAVECHANGES: 0 }, Extension: { LOWERCASE: 0 }, Units: { PIXELS: 0 },
        PhotoshopSaveOptions: function() {}, LargeDocumentFormatSaveOptions: function() {},
        JPEGSaveOptions: function() {}, FormatOptions: { STANDARDBASELINE: "baseline" }
    };
    vm.runInNewContext(src, session, { timeout: 2000 });
    assert(document.closed, "Original Photoshop document must close without saving flattening");
    assert.equal(document.width, 1000);
    assert.deepEqual(document.groups.map(g=>g.name), ["01_SINGLE", "02_LP_PART_01"]);
    const single = document.groups[0].layers[0]; const part = document.groups[1].layers[0];
    assert.equal(Math.round(single.x), 0); assert.equal(Math.round(single.y), 0);
    assert.equal(Math.round(single.w), 1000); assert.equal(Math.round(single.h), 1000);
    assert.equal(Math.round(part.y), 1000); assert.equal(Math.round(part.h), 1600);
    assert.equal(created.length, 2);
    assert.equal(saves.length, 1 + jpegParts.length);
    assert.equal(saves[0].flattened, false, "PSD/PSB must be saved before flattening");
    assert(saves.slice(1).every(item=>item.flattened), "JPEG output must be flattened");
    assert(saves[0].file.endsWith(sliced ? ".psb" : ".psd"));
    if (sliced) {
        assert.equal(sliceDocs.length, 2);
        assert(sliceDocs.every(item => item.closed));
        assert.deepEqual(Array.from(sliceDocs[0].cropped), [0,0,1000,60000]);
        assert.deepEqual(Array.from(sliceDocs[1].cropped), [0,60000,1000,60002]);
    } else { assert.equal(saves[1].file, "C:/TEST_LP.jpg"); }
    assert.equal(session.app.preferences.rulerUnits, "in");
}

async function main() {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bf-lp-folder-test-"));
    try {
        const dir = path.join(root, "AKA-90"); await fs.promises.mkdir(dir);
        await createImage(path.join(dir, "AKA-90.jpg"), 600, 600);
        await createImage(path.join(dir, "02_product.png"), 750, 1200);
        await createImage(path.join(dir, "10_feature.webp"), 500, 450);
        await createImage(path.join(dir, "3_detail.tiff"), 600, 1000);
        await writePsd(path.join(dir, "4_editable.psd"), 820, 1350);
        await writePsd(path.join(dir, "5_editable.psb"), 1000, 850, true);
        await fs.promises.writeFile(path.join(dir, "6_broken.avif"), Buffer.from("not an image"));
        await fs.promises.writeFile(path.join(dir, "AKA-90_LP.psd"), Buffer.alloc(1700,1));
        await fs.promises.writeFile(path.join(dir, "AKA-90_LP.jpg"), Buffer.alloc(1700,2));
        await fs.promises.writeFile(path.join(dir, "AKA-90_LP_01.jpg"), Buffer.alloc(1700,3));
        await fs.promises.writeFile(path.join(dir, "notes.txt"), "not LP data");
        const scanned = await planner.scanFolder(dir);
        assert.equal(scanned.images.length, 6);
        assert.equal(scanned.singlePath, path.join(dir, "AKA-90.jpg"));
        assert.deepEqual(scanned.images.map(f=>f.name),
            ["02_product.png","3_detail.tiff","4_editable.psd","5_editable.psb","10_feature.webp","AKA-90.jpg"]);
        assert(scanned.warnings.some(w=>w.includes("6_broken.avif")));
        assert(!scanned.images.some(i=>i.name.startsWith("AKA-90_LP")), "generated PSD/JPEG and its slices must not be re-scanned");
        const order = [scanned.singlePath, ...scanned.images.filter(i=>i.path!==scanned.singlePath).map(i=>i.path)];
        const layout = planner.createLayout(scanned, order, scanned.singlePath);
        assert.equal(layout.width, 1000); assert.equal(layout.single.y, 0);
        assert.equal(layout.single.placedHeight, 1000);
        assert.equal(layout.sections[0].y, 1000);
        // Custom PSD/JPEG filename is designer-editable and independent of folder.
        assert.equal(planner.normalizeOutputBaseName("Custom Name.psd", "AKA-90"), "Custom Name");
        assert.equal(planner.normalizeOutputBaseName("別注 LP 2026.jpg", "AKA-90"), "別注 LP 2026");
        assert.equal(planner.normalizeOutputBaseName(undefined, "AKA-90"), "AKA-90_LP");
        for (const invalid of ["", "../hack", "my:name", "CON", "nul.txt", "bad.", ".secret", "x".repeat(121)]) {
            assert.throws(() => planner.normalizeOutputBaseName(invalid, "AKA-90"), /Invalid LP output filename/);
        }
        const renamed = planner.createLayout(scanned, order, scanned.singlePath, "Custom Name.psd");
        assert.equal(renamed.baseName, "Custom Name");
        assert.throws(() => planner.createLayout(scanned, order, scanned.singlePath, "AKA-90"), /conflicts with source/i);
        assert.throws(() => planner.createLayout(scanned, order, scanned.singlePath, "4_editable.psd"), /conflicts with source/i);
        assert.equal(layout.sections[0].placedHeight, 1600);
        for (let i=1; i<layout.sections.length; i++) {
            assert.equal(layout.sections[i].y, layout.sections[i-1].y+layout.sections[i-1].placedHeight, "no vertical gaps");
        }
        assert.equal(layout.height, layout.sections.at(-1).y + layout.sections.at(-1).placedHeight);
        assert.throws(() => planner.createLayout(scanned,[...order.slice(0,-1), order[0]],scanned.singlePath),/duplicate/);
        assert.throws(() => planner.createLayout(scanned,order,null),/Single/);
        const subset = planner.createLayout(scanned, [order[0],order[2]],scanned.singlePath);
        assert.equal(subset.sections.length,1);
        // Raster input normalized in a local temporary workspace; PSD source is kept embedded original.
        const assets = path.join(root,"tempAssets"); await fs.promises.mkdir(assets);
        const normalized = await makeEntryFile(layout.sections[0],assets,1);
        const info = await sharp(normalized).metadata();
        assert.equal(info.width,1000); assert.equal(info.height,1600);
        assert.equal(await makeEntryFile(layout.sections.find(p=>p.extension===".psd"),assets,2),path.join(dir,"4_editable.psd"));
        // Full-image parsing, disambiguation, original source untouched.
        const dirs = path.join(root,"ambiguous"); await fs.promises.mkdir(dirs);
        await createImage(path.join(dirs,"Single.png"),12,12);
        await createImage(path.join(dirs,"single2.webp"),15,15);
        const ambiguity = await planner.scanFolder(dirs);
        assert.equal(ambiguity.singlePath,null);
        assert(ambiguity.warnings.some(w=>w.includes("Several")));
        // Product ID recognition when the folder is not named after the item.
        const arbitrary = path.join(root, "LP Parts"); await fs.promises.mkdir(arbitrary);
        await createImage(path.join(arbitrary, "AKA-90.jpg"), 600, 600);
        await createImage(path.join(arbitrary, "01_details.png"), 400, 900);
        assert.equal((await planner.scanFolder(arbitrary)).singlePath, path.join(arbitrary, "AKA-90.jpg"));
        assert.throws(() => planner.parsePhotoshopHeader(Buffer.from("bad"), "abc.psd"), /signature/);
        const tall = { ...scanned, images: [scanned.images[0], { ...scanned.images[1], height: 31000, width: 1000 }] };
        const tallOrder = tall.images.map(i=>i.path);
        const psb = planner.createLayout(tall,tallOrder,tallOrder[0]);
        assert.equal(psb.format,"psb");
        const lpUi = fs.readFileSync(path.join(__dirname, "../src/modules/lp-folder/renderer/index.html"), "utf8");
        const lpUiJs = fs.readFileSync(path.join(__dirname, "../src/modules/lp-folder/renderer/app.js"), "utf8");
        assert(/id="generate"[^>]*>Generate LP<\/button>/.test(lpUi));
        assert(/id="outputJpegName"/.test(lpUi));
        assert(/id="outputBaseName"/.test(lpUi), "LP output name must be editable");
        assert(/outputBaseName:\s*filename\.name/.test(lpUiJs), "Custom output name must be sent to backend");
        assert(/Generate LP/.test(lpUiJs));
        runJsxSim();
        runJsxSim(true);
        assert.equal(planJPEGParts(60000, root).length, 1);
        assert.equal(planJPEGParts(60001, root).length, 2);
        assert.equal(planJPEGParts(120001, root).length, 3);
        assert.equal(planJPEGParts(120001, root).at(-1).height, 1);
        assert(familyRegex("AKA-90_LP").test("AKA-90_LP_01.jpg"));
        assert(!familyRegex("AKA-90_LP").test("AKA-90_LP_v2.jpg"));
        // The Slider JSX must use #1E1E1E only for LINEUP variant/color text.
        const sliderJsx = fs.readFileSync(path.join(__dirname, "../src/modules/slider/jsx/sliderEngine.jsx"), "utf8");
        const lineupFunction = sliderJsx.split("function createVariantTextLayer(")[1].split("function buildHorizontalLineupGroup(")[0];
        assert(/rgb\.red\s*=\s*30;/.test(lineupFunction));
        assert(/rgb\.green\s*=\s*30;/.test(lineupFunction));
        assert(/rgb\.blue\s*=\s*30;/.test(lineupFunction));
        // Publisher: new version then safe backup/replace, with verified bytes.
        const staged = path.join(root,"result.psd");
        await fs.promises.writeFile(staged,Buffer.alloc(5200,0x31));
        const first = await publish(staged,dir,"TEST_LP","psd","version");
        assert.equal(path.basename(first.outputPath),"TEST_LP.psd");
        const second = await publish(staged,dir,"TEST_LP","psd","version");
        assert.equal(path.basename(second.outputPath),"TEST_LP_v2.psd");
        await fs.promises.writeFile(staged,Buffer.alloc(5400,0x42));
        await assert.rejects(publish(staged,dir,"TEST_LP","psd","cancel"),/exists/i);
        const replaced = await publish(staged,dir,"TEST_LP","psd","replace");
        assert(replaced.backupPath && fs.existsSync(replaced.backupPath));
        assert.equal((await fingerprint(replaced.backupPath)).size,5200);
        assert.equal((await fingerprint(replaced.outputPath)).size,5400);
        const srcHash = await fingerprint(path.join(dir,"AKA-90.jpg"));
        // Paired publishing: same stem for editable PSD and JPEG, then versioned
        // as a matched pair even when only one destination filename exists.
        const jpegStage = path.join(root, "paired.jpg");
        await sharp({ create: { width:1000,height:30,channels:3,background:"#cccccc" } }).jpeg().toFile(jpegStage);
        const paired = { psdPath: staged, jpegParts: [{ path:jpegStage,top:0,height:30 }] };
        const pairA = await publishLP(paired,dir,"PAIR_LP","psd","version");
        assert.equal(path.basename(pairA.outputPath),"PAIR_LP.psd");
        assert.equal(path.basename(pairA.jpegPath),"PAIR_LP.jpg");
        assert.equal((await fingerprint(pairA.jpegPath)).hash,(await fingerprint(jpegStage)).hash);
        const pairB = await publishLP(paired,dir,"PAIR_LP","psd","version");
        assert.equal(path.basename(pairB.outputPath),"PAIR_LP_v2.psd");
        assert.equal(path.basename(pairB.jpegPath),"PAIR_LP_v2.jpg");
        await assert.rejects(publishLP(paired,dir,"PAIR_LP","psd","cancel"),/exists/i);
        // Split LP: output strips are independent JPEGs, and old single JPG is
        // removed only after successful replacement (with backup retained).
        const jpg2 = path.join(root, "paired2.jpg");
        await sharp({ create: { width:1000,height:25,channels:3,background:"#999999" } }).jpeg().toFile(jpg2);
        const twoPart = { psdPath: staged, jpegParts: [{ path:jpegStage,top:0,height:30 },{ path:jpg2,top:30,height:25 }] };
        const partsPublished = await publishLP(twoPart,dir,"PAIR_LP","psd","replace");
        assert.equal(partsPublished.jpegPaths.length,2);
        assert.equal(path.basename(partsPublished.jpegPaths[0]),"PAIR_LP_01.jpg");
        assert(!fs.existsSync(path.join(dir,"PAIR_LP.jpg")), "old single JPEG removed after replacement");
        assert(partsPublished.backupPaths["PAIR_LP.jpg"]);
        const replacedAgain = await publishLP(paired,dir,"PAIR_LP","psd","replace");
        assert.equal(replacedAgain.jpegPaths.length,1);
        assert(!fs.existsSync(path.join(dir,"PAIR_LP_01.jpg")), "obsolete JPG slices removed");
        // Simulate second-copy failure: old JPEG and PSD must both survive.
        const beforePsd = (await fingerprint(replacedAgain.outputPath)).hash;
        const beforeJpg = (await fingerprint(replacedAgain.jpegPath)).hash;
        const originalCopyFile = fs.promises.copyFile;
        fs.promises.copyFile = async function(from, to, ...rest) {
            if (to === path.join(dir,"PAIR_LP.jpg") && from === jpegStage) throw new Error("simulated shared drive JPEG write failure");
            return originalCopyFile.call(fs.promises,from,to,...rest);
        };
        try { await assert.rejects(publishLP(paired,dir,"PAIR_LP","psd","replace"),/simulated shared drive/i); }
        finally { fs.promises.copyFile = originalCopyFile; }
        assert.equal((await fingerprint(replacedAgain.outputPath)).hash,beforePsd);
        assert.equal((await fingerprint(replacedAgain.jpegPath)).hash,beforeJpg);
        await assert.rejects(publishLP({ psdPath:staged, jpegParts:[{path:jpegStage,top:5,height:30}] },dir,"BAD_LP","psd","version"),/out of order/);
        // End-to-end service via mock Photoshop backend: no Windows/Photoshop needed in test.
        const mockService = new LPFolderService({ builder: async (plan,work) => {
            assert(plan.sections.length > 0);
            const out = path.join(work,`result.${plan.format}`);
            await fs.promises.writeFile(out,Buffer.alloc(1900,0x53));
            const jpg = path.join(work,"result.jpg");
            await sharp({ create: { width:1000,height:plan.height,channels:3,background:"#ffffff" } })
                .jpeg({ quality: 75 }).toFile(jpg);
            return { psdPath:out, jpegParts:[{ path:jpg, top:0, height:plan.height }] };
        } });
        await mockService.chooseFolder(dir);
        const state = mockService.getState();
        const result = await mockService.generate({ orderedPaths:state.images.map(i=>i.path), singlePath:state.singlePath, existingAction:"version" });
        assert.equal(path.dirname(result.outputPath),dir);
        assert.equal(result.jpegPaths.length,1);
        assert.equal(path.basename(result.jpegPath),"AKA-90_LP_v2.jpg");
        assert.equal((await sharp(result.jpegPath).metadata()).height,result.height);
        assert.equal(result.width,1000);
        // Use a completely different name, including spaces/Unicode. Photoshop
        // and JPEG must match, and source images must never be renamed.
        const customPayload = { orderedPaths:state.images.map(i=>i.path), singlePath:state.singlePath,
            outputBaseName:"別注 LP 2026.psd", existingAction:"version" };
        const customA = await mockService.generate(customPayload);
        assert.equal(path.basename(customA.outputPath),"別注 LP 2026.psd");
        assert.equal(path.basename(customA.jpegPath),"別注 LP 2026.jpg");
        const customB = await mockService.generate(customPayload);
        assert.equal(path.basename(customB.outputPath),"別注 LP 2026_v2.psd");
        assert.equal(path.basename(customB.jpegPath),"別注 LP 2026_v2.jpg");
        const rescanned = await planner.scanFolder(dir);
        assert.equal(rescanned.images.length, state.images.length,
            "Custom-named outputs must not become new source LP images after refresh");
        assert(!rescanned.images.some(i=>i.name.includes("別注 LP 2026")));
        await assert.rejects(mockService.generate({ ...customPayload, outputBaseName:"AKA-90", existingAction:"replace" }),
            /conflicts with source/i, "An output name must never overwrite an original product JPG");
        assert.equal((await fingerprint(path.join(dir,"AKA-90.jpg"))).hash,srcHash.hash);
        await assert.rejects(mockService.generate({ orderedPaths:["C:/outside.png"],singlePath:state.singlePath }),/invalid|duplicate/i);
        assert(!mockService.busy);
        console.log("LP Folder Generator tests PASS: mixed sources, editable PSD/JPEG filename, Unicode names, source collision protection, generated-output scan exclusion, paired outputs, rollback, versioning, JSX composition and Slider LINEUP color.");
    } finally { await fs.promises.rm(root,{recursive:true,force:true}).catch(()=>{}); }
}
main().catch(error=>{ console.error(error.stack||error);process.exitCode=1; });
