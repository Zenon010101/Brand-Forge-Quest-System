// Exact Slider Maker createBottomContactShadow logic, generalized to the
// PNG's actual canvas dimensions instead of Slider's fixed 600 x 600 canvas.
// No Drop Shadow effects, oval shadows, full-object shadows or canvas bounds.
var gwsSourceDoc = null;
var gwsDoc = null;
var gwsOpenedHere = false;
var gwsPreviousDoc = app.documents.length ? app.activeDocument : null;

function gwsFindOpenPng(file) {
    for (var i = 0; i < app.documents.length; i++) {
        try {
            if (String(app.documents[i].fullName.fsName).toLowerCase() ===
                String(file.fsName).toLowerCase()) return app.documents[i];
        } catch (ignore) {}
    }
    return null;
}

function gwsLoadMainPixels() {
    var d = new ActionDescriptor();
    var channel = new ActionReference();
    channel.putProperty(charIDToTypeID("Chnl"), charIDToTypeID("fsel"));
    d.putReference(charIDToTypeID("null"), channel);
    var source = new ActionReference();
    source.putEnumerated(charIDToTypeID("Chnl"), charIDToTypeID("Chnl"), charIDToTypeID("Trsp"));
    d.putReference(charIDToTypeID("T   "), source);
    executeAction(charIDToTypeID("setd"), d, DialogModes.NO);
}

function gwsHasSelection(doc) {
    try { doc.selection.bounds; return true; }
    catch (ignore) { return false; }
}

try {
    var pngFile = new File(GWS_PNG);
    if (!pngFile.exists) throw new Error("Approved PNG no longer exists: " + GWS_PNG);
    gwsSourceDoc = gwsFindOpenPng(pngFile);
    if (!gwsSourceDoc) {
        gwsSourceDoc = app.open(pngFile);
        gwsOpenedHere = true;
    }
    gwsDoc = gwsSourceDoc.duplicate("__GWS_SHADOW_WORK__", false);
    app.activeDocument = gwsDoc;
    if (gwsDoc.mode !== DocumentMode.RGB) gwsDoc.changeMode(ChangeMode.RGB);
    if (gwsDoc.layers.length !== 1) throw new Error("Approved PNG must contain exactly one composite layer.");

    var main = gwsDoc.layers[0];
    try { if (main.isBackgroundLayer) main.isBackgroundLayer = false; } catch (ignoreBackground) {}
    gwsDoc.activeLayer = main;
    if (!(main.typename === "ArtLayer" && main.kind === LayerKind.SMARTOBJECT)) {
        executeAction(stringIDToTypeID("newPlacedLayer"), new ActionDescriptor(), DialogModes.NO);
        main = gwsDoc.activeLayer;
    }
    main.name = "Main";
    if (main.kind !== LayerKind.SMARTOBJECT) throw new Error("Main did not become a Smart Object.");

    // Read non-transparent item pixels, not the Smart Object's full canvas.
    gwsDoc.activeLayer = main;
    gwsLoadMainPixels();
    if (!gwsHasSelection(gwsDoc)) throw new Error("PNG contains no selectable product pixels.");
    var sb = gwsDoc.selection.bounds;
    var itemLeft = sb[0].as("px");
    var itemTop = sb[1].as("px");
    var itemRight = sb[2].as("px");
    var itemBottom = sb[3].as("px");
    var itemHeight = itemBottom - itemTop;
    if (itemHeight <= 0 || itemRight <= itemLeft) throw new Error("Invalid product alpha bounds.");

    // Slider shadow: intersect alpha with LOWER 50% of the visible product.
    var lowerTop = itemBottom - itemHeight * GWS_LOWER_RATIO;
    var cw = gwsDoc.width.as("px");
    var ch = gwsDoc.height.as("px");
    var l = Math.max(0, itemLeft - 2);
    var r = Math.min(cw, itemRight + 2);
    var t = Math.max(0, lowerTop);
    var b = Math.min(ch, itemBottom + 2);
    gwsDoc.selection.select([
        [new UnitValue(l, "px"), new UnitValue(t, "px")],
        [new UnitValue(r, "px"), new UnitValue(t, "px")],
        [new UnitValue(r, "px"), new UnitValue(b, "px")],
        [new UnitValue(l, "px"), new UnitValue(b, "px")]
    ], SelectionType.INTERSECT, 0, false);
    if (!gwsHasSelection(gwsDoc)) throw new Error("Lower-half visible product selection is empty.");

    var shadow = gwsDoc.artLayers.add();
    shadow.name = "Shadow";
    shadow.move(main, ElementPlacement.PLACEAFTER);
    gwsDoc.activeLayer = shadow;
    var black = new SolidColor();
    black.rgb.red = 0;
    black.rgb.green = 0;
    black.rgb.blue = 0;
    gwsDoc.selection.fill(black, ColorBlendMode.NORMAL, 100, false);
    gwsDoc.selection.deselect();
    shadow.translate(GWS_OFFSET_X, GWS_OFFSET_Y);
    shadow.applyGaussianBlur(GWS_BLUR);
    shadow.opacity = GWS_OPACITY;
    main.name = "Main";
    main.visible = true;
    shadow.name = "Shadow";
    shadow.visible = true;

    if (gwsDoc.layers.length !== 2 ||
        gwsDoc.layers[0].name !== "Main" ||
        gwsDoc.layers[1].name !== "Shadow" ||
        gwsDoc.layers[0].kind !== LayerKind.SMARTOBJECT ||
        gwsDoc.layers[1].typename !== "ArtLayer") {
        throw new Error("PSD must contain exactly Main (Smart Object) above Shadow (editable pixels).");
    }
    var options = new PhotoshopSaveOptions();
    options.layers = true;
    options.embedColorProfile = true;
    options.maximizeCompatibility = true;
    gwsDoc.saveAs(new File(GWS_PSD), options, true, Extension.LOWERCASE);
} finally {
    if (gwsDoc) {
        try { gwsDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreCloseWork) {}
    }
    if (gwsSourceDoc && gwsOpenedHere) {
        try { gwsSourceDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreCloseSource) {}
    }
    if (gwsPreviousDoc) {
        try { app.activeDocument = gwsPreviousDoc; } catch (ignoreActivate) {}
    }
}
