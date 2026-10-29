'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const rules = require('../src/modules/amazon/shared/batchSharingEditor');
const r = path.resolve(__dirname, '../src/modules/amazon/renderer');
const html = fs.readFileSync(path.join(r, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(r, 'batchWorkspace.js'), 'utf8');
const css = fs.readFileSync(path.join(r, 'style.css'), 'utf8');

const groups = [
    { uid: 101, id: 'APM-100', files: ['a', 'b', 'c', 'd'], sharedIds: [] },
    { uid: 102, id: 'APM-200', files: ['x','y'], sharedIds: ['APM-201'] },
];
const good = rules.preview(groups, 101, 'APM-101\nAPM-102');
assert(good.ok, good.errors.join('; '));
assert.deepStrictEqual(good.ids, ['APM-101','APM-102']);
assert.strictEqual(good.sharedJpgCount, 8);
assert(good.outputPreview.includes('APM-101.jpg  ...  APM-101_4.jpg'));
assert(good.outputPreview.includes('APM-102_4.jpg'));
assert(!rules.preview(groups,101,'APM-100').ok, 'source ID cannot be shared back to itself');
assert(!rules.preview(groups,101,'APM-200').ok, 'another source ID cannot be a shared ID');
assert(!rules.preview(groups,101,'APM-201').ok, 'existing sharing IDs cannot be reused');
assert(!rules.preview(groups,101,'APM-101\napm-101').ok, 'case-insensitive duplicates rejected');
assert(!rules.preview(groups,101,'CON').ok, 'reserved Windows names rejected');
assert(!rules.preview(groups,101,'APM-100_2').ok, 'output image numbering filename collision detected');
assert(!rules.preview(groups,101,Array.from({length:201},(_,i)=>`EXTRA-${i}`).join('\n')).ok,
    'maximum 200 shared IDs enforced');
assert(rules.preview(groups,101,'').ok && rules.preview(groups,101,'').sharedCount === 0,
    'clearing all sharing is an intentional valid action');
assert.deepStrictEqual(groups[0].sharedIds, [], 'preview must not mutate the source group');
const unassigned = rules.preview([{uid:42,id:'NEW-ID',files:[],sharedIds:[]}],42,'NEW-OTHER');
assert(unassigned.ok && unassigned.warning.includes('Assign 1–8'), 'can plan sharing before choosing images');
const incompleteOther = rules.preview([...groups, {uid:103,id:'',files:[],sharedIds:[]}],101,'APM-111');
assert(incompleteOther.ok, 'an empty unrelated group must not prevent sharing edits');

for (const id of ['batchShareImagesBtn','batchShareModalBackdrop','batchShareIdsInput','batchShareApplyBtn','batchShareCancelBtn','batchShareValidation','batchShareOutputPreview','batchSharedCount']) {
    assert(html.includes(`id="${id}"`), `missing Batch Share Images element ${id}`);
}
assert(html.includes('id="shareModalBackdrop"'), 'original Folder Mode sharing modal must remain');
assert(html.includes('../shared/batchSharingEditor.js'), 'shared modal validator must load before renderer');
assert(script.includes('openBatchShareModal(item.uid, shareButton)'), 'every group row needs its own Share action');
assert(script.includes('$("batchShareImagesBtn").addEventListener("click"'), 'selected group needs a prominent Share Images button');
assert(script.includes('item.sharedIds = [...result.ids]'), 'Apply updates actual virtual group sharedIds');
assert(script.includes('sharingEditor.preview(groups, item.uid,'), 'both validation and applying must use same rules');
assert(script.includes('sharedIds: [...item.sharedIds]'), 'Batch processing keeps shared IDs in the payload');
assert(script.includes('closeBatchShareModal();'), 'modal closes on mode switch');
assert(css.includes('.batch-group-share') && css.includes('.batch-share-toolbar'), 'Sharing controls should be visibly styled');
console.log('PASS Batch Share Images dedicated UI, multi-ID validation, linked IDs, filename conflicts, clear/remove, and original sharing preservation');
