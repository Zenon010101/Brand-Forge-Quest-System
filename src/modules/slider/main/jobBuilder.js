const fs = require("fs");
const path = require("path");

function stripInteractiveStart(engineText) {
    return String(engineText)
        .replace(/^\uFEFF/, "")
        .replace(/^\s*#target\s+photoshop\s*/i, "")
        .replace(/\bmain\(\);\s*$/, "");
}

function buildJobScript(enginePath, job) {
    const engine = stripInteractiveStart(
        fs.readFileSync(enginePath, "utf8")
    );

    const jobLiteral = JSON.stringify(job);

    const runner = `

/* ============================================================
   ELECTRON JOB RUNNER
   ============================================================ */
(function () {
    var __job = ${jobLiteral};
    var __oldRulerUnits = app.preferences.rulerUnits;
    var __oldTypeUnits = app.preferences.typeUnits;
    var __oldInterpolation = null;
    var __oldDialogs = app.displayDialogs;
    var __builtDoc = null;
    var __success = false;

    function __entry(raw) {
        if (!raw || !raw.path) return null;

        var f = new File(raw.path);
        if (!f.exists) {
            throw new Error("Source file does not exist: " + raw.path);
        }

        return {
            file: f,
            name: raw.name || f.name,
            fsName: f.fsName,
            thumb: null,
            isCut: !!raw.isCut,
            hasShadow: !!raw.hasShadow
        };
    }

    function __lineup(raw) {
        raw = raw || {};
        return {
            photo1: __entry(raw.photo1),
            photo2: __entry(raw.photo2),
            photo3: __entry(raw.photo3),
            photo4: __entry(raw.photo4),
            shadow1: !!raw.shadow1,
            shadow2: !!raw.shadow2,
            shadow3: !!raw.shadow3,
            shadow4: !!raw.shadow4,
            variant1: raw.variant1 || "",
            variant2: raw.variant2 || "",
            variant3: raw.variant3 || "",
            variant4: raw.variant4 || ""
        };
    }

    try {
        app.displayDialogs = DialogModes.NO;
        app.preferences.rulerUnits = Units.PIXELS;
        app.preferences.typeUnits = TypeUnits.PIXELS;

        try {
            __oldInterpolation = app.preferences.interpolation;
            app.preferences.interpolation = ResampleMethod.BICUBICSHARPER;
        } catch (__ignoreInterpolation) {}

        var __state = {
            creative: [],
            detail: [],
            lineupRows: [],
            outputOrder: __job.outputOrder || [],
            layoutMode: __job.layoutMode || "horizontal"
        };

        var i;
        for (i = 0; i < (__job.creative || []).length; i++) {
            __state.creative.push(__entry(__job.creative[i]));
        }

        for (i = 0; i < (__job.detail || []).length; i++) {
            __state.detail.push(__entry(__job.detail[i]));
        }

        for (i = 0; i < (__job.lineupRows || []).length; i++) {
            __state.lineupRows.push(__lineup(__job.lineupRows[i]));
        }

        var __code = trimStr(__job.productCode || "");
        if (!__code) {
            throw new Error("Please enter a product code.");
        }

        if (__state.lineupRows.length > 0) {
            var __validation = validateLineups(
                collectLineupsData(__state.lineupRows),
                __state.layoutMode
            );

            if (!__validation.valid) {
                throw new Error(__validation.errors.join("\\n"));
            }
        }

        var __total = countTotalImages(__state);
        if (__total === 0) {
            throw new Error("Add at least one image (Creative, Lineup, or Detail).");
        }
        if (__total > MAX_TOTAL_IMAGES) {
            throw new Error(
                "Maximum " + MAX_TOTAL_IMAGES +
                " images total. Current total: " + __total + "."
            );
        }

        __builtDoc = buildUnifiedDocument(__state, __code);

        if (__job.outputPsdPath) {
            var __output = new File(__job.outputPsdPath);
            var __psdOptions = new PhotoshopSaveOptions();
            __psdOptions.layers = true;
            __psdOptions.embedColorProfile = true;

            __builtDoc.saveAs(
                __output,
                __psdOptions,
                false,
                Extension.LOWERCASE
            );
        }

        __success = true;
        __sliderWriteStatus("OK");
    } catch (__e) {
        var __message = "ERROR\\n" + String(
            __e && __e.message ? __e.message : __e
        );

        try {
            if (__e && __e.line) {
                __message += "\\nLine: " + __e.line;
            }
        } catch (__ignoreLine) {}

        __sliderWriteStatus(__message);
    } finally {
        if (!__success && __builtDoc) {
            try {
                __builtDoc.close(SaveOptions.DONOTSAVECHANGES);
            } catch (__ignoreClose) {}
        }

        try { cleanupGeneratedThumbs(); } catch (__ignoreThumbs) {}
        try { cleanupPreparedImageFiles(); } catch (__ignorePrepared) {}

        app.preferences.rulerUnits = __oldRulerUnits;
        app.preferences.typeUnits = __oldTypeUnits;
        app.displayDialogs = __oldDialogs;

        if (__oldInterpolation !== null) {
            try {
                app.preferences.interpolation = __oldInterpolation;
            } catch (__ignoreRestoreInterpolation) {}
        }
    }
})();
`;

    return engine + runner;
}

module.exports = {
    buildJobScript
};
