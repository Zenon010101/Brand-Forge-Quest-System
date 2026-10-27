#target photoshop
// SOURCE_DATA and OUTPUT_FILE injected by the isolated Windows bridge.
// All documents are created from temporary normalized PNGs; originals remain untouched.
(function () {
    var info = LP_DATA;
    var result = new File(LP_OUTPUT);
    var document = null;
    function scalar(value) { return UnitValue(Number(value), "px"); }
    function safeClose(doc) {
        if (doc) try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (ignore) {}
    }
    function importRaster(filePath, folder, name, left, top, visible) {
        var source = null;
        try {
            // Inputs are normalized/cropped single-layer PNGs created by Sharp.
            // Duplicate their actual raster layer between documents instead of
            // using Copy Merged. Copy Merged can be unavailable when Photoshop
            // is launched through COM / runs without a foreground clipboard.
            source = app.open(new File(filePath));
            app.activeDocument = source;
            if (!source.activeLayer || !source.artLayers.length) {
                throw new Error("PNG does not contain a raster layer");
            }
            var layer = source.activeLayer.duplicate(document, ElementPlacement.INSIDE);
            app.activeDocument = document;
            layer.name = name;
            layer.move(folder, ElementPlacement.INSIDE);
            // Cross-document duplication can retain or offset layer coordinates
            // depending on Photoshop version and source dimensions. Always
            // anchor the visible bounds at the requested LP position.
            var x = Number(layer.bounds[0].as("px"));
            var y = Number(layer.bounds[1].as("px"));
            layer.translate(scalar(left - x), scalar(top - y));
            layer.visible = visible !== false;
            return layer;
        } catch (importError) {
            throw new Error("Cannot import " + name + " from " + filePath + ": " +
                String(importError && importError.message ? importError.message : importError));
        } finally {
            safeClose(source);
            if (document) app.activeDocument = document;
        }
    }
    function addText(text, folder, review, fontLatin, fontJapanese, yOffset) {
        var layer = document.artLayers.add();
        layer.name = String(text.name || "TEXT");
        layer.kind = LayerKind.TEXT;
        var item = layer.textItem;
        item.kind = TextType.POINTTEXT;
        item.contents = String(text.text || "");
        var fontSize = Math.max(8, Math.min(150, Number(text.fontSize || Math.round(text.height * 0.95))));
        item.size = scalar(fontSize);
        item.position = [scalar(text.x), scalar(yOffset + text.y + Math.max(1, Number(text.height) * 0.88))];
        item.justification = Justification.LEFT;
        try {
            var isJapanese = /[\u3000-\u9fff\uf900-\ufaff]/.test(item.contents);
            item.font = isJapanese ? fontJapanese : fontLatin;
        } catch (fontError) {
            // Keep the layer editable even if the requested font is unavailable.
        }
        var match = String(text.color || "#202020").match(/^#?([0-9a-f]{6})$/i);
        if (match) {
            var hex = match[1];
            var color = new SolidColor();
            color.rgb.red = parseInt(hex.substr(0, 2), 16);
            color.rgb.green = parseInt(hex.substr(2, 2), 16);
            color.rgb.blue = parseInt(hex.substr(4, 2), 16);
            item.color = color;
        }
        layer.move(folder, ElementPlacement.INSIDE);
        layer.visible = !review;
        return layer;
    }
    function namedGroup(parent, name) {
        var group = parent.layerSets.add();
        group.name = name;
        return group;
    }
    try {
        document = app.documents.add(
            info.width, info.height, 72, String(info.code),
            NewDocumentMode.RGB, DocumentFill.TRANSPARENT
        );
        // Reverse creation order so the PSD Layers panel lists 01_SINGLE,
        // 02_LP_PART_01, 03_LP_PART_02 in reading order top to bottom.
        for (var p = info.parts.length - 1; p >= 0; p--) {
            var part = info.parts[p];
            var group = namedGroup(document, part.group);
            var background = namedGroup(group, "BACKGROUND");
            var images = namedGroup(group, "IMAGES");
            var editable = namedGroup(group, "TEXT");
            var review = namedGroup(group, "OCR_REVIEW (hidden)");
            review.visible = false;
            importRaster(part.normalizedPath, background, "ORIGINAL_REFERENCE (hidden)", 0, part.y, false);
            importRaster(part.basePath, background, "BG_RASTER_FALLBACK", 0, part.y, true);
            var arr = part.images || [];
            for (var i = 0; i < arr.length; i++) {
                importRaster(arr[i].file, images, arr[i].name, arr[i].left, part.y + arr[i].top, true);
            }
            var txt = part.text || [];
            for (var k = 0; k < txt.length; k++) {
                // Individual failed text layers must not discard the whole LP.
                try {
                    addText(txt[k], txt[k].editable ? editable : review,
                        !txt[k].editable, info.fontLatin, info.fontJapanese, part.y);
                } catch (textError) {
                    // Original reference and BG already preserve visual content.
                }
            }
        }
        var singleGroup = namedGroup(document, "01_SINGLE");
        importRaster(info.singlePath, singleGroup,
            info.hasSingle ? "Single" : "PLACE_SINGLE_HERE (1000x1000)", 0, 0, true);
        // Keep visual content visible; Photoshop may inherit hidden group states.
        singleGroup.visible = true;
        var saveOpts;
        if (info.format === "psb") {
            saveOpts = new LargeDocumentFormatSaveOptions();
        } else {
            saveOpts = new PhotoshopSaveOptions();
        }
        saveOpts.layers = true;
        try { saveOpts.embedColorProfile = true; } catch (ignoreColor) {}
        try { saveOpts.maximizeCompatibility = true; } catch (ignoreCompat) {}
        document.saveAs(result, saveOpts, true, Extension.LOWERCASE);
    } finally {
        safeClose(document);
    }
})();
