#target photoshop
// Create throwaway preview PNGs from PSD/PSB sources. Never save originals.
(function () {
    var items = COMBINE_PREVIEWS;
    var source = null, working = null, closeOriginal = false;
    for (var k = 0; k < items.length; k++) {
        var p = items[k];
        source = null; working = null; closeOriginal = false;
        try {
            var file = new File(p.input);
            if (!file.exists) throw new Error("Missing PSD/PSB: " + p.input);
            for (var n = 0; n < app.documents.length; n++) {
                try { if (app.documents[n].fullName.fsName.toLowerCase() === file.fsName.toLowerCase()) { source = app.documents[n]; break; } }
                catch (ignoreName) {}
            }
            if (!source) { source = app.open(file); closeOriginal = true; }
            working = source.duplicate("BrandForge Combine composite preview " + k, false);
            app.activeDocument = working;
            working.flatten();
            working.saveAs(new File(p.output), new PNGSaveOptions(), true, Extension.LOWERCASE);
        } catch (err) {
            throw new Error("Cannot preview PSD " + file.name + ": " + err.message);
        } finally {
            try { if (working) working.close(SaveOptions.DONOTSAVECHANGES); } catch (a) {}
            try { if (source && closeOriginal) source.close(SaveOptions.DONOTSAVECHANGES); } catch (b) {}
        }
    }
})();
