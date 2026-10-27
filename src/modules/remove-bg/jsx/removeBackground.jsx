// Photoshop product cutout in a throwaway document.
// IMPORTANT: use Select Subject, NOT the Remove Background Quick Action. In
// Photoshop 2026 the latter can show "Couldn't find background to remove"
// even for normal product photographs. Select Subject can still fail when
// Photoshop's AI engine fails; in that case report the problem safely rather
// than delete approximate pixels or interrupt unrelated queued jobs.
var gwsOriginal = null;
var gwsWorking = null;
var gwsOpenedHere = false;
var gwsPreviousDoc = app.documents.length ? app.activeDocument : null;

function gwsFindOpenDocument(file) {
    for (var i = 0; i < app.documents.length; i++) {
        try {
            if (String(app.documents[i].fullName.fsName).toLowerCase() ===
                String(file.fsName).toLowerCase()) return app.documents[i];
        } catch (ignore) {}
    }
    return null;
}

function gwsHideEditableShadowLayers(container) {
    for (var i = 0; i < container.layers.length; i++) {
        var child = container.layers[i];
        if (String(child.name).replace(/^\s+|\s+$/g, "").toLowerCase() === "shadow") {
            child.visible = false;
        } else if (child.typename === "LayerSet") {
            gwsHideEditableShadowLayers(child);
        }
    }
}

function gwsLoadTransparency() {
    var d = new ActionDescriptor();
    var selected = new ActionReference();
    selected.putProperty(charIDToTypeID("Chnl"), charIDToTypeID("fsel"));
    d.putReference(charIDToTypeID("null"), selected);
    var alpha = new ActionReference();
    alpha.putEnumerated(charIDToTypeID("Chnl"), charIDToTypeID("Chnl"), charIDToTypeID("Trsp"));
    d.putReference(charIDToTypeID("T   "), alpha);
    executeAction(charIDToTypeID("setd"), d, DialogModes.NO);
}

function gwsSelectionBounds(doc) {
    try {
        var b = doc.selection.bounds;
        return [b[0].as("px"), b[1].as("px"), b[2].as("px"), b[3].as("px")];
    } catch (ignore) {
        return null;
    }
}

function gwsAlphaBounds(doc) {
    try {
        gwsLoadTransparency();
        return gwsSelectionBounds(doc);
    } finally {
        try { doc.selection.deselect(); } catch (ignoreDeselect) {}
    }
}

function gwsFullCanvas(bounds, width, height) {
    return bounds && bounds[0] <= 0.5 && bounds[1] <= 0.5 &&
        bounds[2] >= width - 0.5 && bounds[3] >= height - 0.5;
}

function gwsSelectSubject(doc) {
    try {
        var options = new ActionDescriptor();
        options.putBoolean(stringIDToTypeID("sampleAllLayers"), false);
        executeAction(stringIDToTypeID("autoCutout"), options, DialogModes.NO);
    } catch (error) {
        throw new Error("Photoshop could not detect the product with Select Subject. " +
            "Try Edit > Preferences > Image Processing > Select Subject and Remove Background > Cloud; " +
            "restart Photoshop, then retry. Original image was not changed. " +
            "Photoshop detail: " + String(error && error.message ? error.message : error));
    }
    var chosen = gwsSelectionBounds(doc);
    if (!chosen || chosen[2] <= chosen[0] || chosen[3] <= chosen[1]) {
        throw new Error("Photoshop returned an empty subject selection. " +
            "Try enabling Cloud in Photoshop > Edit > Preferences > Image Processing, then retry.");
    }
    if (gwsFullCanvas(chosen, doc.width.as("px"), doc.height.as("px"))) {
        throw new Error("Photoshop selected the entire canvas rather than the product. " +
            "No PNG was created; check subject contrast or Photoshop's Cloud processing mode.");
    }
}

try {
    var input = new File(GWS_SOURCE);
    if (!input.exists) throw new Error("Source image not found: " + GWS_SOURCE);
    gwsOriginal = gwsFindOpenDocument(input);
    if (!gwsOriginal) {
        gwsOriginal = app.open(input);
        gwsOpenedHere = true;
    }
    gwsWorking = gwsOriginal.duplicate("__GWS_REMOVE_BG_WORK__", false);
    app.activeDocument = gwsWorking;

    if (gwsWorking.mode !== DocumentMode.RGB) {
        gwsWorking.changeMode(ChangeMode.RGB);
    }
    if (gwsWorking.bitsPerChannel !== BitsPerChannelType.EIGHT) {
        gwsWorking.bitsPerChannel = BitsPerChannelType.EIGHT;
    }

    // Existing PSD/PSB shadow pixels must NEVER be included in the cutout.
    if (/\.ps[db]$/i.test(GWS_SOURCE)) {
        gwsHideEditableShadowLayers(gwsWorking);
    }

    // Flatten a throwaway visible composite to one genuine raster layer.
    // An empty helper makes a single-layer/group source mergeable.
    var helper = gwsWorking.artLayers.add();
    helper.name = "__GWS_COMPOSITE_HELPER__";
    gwsWorking.mergeVisibleLayers();
    var main = gwsWorking.activeLayer;
    if (!main || main.typename !== "ArtLayer") throw new Error("Could not composite visible source pixels.");
    try { if (main.isBackgroundLayer) main.isBackgroundLayer = false; } catch (ignoreBackground) {}
    for (var i = 0; i < gwsWorking.layers.length; i++) {
        if (gwsWorking.layers[i] !== main) {
            try { gwsWorking.layers[i].visible = false; } catch (ignoreVisibility) {}
        }
    }
    main.visible = true;
    gwsWorking.activeLayer = main;

    var w = gwsWorking.width.as("px");
    var h = gwsWorking.height.as("px");
    var existingAlpha = gwsAlphaBounds(gwsWorking);
    if (!existingAlpha) throw new Error("Source image contains no visible product pixels.");

    // Existing cutouts do not need to be re-segmented. For opaque photos use
    // Select Subject + inverse + clear. Unlike native removeBackground this
    // never asks Photoshop to infer which pixels form the "background".
    if (gwsFullCanvas(existingAlpha, w, h)) {
        gwsSelectSubject(gwsWorking);
        gwsWorking.activeLayer = main;
        // Only the temporary composite is modified, never the source photo.
        gwsWorking.selection.invert();
        gwsWorking.selection.clear();
        gwsWorking.selection.deselect();
    }

    var finalAlpha = gwsAlphaBounds(gwsWorking);
    if (!finalAlpha) throw new Error("Remove Background left an empty product.");
    if (gwsFullCanvas(finalAlpha, w, h)) {
        throw new Error("No transparent background was created. Try Cloud processing in Photoshop's Image Processing preferences.");
    }

    var pngOptions = new PNGSaveOptions();
    pngOptions.interlaced = false;
    gwsWorking.saveAs(new File(GWS_OUTPUT), pngOptions, true, Extension.LOWERCASE);
} finally {
    if (gwsWorking) {
        try { gwsWorking.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreCloseWorking) {}
    }
    if (gwsOriginal && gwsOpenedHere) {
        try { gwsOriginal.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreCloseOriginal) {}
    }
    if (gwsPreviousDoc) {
        try { app.activeDocument = gwsPreviousDoc; } catch (ignoreActivate) {}
    }
}
