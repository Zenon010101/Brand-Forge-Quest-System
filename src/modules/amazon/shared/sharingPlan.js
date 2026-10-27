/* Shared by the sandboxed Amazon renderer and Electron's main process.
 * Do not access the filesystem here: filename/ID rules must agree in both. */
(function (root, factory) {
    "use strict";
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root && typeof root === "object") root.AmazonSharing = api;
})(typeof window !== "undefined" ? window : null, function () {
    "use strict";

    const MAX_SHARED_IDS = 200;
    const MAX_ID_LENGTH = 150;
    const INVALID_WINDOWS = /[<>:"/\\|?*\x00-\x1f]/;
    const RESERVED_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

    function parseSharedIds(value) {
        return String(value || "")
            .split(/[\r\n,;\t]+/)
            .map(value => value.trim())
            .filter(Boolean);
    }

    function idKey(value) {
        return String(value || "").trim().normalize("NFC").toLowerCase();
    }

    function validId(value) {
        if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
            return "ID cannot be empty or contain leading/trailing spaces.";
        }
        if (value.length > MAX_ID_LENGTH) return `ID must be ${MAX_ID_LENGTH} characters or fewer.`;
        if (value === "." || value === ".." || /[. ]$/.test(value)) return "ID cannot end with a period or space.";
        if (INVALID_WINDOWS.test(value)) return 'ID contains a Windows filename character: < > : " / \\ | ? * or a control character.';
        if (RESERVED_WINDOWS.test(value)) return "ID is a reserved Windows device filename.";
        return null;
    }

    function outputName(id, position) {
        return `${id}${position === 1 ? "" : `_${position}`}.jpg`;
    }

    function buildSharingPlan(parents, options = {}) {
        const errors = [];
        const reservations = new Set((options.reservedVariantIds || []).map(idKey).filter(Boolean));
        const claimedIds = new Map();
        const claimedFiles = new Map();
        const jobs = [];
        let sourceCount = 0;
        let sharedCount = 0;
        let jpgCount = 0;

        function error(message) {
            if (!errors.includes(message)) errors.push(message);
        }
        for (const parent of Array.isArray(parents) ? parents : []) {
            const parentId = String(parent?.id || "").trim() || "Amazon";
            for (const variant of Array.isArray(parent?.variants) ? parent.variants : []) {
                const id = String(variant?.id ?? "");
                const files = Array.isArray(variant?.files) ? variant.files : [];
                const sharedIds = Array.isArray(variant?.sharedIds) ? variant.sharedIds : [];
                if (sharedIds.length > MAX_SHARED_IDS) {
                    error(`${id || parentId}: maximum ${MAX_SHARED_IDS} shared IDs per source.`);
                }
                if (!files.length && sharedIds.length) {
                    error(`${id || parentId}: select source images before sharing.`);
                }
                if (!files.length) continue;
                if (files.length > 8) error(`${id}: maximum 8 selected images.`);
                sourceCount++;
                jobs.push({ parentId, variantId: id, role: "source", imageCount: files.length });
                for (const shareId of sharedIds) {
                    if (typeof shareId !== "string") {
                        error(`${id}: shared ID must be text.`);
                        continue;
                    }
                    sharedCount++;
                    jobs.push({ parentId, variantId: shareId, sourceId: id, role: "shared", imageCount: files.length });
                }
            }
        }
        const actualSources = new Set(jobs.filter(job => job.role === "source").map(job => idKey(job.variantId)));
        for (const job of jobs) {
            const id = job.variantId;
            const reason = validId(id);
            if (reason) {
                error(`${id || "(empty)"}: ${reason}`);
                continue;
            }
            const key = idKey(id);
            const origin = job.role === "shared" ? `shared from ${job.sourceId}` : "source folder";
            if (claimedIds.has(key)) {
                error(`Duplicate Variant ID "${id}" (${origin}); already used by ${claimedIds.get(key)}.`);
            } else {
                claimedIds.set(key, `${job.parentId} / ${job.variantId}`);
            }
            if (job.role === "shared" && (reservations.has(key) || actualSources.has(key))) {
                error(`Shared ID "${id}" already exists as a physical Variant ID folder. Choose a different ID.`);
            }
            for (let position = 1; position <= job.imageCount; position++) {
                const fileName = outputName(id, position);
                const fileKey = idKey(fileName);
                const previous = claimedFiles.get(fileKey);
                if (previous) {
                    error(`Filename collision: ${fileName} from ${job.variantId} image ${position} conflicts with ${previous.description}.`);
                } else {
                    claimedFiles.set(fileKey, { description: `${job.variantId} image ${position}`, fileName });
                }
                jpgCount++;
            }
        }
        return {
            ok: errors.length === 0,
            errors,
            sourceCount,
            sharedCount,
            totalVariants: sourceCount + sharedCount,
            jpgCount,
            jobs,
            outputFiles: Array.from(claimedFiles.values(), item => item.fileName)
        };
    }

    return { MAX_SHARED_IDS, MAX_ID_LENGTH, parseSharedIds, validId, idKey, outputName, buildSharingPlan };
});
