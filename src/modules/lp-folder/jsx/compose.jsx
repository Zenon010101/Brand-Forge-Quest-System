#target photoshop
// FOLDER_LP_JOB and FOLDER_LP_DEST are injected by the isolated Photoshop bridge.
// Save editable PSD/PSB first, then make high-quality JPEG(s) from the
// same full-resolution Photoshop composition. The PSD is never flattened.
// Every entry remains a separate embedded Smart Object. No clipboard commands,
// flattening, destructive changes to source files, or background removal.
(function () {
    var job = FOLDER_LP_JOB;
    var output = new File(FOLDER_LP_DEST);
    var doc = null;
    var oldUnits = app.preferences.rulerUnits;
    function px(v) { return new UnitValue(Number(v), "px"); }
    function sizeOf(layer) {
        var b = layer.bounds;
        return { left: Number(b[0].as("px")), top: Number(b[1].as("px")),
            width: Number(b[2].as("px")) - Number(b[0].as("px")),
            height: Number(b[3].as("px")) - Number(b[1].as("px")) };
    }
    function embeddedSmartObject(section, parent) {
        var src = new File(section.input);
        if (!src.exists) throw new Error("Missing source: " + section.name);
        app.activeDocument = doc;
        var descriptor = new ActionDescriptor();
        descriptor.putPath(charIDToTypeID("null"), src);
        descriptor.putEnumerated(charIDToTypeID("FTcs"), charIDToTypeID("QCSt"), charIDToTypeID("Qcsa"));
        // Photoshop Place Embedded creates a real Smart Object layer.
        executeAction(charIDToTypeID("Plc "), descriptor, DialogModes.NO);
        var layer = doc.activeLayer;
        if (!layer) throw new Error("Photoshop failed to place " + section.name);
        layer.name = String(section.layerName || section.name);
        layer.move(parent, ElementPlacement.INSIDE);
        var bounds = sizeOf(layer);
        if (bounds.width < 1 || bounds.height < 1) throw new Error("Empty placed image: " + section.name);
        var scaleX = 100 * Number(section.placedWidth) / bounds.width;
        var scaleY = 100 * Number(section.placedHeight) / bounds.height;
        // A placed source should preserve its intended aspect ratio. Photoshop
        // can sometimes auto-fit a large document on placement, so the
        // measured bounds (not assumed original pixels) determine the resize.
        if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) throw new Error("Invalid placed size: " + section.name);
        layer.resize(scaleX, scaleY, AnchorPosition.TOPLEFT);
        bounds = sizeOf(layer);
        layer.translate(px(Number(section.x) - bounds.left), px(Number(section.y) - bounds.top));
        layer.visible = true;
        return layer;
    }
    try {
        app.preferences.rulerUnits = Units.PIXELS;
        doc = app.documents.add(job.width, job.height, 72, String(job.baseName),
            NewDocumentMode.RGB, DocumentFill.TRANSPARENT);
        // Make named groups bottom to top, so the Layers panel reads in order.
        for (var i = job.sections.length - 1; i >= 0; i--) {
            var part = job.sections[i];
            var group = doc.layerSets.add();
            group.name = String(part.group);
            try { embeddedSmartObject(part, group); }
            catch (e) { throw new Error("Section " + (i + 1) + " (" + part.name + "): " + e.message); }
        }
        var singleGroup = doc.layerSets.add();
        singleGroup.name = "01_SINGLE";
        embeddedSmartObject(job.single, singleGroup);
        singleGroup.visible = true;
        var options = job.format === "psb" ? new LargeDocumentFormatSaveOptions() : new PhotoshopSaveOptions();
        options.layers = true;
        try { options.embedColorProfile = true; } catch(ignoreColor) {}
        try { options.maximizeCompatibility = true; } catch(ignoreCompatibility) {}
        doc.saveAs(output, options, true, Extension.LOWERCASE);

        // Changes below are made only in this temporary Photoshop document.
        // The saved PSD/PSB retains every separately editable Smart Object.
        // Photoshop's Flatten Image composites transparency against white,
        // giving the JPG the same complete LP image without alpha pixels.
        if (!job.jpegParts || !job.jpegParts.length) {
            throw new Error("JPEG export plan is missing.");
        }
        doc.flatten();
        var jpegOptions = new JPEGSaveOptions();
        jpegOptions.quality = 12;
        jpegOptions.embedColorProfile = true;
        jpegOptions.formatOptions = FormatOptions.STANDARDBASELINE;
        for (var j = 0; j < job.jpegParts.length; j++) {
            var jpeg = job.jpegParts[j];
            var jpgFile = new File(String(jpeg.path));
            if (job.jpegParts.length === 1) {
                doc.saveAs(jpgFile, jpegOptions, true, Extension.LOWERCASE);
            } else {
                // The JPEG format is limited to 65,535 px per dimension.
                // Long LPs are exported in contiguous <= 60,000 px slices.
                var slice = doc.duplicate(String(job.baseName) + "_JPG_" + (j + 1), false);
                try {
                    app.activeDocument = slice;
                    slice.crop([px(0), px(jpeg.top), px(job.width), px(jpeg.top + jpeg.height)]);
                    slice.saveAs(jpgFile, jpegOptions, true, Extension.LOWERCASE);
                } finally {
                    try { slice.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreSlice) {}
                    app.activeDocument = doc;
                }
            }
        }
    } finally {
        try { if (doc) doc.close(SaveOptions.DONOTSAVECHANGES); } catch(ignoreClose) {}
        app.preferences.rulerUnits = oldUnits;
    }
})();
