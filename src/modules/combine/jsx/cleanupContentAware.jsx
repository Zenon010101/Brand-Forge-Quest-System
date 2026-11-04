#target photoshop
// Non-destructive content-aware cleanup. The input is a TEMPORARY normalized PNG
// copy; never open, write or save the downloaded original image.
(function () {
    var j = CLEANUP_JOB;
    var source = new File(j.input);
    if (!source.exists) throw new Error("Missing temporary cleanup input PNG.");
    var target = new File(j.output);
    var doc = null;
    var oldUnits = app.preferences.rulerUnits;
    try {
        app.preferences.rulerUnits = Units.PIXELS;
        doc = app.open(source);
        app.activeDocument = doc;
        if (doc.width.as("px") !== j.width || doc.height.as("px") !== j.height)
            throw new Error("Source dimensions differ from cleanup selection.");
        // Make the layer directly editable even if the opened PNG is treated
        // as Background by older versions of Photoshop.
        try { if (doc.activeLayer.isBackgroundLayer) doc.activeLayer.isBackgroundLayer = false; }
        catch (ignoreBackground) { /* content-aware fill below reports failure if locked */ }
        for (var i = 0; i < j.areas.length; i++) {
            var r = j.areas[i];
            var left = Number(r.x), top = Number(r.y);
            var right = left + Number(r.width), bottom = top + Number(r.height);
            doc.selection.select([[left, top], [right, top], [right, bottom], [left, bottom]],
                SelectionType.REPLACE, 0, false);
            var fill = new ActionDescriptor();
            fill.putEnumerated(charIDToTypeID("Usng"), charIDToTypeID("FlCn"), stringIDToTypeID("contentAware"));
            fill.putUnitDouble(charIDToTypeID("Opct"), charIDToTypeID("#Prc"), 100);
            fill.putEnumerated(charIDToTypeID("Md  "), charIDToTypeID("BlnM"), charIDToTypeID("Nrml"));
            executeAction(charIDToTypeID("Fl  "), fill, DialogModes.NO);
            doc.selection.deselect();
        }
        var pngOptions = new PNGSaveOptions();
        pngOptions.interlaced = false;
        doc.saveAs(target, pngOptions, true, Extension.LOWERCASE);
    } finally {
        if (doc) try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreClose) {}
        app.preferences.rulerUnits = oldUnits;
    }
})();
