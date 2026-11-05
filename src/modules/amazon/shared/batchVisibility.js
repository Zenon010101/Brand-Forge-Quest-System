/* Amazon Batch Workspace presentation filters. No source or assignment mutation. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.BrandForgeBatchVisibility = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';
    const key = value => String(value || '').replace(/\\/g, '/').toLowerCase();

    function visibleGroups(groups, hideCompleted) {
        return groups.filter(group => !hideCompleted || !group.done);
    }

    function usedImageKeys(groups) {
        return new Set(groups.flatMap(group => (group.files || []).map(key)));
    }

    function visibleImages(files, groups, { hideAssigned = false, pickedKeys = [], matchesFile = () => true } = {}) {
        const used = hideAssigned ? usedImageKeys(groups) : null;
        const picked = new Set(Array.from(pickedKeys, key));
        return files.filter(file => matchesFile(file) && (!used || !used.has(key(file.path)) || picked.has(key(file.path))));
    }

    function nextPendingUid(groups, currentUid) {
        const idx = groups.findIndex(group => group.uid === currentUid);
        if (idx === -1) return groups.find(group => !group.done)?.uid ?? null;
        for (let i = 1; i <= groups.length; i++) {
            const group = groups[(idx + i) % groups.length];
            if (!group.done) return group.uid;
        }
        return null;
    }

    function completedCount(groups) { return groups.filter(group => group.done).length; }
    return { visibleGroups, usedImageKeys, visibleImages, nextPendingUid, completedCount };
});
