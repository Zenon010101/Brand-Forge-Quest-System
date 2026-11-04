#target photoshop
// Build a new layered document from the measured Combine template geometry.
// The original !COMBINE_TEMPLATE.psd is a non-destructive reference only.
// No gray placement guides are included in the exported files.
(function () {
    var j = COMBINE_JOB;
    var doc = null;
    var units = app.preferences.rulerUnits;
    function px(n) { return new UnitValue(Number(n), "px"); }
    function box(layer) {
        var b = layer.bounds;
        return { x: Number(b[0].as("px")), y: Number(b[1].as("px")),
            w: Number(b[2].as("px")) - Number(b[0].as("px")),
            h: Number(b[3].as("px")) - Number(b[1].as("px")) };
    }
    function group(name, parent) {
        var g = parent.layerSets.add(); g.name = name; return g;
    }
    function place(fileName, parent, label, dest, hidden) {
        var source = new File(fileName);
        if (!source.exists) throw new Error("Missing image: " + source.fsName);
        app.activeDocument = doc;
        var action = new ActionDescriptor();
        action.putPath(charIDToTypeID("null"), source);
        action.putEnumerated(charIDToTypeID("FTcs"), charIDToTypeID("QCSt"), charIDToTypeID("Qcsa"));
        executeAction(charIDToTypeID("Plc "), action, DialogModes.NO);
        var layer = doc.activeLayer;
        if (!layer) throw new Error("Place Embedded returned no layer: " + label);
        layer.name = label;
        layer.move(parent, ElementPlacement.INSIDE);
        if (dest) {
            var b = box(layer);
            if (b.w < 0.5 || b.h < 0.5) throw new Error("Image is empty: " + label);
            // Use one uniform percentage, never independent X/Y transforms.
            // Photoshop may place a file at its own DPI, so correct it without
            // changing the source's aspect ratio.
            var factor = Math.min(Number(dest.placedWidth) / b.w,
                Number(dest.placedHeight) / b.h);
            layer.resize(100 * factor, 100 * factor, AnchorPosition.TOPLEFT);
            b = box(layer);
            layer.translate(px(Number(dest.slotX) + (Number(dest.slotWidth) - b.w) / 2 - b.x),
                px(Number(dest.slotY) + (Number(dest.slotHeight) - b.h) / 2 - b.y));
        }
        layer.visible = !hidden;
        return layer;
    }
    function colorText(text, parent, rect, fontSize, name, wrapped) {
        var layer = doc.artLayers.add();
        layer.name = name;
        layer.kind = LayerKind.TEXT;
        var t = layer.textItem;
        var value = String(text);
        t.contents = value;
        t.size = px(fontSize);
        t.justification = wrapped ? Justification.CENTER : Justification.LEFT;
        try { t.font = /[\u3000-\uffff]/.test(value) ? "YuGothic-Regular" : "ArialMT"; }
        catch (ignoreFont) { /* use Photoshop's installed fallback font */ }
        var ink = new SolidColor(); ink.rgb.red = 30; ink.rgb.green = 30; ink.rgb.blue = 30;
        t.color = ink;
        if (wrapped) {
            try {
                t.kind = TextType.PARAGRAPHTEXT;
                t.position = [px(rect.x), px(rect.y)];
                t.width = px(rect.width);
                t.height = px(rect.height);
                try { t.leading = px(36); } catch (ignoreLeading) {}
                t.contents = value;
            } catch (paragraphUnsupported) {
                // Older Photoshop versions can reject paragraph box resizing.
                // Fall back to an EDITABLE centered point-text layer.
                t.kind = TextType.POINTTEXT;
                t.justification = Justification.CENTER;
                t.contents = value;
                t.position = [px(rect.x + rect.width / 2), px(rect.y + fontSize)];
            }
        } else {
            t.kind = TextType.POINTTEXT;
            t.position = [px(rect.x), px(rect.y + fontSize)];
        }
        layer.move(parent, ElementPlacement.INSIDE);
        layer.visible = true;
        return layer;
    }
    function addEntry(entry, parent, name) {
        // The displayed file is a safely trimmed composite placed as an
        // editable Smart Object. For PSD/PSB inputs an additional hidden
        // embedded copy of the ORIGINAL Photoshop source preserves its layers.
        if (entry.originalPsd) place(entry.originalPsd, parent, "ORIGINAL_PSD_SOURCE (hidden)", null, true);
        return place(entry.input, parent, name, entry, false);
    }
    try {
        app.preferences.rulerUnits = Units.PIXELS;
        doc = app.documents.add(j.width, j.height, 72, j.name,
            NewDocumentMode.RGB, DocumentFill.WHITE);
        // Reverse group creation so the layers panel reads top-to-bottom in
        // human visual order: Single, Line Up, Details.
        if (j.details.length) {
            var details = group(j.lineup.length ? "03_DETAILS" : "02_DETAILS", doc);
            for (var d = j.details.length - 1; d >= 0; d--) {
                var part = j.details[d];
                var partGroup = group("DETAIL_" + (d + 1 < 10 ? "0" : "") + (d + 1), details);
                addEntry(part, partGroup, "Detail " + (d + 1) + " - " + part.name);
            }
            colorText("DETAILS", details,
                { x: j.detailsHeader.x, y: j.detailsHeader.y, width: j.width - 16,
                    height: j.detailsHeader.height }, j.detailsHeader.fontSize, "DETAILS_HEADING", false);
        }
        if (j.lineup.length) {
            var line = group("02_LINE_UP", doc);
            for (var i = j.lineup.length - 1; i >= 0; i--) {
                var variation = j.lineup[i];
                var slot = group("LINE_UP_" + (i + 1 < 10 ? "0" : "") + (i + 1), line);
                addEntry(variation, slot, "VARIATION_" + (i + 1) + " - " + variation.name);
                // A full-width dual image is ONE editable Smart Object with
                // two distinct 28 px editable labels (left / right).
                var labels = variation.labels || [{ side: "single",
                    lines: variation.labelLines, x: variation.labelX, y: variation.labelY,
                    width: variation.labelWidth, height: variation.labelHeight }];
                for (var l = 0; l < labels.length; l++) {
                    var caption = labels[l];
                    var suffix = labels.length === 2 ? (l === 0 ? "_LEFT" : "_RIGHT") : "";
                    colorText(caption.lines.join("\r"), slot,
                        { x: caption.x, y: caption.y, width: caption.width,
                            height: caption.height }, j.geometry.labelSize,
                        "COLOR_NAME_" + (i + 1) + suffix, true);
                }
            }
        }
        if (j.single) {
            var single = group("01_SINGLE", doc);
            addEntry(j.single, single, "SINGLE");
        }
        var documentFile = new File(COMBINE_DEST);
        var psdOpts = j.format === "psb" ? new LargeDocumentFormatSaveOptions() : new PhotoshopSaveOptions();
        psdOpts.layers = true;
        try { psdOpts.maximizeCompatibility = true; } catch (ignoreCompat) {}
        try { psdOpts.embedColorProfile = true; } catch (ignoreColor) {}
        doc.saveAs(documentFile, psdOpts, true, Extension.LOWERCASE);

        // JPEG is a derived flattened export. Saved PSD stays fully layered.
        doc.flatten();
        var jpeg = new JPEGSaveOptions();
        jpeg.quality = 12;
        jpeg.formatOptions = FormatOptions.STANDARDBASELINE;
        try { jpeg.embedColorProfile = true; } catch (ignoreJpegColor) {}
        for (var k = 0; k < j.jpegParts.length; k++) {
            var partJpg = j.jpegParts[k];
            var file = new File(String(partJpg.path));
            if (j.jpegParts.length === 1) {
                doc.saveAs(file, jpeg, true, Extension.LOWERCASE);
            } else {
                var slice = doc.duplicate(j.name + "_JPEG_" + (k + 1), false);
                try {
                    app.activeDocument = slice;
                    slice.crop([px(0), px(partJpg.top), px(j.width),
                        px(partJpg.top + partJpg.height)]);
                    slice.saveAs(file, jpeg, true, Extension.LOWERCASE);
                } finally {
                    try { slice.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreSlice) {}
                    app.activeDocument = doc;
                }
            }
        }
    } finally {
        try { if (doc) doc.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreClose) {}
        app.preferences.rulerUnits = units;
    }
})();
