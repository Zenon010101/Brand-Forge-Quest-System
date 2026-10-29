/* Amazon Batch Workspace Share Images modal validation.
 * Uses the original sharing plan/filename rules; no new rendering rules. */
(function (root, factory) {
    'use strict';
    const rules = (typeof module === 'object' && module.exports)
        ? require('./sharingPlan') : root?.AmazonSharing;
    const api = factory(rules);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root && typeof root === 'object') root.BrandForgeBatchSharingEditor = api;
})(typeof window !== 'undefined' ? window : null, function (sharing) {
    'use strict';
    function preview(groups, targetUid, rawIds) {
        if (!Array.isArray(groups) || !sharing) throw new Error('Sharing rules are unavailable.');
        const target = groups.find(g => g.uid === targetUid);
        if (!target) throw new Error('Select a source Product ID before sharing.');
        const ids = sharing.parseSharedIds(rawIds);
        const errors = [];
        const activeGroups = groups.filter(g => g === target || String(g.id || '').trim());
        // Use one placeholder for as-yet-unassigned groups. This allows users to
        // set up sharing before picking images while still detecting duplicate IDs.
        const variants = activeGroups.map(g => ({
            id: String(g.id || '').trim(),
            files: Array.from({ length: Math.max(1, g.files?.length || 0) }, () => ({})),
            sharedIds: g === target ? ids : [...(g.sharedIds || [])]
        }));
        const plan = sharing.buildSharingPlan([{ id: 'Batch Workspace', variants }]);
        errors.push(...plan.errors);
        const sourceCount = target.files?.length || 0;
        if (!sourceCount && ids.length) {
            // Not a validation error while planning. Export remains disabled
            // until real source images have been assigned.
        }
        const lines = ids.slice(0, 8).map(id => sourceCount > 1
            ? `${sharing.outputName(id, 1)}  ...  ${sharing.outputName(id, sourceCount)}`
            : sharing.outputName(id, 1));
        if (ids.length > 8) lines.push(`... plus ${ids.length - 8} more shared IDs`);
        return {
            ok: errors.length === 0, errors, ids,
            sourceCount, sharedCount: ids.length,
            sharedJpgCount: ids.length * sourceCount,
            warning: !sourceCount && ids.length
                ? 'Assign 1–8 images to this Product ID before Generate Amazon.' : '',
            outputPreview: lines.length ? lines.join('\n')
                : 'No shared outputs. Only the source Product ID will be exported.'
        };
    }
    return Object.freeze({ preview });
});
