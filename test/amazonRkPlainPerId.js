'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { discoverProject, resolveSelections, verifyLinkedProject } = require('../src/modules/project-location/main/projectPaths');
const { findRkPlainFolder, withCreativeSecond, exportRkPlain } = require('../src/modules/amazon/main/amazonExtras');
const { validateVirtualBatch } = require('../src/modules/amazon/main/batchWorkspace');
const read = p => fs.readFileSync(p);
const makeDir = p => fs.mkdirSync(p, {recursive:true});

async function run() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-rkplain-1758-'));
  const brand = path.join(temp, 'Shared drives', 'Design Team - Single and Six 2026', '11. NOVEMBER', 'CLARKS #QLT244');
  const output = path.join(brand, 'SLIDER', 'AMAZON [single and slider]');
  const plain = path.join(brand, 'SINGLE', 'RAKUEN', '!!RAK PLAIN!!');
  const slider = path.join(brand, 'SLIDER', 'SLIDER-IMAGES', 'psd');
  const cb = path.join(brand, 'COLORBOX');
  const raw = path.join(temp, 'D-RAW');
  const markers = [
    path.join(output, 'Amazon Template.psd'), path.join(plain, 'PLAIN.psd'),
    path.join(slider, 'Slider Template.psd'), path.join(cb, 'Colorbox Template.psd')
  ];
  try {
    for (const dir of [output, plain, slider, cb, raw]) makeDir(dir);
    markers.forEach((p, i) => fs.writeFileSync(p, `BRANDMARKER_${i}`));
    fs.writeFileSync(path.join(plain, 'unrelated.psd'), 'not a marker');
    const before = markers.map(read);
    const scanned = discoverProject(brand);
    for (const role of ['amazon','slider','colorbox','rkplain']) {
      assert.strictEqual(scanned.roles[role].status, 'ready', `${role} must be auto-detected`);
    }
    assert.strictEqual(scanned.roles.rkplain.selectedMarker, markers[1]);
    assert.strictEqual(findRkPlainFolder(brand), fs.realpathSync(plain));
    const linked = resolveSelections(brand, Object.fromEntries(Object.entries(scanned.roles)
       .map(([role, info]) => [role, info.selectedMarker || ''])));
    assert.deepStrictEqual(verifyLinkedProject(linked), linked);
    // Existing links already saved in v1.7.57 gain the new role automatically.
    const legacy = {...linked, roles: {...linked.roles}};
    delete legacy.roles.rkplain;
    assert.strictEqual(verifyLinkedProject(legacy).roles.rkplain.folderPath, plain);
    const firstFile = path.join(raw, 'chosen-main.png');
    const secondFile = path.join(raw, 'original-second.png');
    const creative = path.join(raw, 'shared-creative.png');
    for (const [p, color] of [[firstFile, '#ED0000'], [secondFile, '#0000EB'], [creative, '#00E000']]) {
      await sharp({create:{width:360,height:360,channels:3,background:color}}).png().toFile(p);
    }
    // The explicit Main is not the first entry. The adapter must still put it first.
    const groups = [{id:'QLT-244', files:[{path:secondFile},{path:firstFile}], mainPath:firstFile,
       sharedIds:['QLT-244-SHARED']}];
    const checked = await validateVirtualBatch({groups,outputFolder:output});
    assert(checked.ok, checked.errors.join('; '));
    assert.deepStrictEqual(checked.parents[0].variants[0].files.map(f => f.path), [firstFile,secondFile]);
    const invalid = await validateVirtualBatch({groups:[{...groups[0],mainPath:path.join(raw,'unknown.png')}],outputFolder:output});
    assert(!invalid.ok && /Main Image #1/.test(invalid.errors.join('; ')));
    const planned = await withCreativeSecond(checked.parents, creative);
    assert.deepStrictEqual(planned[0].variants[0].files.map(f=>f.path), [firstFile,creative,secondFile]);
    // Confirm the main can still be changed server-side for Folder Mode inputs.
    const unordered = [{id:'Folder',variants:[{id:'QLT-244',mainPath:firstFile,
      files:[{path:secondFile},{path:firstFile}],sharedIds:[]}]}];
    const normalized = await withCreativeSecond(unordered, '');
    assert.deepStrictEqual(normalized[0].variants[0].files.map(f=>f.path), [firstFile,secondFile]);

    const psdBuilderId = require.resolve('../src/modules/amazon/main/psdBuilder');
    const sharingId = require.resolve('../src/modules/amazon/main/sharedJob');
    require(psdBuilderId);
    const saved = require.cache[psdBuilderId].exports;
    require.cache[psdBuilderId].exports = {buildAmazonPsd: async (_name, parents, dest) => {
      assert.deepStrictEqual(parents[0].variants[0].layers.map(x=>x.layerName),
          ['QLT-244','QLT-244_2','QLT-244_3']);
      fs.writeFileSync(dest, 'GENERATED MOCK MASTER PSD');
    }};
    delete require.cache[sharingId];
    try {
      const shared = require(sharingId);
      const request = { parents:planned, outputFolder:output };
      const name = {fileName:'TEST_MASTER.psd',baseName:'TEST_MASTER'};
      const inspection = await shared.inspectSharingRequest(request,name);
      assert(inspection.ok,inspection.errors?.join('; '));
      const result = await shared.processSharedAmazonJob({senderFrame:{send() {}}},
        {...request,confirmedExistingFiles:[]},name,inspection);
      assert(result.ok && result.successful===2 && result.failed===0);
      assert.strictEqual(result.results.length,2);
      const items = result.results.filter(x=>x.ok && x.jpgs[0]).map(x=>({id:x.variantId,jpg:x.jpgs[0]}));
      assert.deepStrictEqual(items.map(x=>x.id),['QLT-244','QLT-244-SHARED']);
      const exported = await exportRkPlain(items,linked.roles.rkplain.folderPath,[],
        [firstFile,secondFile,creative,...result.results.flatMap(x=>x.jpgs)]);
      assert(exported.ok && exported.saved.length===2);
      for (const item of items) {
        const destination = path.join(plain,`${item.id.toLowerCase()}plain.jpg`);
        assert.deepStrictEqual(read(destination),read(item.jpg),`${item.id} RK Plain must match Amazon Image #1`);
        assert((await sharp(destination).metadata()).width===1001);
        const amazonSecond = path.join(output,`${item.id}_2.jpg`);
        assert(!read(destination).equals(read(amazonSecond)), 'Main must never accidentally become Creative Image #2');
      }
      markers.forEach((p,i)=>assert.deepStrictEqual(read(p),before[i]));
      console.log('PASS linked G: CLARKS/Rakuen RK Plain, explicit Main ID, shared IDs, Creative #2, untouched PSD templates.');
    } finally {
      require.cache[psdBuilderId].exports = saved;
      delete require.cache[sharingId];
    }
    // Competing real folders must be an explicit human choice, not a guess.
    const alternate = path.join(brand,'SINGLE','RAKUTEN','!!RAK PLAIN!!');
    makeDir(alternate);
    fs.writeFileSync(path.join(alternate,'PLAIN.psd'),'ALTERNATE');
    assert.strictEqual(discoverProject(brand).roles.rkplain.status,'ambiguous');
    assert.strictEqual(findRkPlainFolder(brand),null);
    console.log('PASS multiple RK Plain marker folders require manual selection.');
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
}
run().catch(err=>{console.error(err);process.exitCode=1});
