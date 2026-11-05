'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const visibility = require('../src/modules/amazon/shared/batchVisibility');

const images = [
    { path: 'G:\\Catalog\\Main-A.PNG', name: 'Main-A.PNG' },
    { path: 'G:\\Catalog\\Shared.jpg', name: 'Shared.jpg' },
    { path: 'G:\\Catalog\\B.png', name: 'B.png' },
    { path: 'G:\\Catalog\\C.jpg', name: 'C.jpg' }
];
const groups = [
    { uid: 1, id: 'ID-A', files: [images[0].path, images[1].path], sharedIds: ['ID-A-2'], done: false },
    { uid: 2, id: 'ID-B', files: [images[2].path, images[1].path], sharedIds: [], done: true },
    { uid: 3, id: 'ID-C', files: [], sharedIds: [], done: false }
];
assert.deepStrictEqual(visibility.visibleGroups(groups, true).map(g => g.id), ['ID-A', 'ID-C']);
assert.deepStrictEqual(visibility.visibleGroups(groups, false).map(g => g.id), ['ID-A', 'ID-B', 'ID-C']);
assert.strictEqual(visibility.completedCount(groups), 1);
assert.deepStrictEqual([...visibility.usedImageKeys(groups)].sort(),
    ['g:/catalog/main-a.png', 'g:/catalog/shared.jpg', 'g:/catalog/b.png'].sort());
assert.deepStrictEqual(visibility.visibleImages(images, groups, { hideAssigned: true }).map(x => x.name), ['C.jpg']);
assert.deepStrictEqual(visibility.visibleImages(images, groups, { hideAssigned: false }).map(x => x.name), images.map(x => x.name));
assert.deepStrictEqual(visibility.visibleImages(images, groups, {
    hideAssigned: true, pickedKeys: ['G:/CATALOG/SHARED.JPG']
}).map(x => x.name), ['Shared.jpg', 'C.jpg'], 'selected images must remain visible through filtering');
assert.deepStrictEqual(visibility.visibleImages(images, groups, {
    hideAssigned: true, matchesFile: f => f.name.endsWith('.png')
}).map(x => x.name), [], 'file type filter still applies');
assert.strictEqual(visibility.nextPendingUid(groups, 1), 3);
assert.strictEqual(visibility.nextPendingUid(groups, 3), 1, 'navigation wraps to next pending');
assert.strictEqual(visibility.nextPendingUid(groups.map(g => ({ ...g, done: true })), 3), null);
assert.strictEqual(visibility.nextPendingUid(groups, -1), 1);
// Neither presentation filter may mutate images, assigned sets, or completion statuses.
assert.deepStrictEqual(groups[0].files, [images[0].path, images[1].path]);
assert.strictEqual(groups[1].done, true);
const html = fs.readFileSync(path.resolve(__dirname, '../src/modules/amazon/renderer/index.html'), 'utf8');
const ui = fs.readFileSync(path.resolve(__dirname, '../src/modules/amazon/renderer/batchWorkspace.js'), 'utf8');
for (const id of ['batchHideCompletedIds','batchHideAssignedImages','batchCompletionCount','batchMarkDoneBtn','batchShowAllBtn','batchLibraryVisibilityCount']) {
    assert(html.includes(`id="${id}"`), `missing visibility control: ${id}`);
}
assert(html.includes('../shared/batchVisibility.js'), 'shared helper must load before renderer');
assert(ui.includes('activeUid = visibility.nextPendingUid(groups, item.uid)'), 'mark done navigates to next pending ID');
assert(ui.includes('groups.map(item => ({ id: item.id.trim(), files:'), 'Generate payload must keep ALL groups even if some are hidden');
console.log('PASS Amazon Batch Workspace: hide completed, hide assigned, preserve picks, show all, next pending, source integrity');
