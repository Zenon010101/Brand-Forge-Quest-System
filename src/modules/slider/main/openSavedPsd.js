"use strict";

const path = require("path");

// Runs only after the staged PSD has been published/verified at the real output
// path. The staging document is already closed by buildJobScript.
function buildOpenSavedPsdScript(outputPath) {
    if (typeof outputPath !== "string" || !(path.isAbsolute(outputPath) || path.win32.isAbsolute(outputPath)) ||
        path.extname(outputPath).toLowerCase() !== ".psd") {
        throw new Error("A valid saved Slider PSD path is required.");
    }
    return `
(function () {
    var __oldDialogs = app.displayDialogs;
    try {
        app.displayDialogs = DialogModes.NO;
        var __file = new File(${JSON.stringify(outputPath)});
        if (!__file.exists) throw new Error("Saved Slider PSD is missing: " + __file.fsName);

        // An earlier Slider PSD may already be open in Photoshop. Reload it
        // from disk if unchanged so the tab reflects the just-published file.
        // Never silently discard the designer's unsaved edits.
        for (var __i = app.documents.length - 1; __i >= 0; __i--) {
            var __doc = app.documents[__i];
            var __match = false;
            try { __match = String(__doc.fullName.fsName).toLowerCase() === String(__file.fsName).toLowerCase(); }
            catch (__notSaved) {}
            if (__match) {
                if (!__doc.saved) throw new Error("The saved Slider PSD is already open with unsaved edits. Save or close that tab, then open the updated PSD from the output folder.");
                __doc.close(SaveOptions.DONOTSAVECHANGES);
            }
        }
        var __opened = app.open(__file);
        if (!__opened) throw new Error("Photoshop could not open the published Slider PSD.");
        app.activeDocument = __opened;
        try { app.bringToFront(); } catch (__focusError) {}
        __sliderWriteStatus("OK");
    } catch (__error) {
        __sliderWriteStatus("ERROR\\n" + String(__error && __error.message ? __error.message : __error));
    } finally {
        app.displayDialogs = __oldDialogs;
    }
})();`;
}

module.exports = { buildOpenSavedPsdScript };
