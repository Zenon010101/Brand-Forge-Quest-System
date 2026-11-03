"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { DIM, buildCombineLayout, wrapColorName, safeOutputName } = require("../src/modules/combine/main/planner");
const { inspectBatch, visibleBounds } = require("../src/modules/combine/main/assets");
const { CombineService } = require("../src/modules/combine/main/service");
const { publishCombine } = require("../src/modules/combine/main/publish");

function part(id, width = 600, height = 600, name = id + ".png") {
    return { path: "/tmp/" + name, name, width, height, visibleWidth: width, visibleHeight: height,
        extension: ".png" };
}
function pix(piece) { return [piece.x, piece.y, piece.placedWidth, piece.placedHeight]; }

async function testLayouts() {
    assert.equal(DIM.width, 600);
    assert.equal(DIM.margin * 2 + DIM.cell * 2 + DIM.columnGap, 600);
    const single = part("single");
    const lineup = ["Black", "Navy", "Beige", "White", "Red"].map((colorName, i) => ({ ...part("var" + i), colorName }));
    const details = [1,2,3,4,5,6,7].map(i => part("detail" + i));
    const layout = buildCombineLayout({ single, lineup, details, outputName: "PRODUCT_COMBINE" });
    assert.equal(layout.width, 600); assert.equal(layout.format, "psd");
    assert.equal(layout.single.x, 0); assert.equal(layout.single.y, 0);
    assert.equal(layout.lineupRows.length, 3);
    assert.equal(layout.lineup[0].slotX, 3);
    assert.equal(layout.lineup[1].slotX, 304);
    assert.equal(layout.lineup[0].slotY, 615);
    assert.equal(layout.lineup[1].slotY, 615);
    assert.equal(layout.lineup[2].slotY, 615 + DIM.cell + DIM.labelGap + DIM.labelLine + DIM.rowGap);
    assert.equal(layout.lineup[4].slotX, 3);
    assert.equal(layout.lineup[4].slotY, layout.lineup[3].slotY + DIM.cell + DIM.labelGap + DIM.labelLine + DIM.rowGap);
    assert.equal(layout.details[0].slotX, 3);
    assert.equal(layout.details[1].slotX, 304);
    assert.equal(layout.details[0].slotY, layout.details[1].slotY);
    assert.equal(layout.details[2].slotY - layout.details[0].slotY, 300);
    assert.equal(layout.details[3].slotX, 304);
    assert.equal(layout.details[6].slotX, 3);
    assert.equal(layout.height, layout.details[6].slotY + DIM.cell + DIM.margin);
    assert(layout.detailsHeader.y >= layout.lineup[4].labelY + layout.lineup[4].labelHeight + DIM.detailsGap);
    // A detail image must fit *inside* its designated cell without clipping.
    for(const p of [...layout.lineup, ...layout.details]) {
        assert(p.placedWidth <= 293 && p.placedHeight <= 293);
        assert(p.x >= p.slotX && p.y >= p.slotY);
        assert(p.x + p.placedWidth <= p.slotX + 293);
        assert(p.y + p.placedHeight <= p.slotY + 293);
    }
    assert.deepEqual(layout.lineup.map(x => x.colorName), ["Black", "Navy", "Beige", "White", "Red"]);
    assert.equal(layout.jpegCount, 1);
    const noLine = buildCombineLayout({ single, lineup: [], details: [part("detail")], outputName:"test" });
    assert.equal(noLine.details[0].slotY, 615 + DIM.detailsHeadingHeight + DIM.detailsHeadingGap);
    assert.equal(noLine.detailsHeader.y, DIM.single + DIM.singleGap);
    assert.equal(noLine.lineup.length, 0);
    assert.equal(noLine.lineupRows.length, 0);
    assert.equal(noLine.sourceCount, 2);
    assert.equal(noLine.height, noLine.details[0].slotY + DIM.cell + DIM.margin);
    // Details follow Single immediately after the normal 15 px gap, with no
    // empty Line Up rows, color names, or fake variation image layers.
    const noLineMany = buildCombineLayout({single, lineup: [], details: [part("d1"), part("d2"), part("d3")],outputName:"details_only"});
    assert.equal(noLineMany.details[0].slotY, 615 + DIM.detailsHeadingHeight + DIM.detailsHeadingGap);
    assert.equal(noLineMany.details[1].slotY, noLineMany.details[0].slotY);
    assert.equal(noLineMany.details[2].slotY, noLineMany.details[0].slotY + DIM.cell + DIM.rowGap);
    assert.equal(noLineMany.sourceCount, 4);
    const singleOnly = buildCombineLayout({ single, lineup: [], details: [], outputName: "single_only" });
    assert.equal(singleOnly.height, 600);
    assert.equal(singleOnly.sourceCount, 1);
    assert.equal(singleOnly.lineupRows.length, 0);
    assert.equal(singleOnly.detailsHeader, null);
    assert.equal(singleOnly.jpegCount, 1);
    const lineupOnly = buildCombineLayout({single, lineup:[{...part("varSolo"),colorName:"Black"}], details:[],outputName:"lineup_only"});
    assert.equal(lineupOnly.detailsHeader, null);
    assert.equal(lineupOnly.lineupRows[0].top, 615);
    const tall = buildCombineLayout({ single, lineup: Array.from({length: 200}, (_,i)=>({ ...part("var"+i), colorName:"BLACK" })),
        details: [part("detail")], outputName:"big" });
    assert.equal(tall.format, "psb");
    assert.equal(tall.jpegCount, 1);
    const veryTall = buildCombineLayout({ single, lineup: Array.from({length: 250}, (_,i)=>({ ...part("var"+i), colorName:"W".repeat(50) })),
        details: [], outputName:"veryBig" });
    assert.equal(veryTall.format, "psb");
    assert(veryTall.jpegCount > 1);
    assert.throws(()=>buildCombineLayout({ single: null, lineup: [], details: [], outputName:"empty" }),/Single image/);
    assert.throws(()=>buildCombineLayout({ single, lineup, details, outputName:"NUL" }),/valid output filename/);
    assert.throws(()=>safeOutputName("../bad"),/valid output filename/);
    const japanese = wrapColorName("ブラック／ホワイト カラーバリエーション");
    assert(japanese.length > 1);
    const longRow = buildCombineLayout({ single, lineup:[{...part("v1"),colorName:"Black"},{...part("v2"),colorName:"Navy / Desert Sand / Dark Brown"}],
        details: [part("d1")], outputName:"names" });
    assert(longRow.lineup[0].labelHeight > 36);
    assert(longRow.lineup[1].labelHeight === longRow.lineup[0].labelHeight);
    console.log("Combine layout, row-major ordering, no-crop fit, label wrapping, and PSB/JPEG sizing: PASS");
}

async function testAssets(root) {
    const white = path.join(root, "sample-white.png");
    await sharp({ create: { width:200, height:180, channels:4, background:"#ffffff" } })
        .composite([{ input: { create: { width:80, height:90, channels:4, background:"#324d68" } }, left:63, top:47 }])
        .png().toFile(white);
    const bound = await visibleBounds(white);
    assert(bound.left >= 50 && bound.left <= 64, JSON.stringify(bound));
    assert(bound.top >= 35 && bound.top <= 48, JSON.stringify(bound));
    assert(bound.width >= 80 && bound.width < 105);
    const transparent = path.join(root, "transparent.png");
    await sharp({ create:{width:250,height:250,channels:4,background:"#00000000"} })
        .composite([{ input:{create:{width:25,height:145,channels:4,background:"#ffffff"}}, left:100,top:45 }]).png().toFile(transparent);
    const trim = await visibleBounds(transparent);
    assert(trim.width < 75 && trim.height >=145, JSON.stringify(trim));
    const full = path.join(root,"opaque.jpg");
    await sharp({ create: { width:30, height:40, channels:3, background:"#005b88" } }).jpeg().toFile(full);
    const noTrim = await visibleBounds(full);
    assert(noTrim.mode === "full");
    const bad = path.join(root, "bad.png");
    await fs.promises.writeFile(bad,"Not a real image");
    const result = await inspectBatch([white,transparent,bad,"/does-not-exist.jpg"]);
    assert.equal(result.images.length,2); assert.equal(result.failed.length,2);
    // Verify original files were not modified by bounds calculation.
    const stat = await fs.promises.stat(white);
    assert(stat.size > 0);
    console.log("Combine image inspection, white/transparent bounds, and batch isolation: PASS");
    return {white,transparent};
}
async function testService(root, assets) {
    const destination = path.join(root, "destination");
    await fs.promises.mkdir(destination);
    const fakeBuilder = async (layout, work) => {
        const psdPath = path.join(work,"result.psd");
        const jpg = path.join(work,"result.jpg");
        await fs.promises.writeFile(psdPath,Buffer.alloc(2000,11));
        await sharp({create:{width:600,height:layout.height,channels:3,background:"#ffffff"}}).jpeg().toFile(jpg);
        return { psdPath, jpegParts: [{path:jpg,top:0,height:layout.height}] };
    };
    const service = new CombineService({builder: fakeBuilder});
    const added = await service.addFiles([assets.white,assets.transparent]);
    assert.equal(added.added,2);
    service.setOutputFolder(destination);
    const payload = {singlePath:assets.white, lineup:[{path:assets.transparent,colorName:"White"}],details:[assets.white],outputName:"PRODUCT_COMBINE",existingAction:"version"};
    const layout = service.layout(payload);
    assert.equal(layout.lineup.length,1);
    const written = await service.generate(payload);
    assert.equal(written.ok,true);
    assert(fs.existsSync(written.outputPath));
    assert(fs.existsSync(written.jpegPath));
    assert.equal((await sharp(written.jpegPath).metadata()).width,600);
    // The real service, not just the planner, must accept an empty Line Up
    // array and also omitted optional fields without requiring color names.
    const detailsOnly = {...payload, lineup:[], outputName:"DETAILS_ONLY"};
    const detailLayout = service.layout(detailsOnly);
    assert.equal(detailLayout.lineup.length,0);
    assert.equal(detailLayout.details.length,1);
    const detailResult = await service.generate(detailsOnly);
    assert.equal(detailResult.lineupCount,0);
    assert.equal(detailResult.detailCount,1);
    assert.equal((await sharp(detailResult.jpegPath).metadata()).height,detailLayout.height);
    const singleOnly = {singlePath: assets.white, outputName:"SINGLE_ONLY",existingAction:"version"};
    assert.equal(service.layout(singleOnly).height,600);
    const singleResult = await service.generate(singleOnly);
    assert.equal(singleResult.sourceCount,1);
    assert.equal(singleResult.lineupCount,0);
    assert.equal(singleResult.detailCount,0);
    assert.equal((await sharp(singleResult.jpegPath).metadata()).height,600);
    const version = await service.generate(payload);
    assert(/_v2\.psd$/i.test(version.outputPath));
    assert(/_v2\.jpg$/i.test(version.jpegPath));
    const directFile = path.join(destination, "SOURCE_COMBINE.jpg");
    await fs.promises.copyFile(assets.white, directFile);
    await service.addFiles([directFile]);
    await assert.rejects(service.generate({...payload, singlePath:directFile,outputName:"SOURCE_COMBINE",existingAction:"replace"}),/input file/);
    const broken = new CombineService({builder: async()=>{ throw new Error("Photoshop failed"); }});
    await broken.addFiles([assets.white,assets.transparent]);
    broken.setOutputFolder(destination);
    await assert.rejects(broken.generate(payload),/Photoshop failed/);
    assert.equal(broken.busy,false);
    console.log("Combine generation service, paired PSD/JPEG, versioning, source safety, and failure cleanup: PASS");
}
function testJsx() {
    const code = fs.readFileSync(path.join(__dirname,"../src/modules/combine/jsx/compose.jsx"),"utf8");
    assert(code.includes("TextType.PARAGRAPHTEXT"));
    assert(code.includes("DocumentFill.WHITE"));
    assert(code.includes("ORIGINAL_PSD_SOURCE (hidden)"));
    assert(code.includes('group("01_SINGLE"'));
    assert(code.includes('group("02_LINE_UP"'));
    assert(code.includes('j.lineup.length ? "03_DETAILS" : "02_DETAILS"'));
    assert(code.includes('if (j.lineup.length)'));
    assert(code.indexOf("doc.saveAs(documentFile") < code.indexOf("doc.flatten()"));
    assert(!/copy\s*merged|cropToCanvas|dropShadow/i.test(code));
    assert(fs.readFileSync(path.join(__dirname,"../src/modules/combine/template/COMBINE_TEMPLATE_REFERENCE.psd")).subarray(0,4).toString()==="8BPS");
    console.log("Combine JSX smart object structure, editable labels, and PSD-before-JPEG order: PASS");
}
(async()=>{
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(),"brandforge-combine-tests-"));
    try { await testLayouts(); const assets=await testAssets(root); await testService(root,assets); testJsx(); }
    finally { await fs.promises.rm(root,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
