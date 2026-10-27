
// ============================================================
// Unified PSD Generator — Creative + Lineup + Detail
//
// Combines the existing Lineup Generator (LineupAutomation.jsx +
// modules/layout.jsx + modules/validation.jsx + modules/psd-builder.jsx)
// with the existing SIX PSD Generator into one dialog and one
// build pipeline: Creative -> Lineup -> Detail.
//
// PSD structure:
//   1. Creative images  (full-canvas "fill" placement, SIX naming)
//   2. Lineup groups    (existing Lineup Generator grouping/placement)
//   3. Detail images    (full-canvas "fill" placement, SIX naming)
//
// Total images across all three sections is capped at 18.
// Smart Objects remain non-destructive during placement/cutting so source
// resolution is preserved inside the generated PSD.
//
// ------------------------------------------------------------
// INTERFACE OPTIMIZATION (this version):
// The previous dialog laid Creative / Lineup / Detail out as three
// fixed-width columns side by side (~1060px wide total) with several
// fixed-height panels stacked inside the Lineup column. On anything
// but a large, high-res monitor (or with Windows display scaling
// above 100%), that combination could render partially off-screen,
// since ScriptUI dialogs don't auto-scroll or clip gracefully.
//
// Fix applied here — UI STRUCTURE ONLY, no build/validation logic
// was changed:
//   1. Creative / Lineup / Detail are now TABS instead of three
//      squeezed columns, so each section gets the dialog's full
//      width and height instead of a third of it.
//   2. The dialog is resizable and its maximum size is capped to
//      the actual screen bounds, so it can never open larger than
//      the screen.
//   3. Redundant nested panel titles (a titled panel inside an
//      already-labeled tab) were removed to reclaim vertical space.
// ============================================================

var CANVAS_SIZE = 600;

// Creative / Detail safe image area inside the 600x600 slider canvas.
// Images must fit INSIDE this area and must never exceed these bounds.
var CREATIVE_DETAIL_LEFT = 15;
var CREATIVE_DETAIL_TOP = 20;
var CREATIVE_DETAIL_WIDTH = 570;
var CREATIVE_DETAIL_HEIGHT = 530;

// Detail CUT IMAGE mode: the visible image area is 600x550.
// Bottom 50px always stays white. Cut-side placement is based only on the
// actual visible pixels: left/right/top/bottom cuts are pushed to that edge.
var DETAIL_CUT_LEFT = 0;
var DETAIL_CUT_TOP = 0;
var DETAIL_CUT_WIDTH = 600;
var DETAIL_CUT_HEIGHT = 550;
var DETAIL_CUT_BOTTOM_WHITE = 50;

// PSD Main + Shadow correction: after the whole pair is sized/positioned,
// lift ONLY the source Shadow slightly so white fringe at the product edge
// is covered by Main. Main placement itself is never shifted by this rule.
var PSD_SHADOW_LIFT_PX = 4;

var MAX_TOTAL_IMAGES = 18;
// Let Photoshop decide which file types it can actually open.
// The picker is intentionally not limited to PNG/JPG/JPEG so files such as
// PSD, TIFF, BMP, GIF, WEBP, etc. can also be selected when supported by
// the installed Photoshop version.
var ACCEPTED_EXTENSIONS = [
    "jpg", "jpeg", "png", "webp", "avif", "gif", "bmp", "tif", "tiff",
    "psd", "psb", "heic", "heif", "tga", "eps", "pdf", "jpf", "jp2",
    "j2c", "j2k", "exr", "hdr", "dng", "raw", "cr2", "nef", "arw",
    "orf", "rw2", "raf", "pef", "srw", "x3f"
];


function main() {

    var originalRulerUnits = app.preferences.rulerUnits;
    var originalTypeUnits = app.preferences.typeUnits;
    var originalInterpolation = null;

    app.preferences.rulerUnits = Units.PIXELS;
    app.preferences.typeUnits = TypeUnits.PIXELS;

    // Keep Smart Object transforms as clean as possible when Photoshop
    // renders them down into the 600x600 slider document. This changes only
    // Photoshop's temporary interpolation preference; it is restored below.
    try {
        originalInterpolation = app.preferences.interpolation;
        app.preferences.interpolation = ResampleMethod.BICUBICSHARPER;
    } catch (interpolationErr) {
        // Older Photoshop versions may not expose this preference.
    }

    try {
        showUnifiedDialog();
    } finally {
        app.preferences.rulerUnits = originalRulerUnits;
        app.preferences.typeUnits = originalTypeUnits;

        if (originalInterpolation !== null) {
            try {
                app.preferences.interpolation = originalInterpolation;
            } catch (restoreInterpolationErr) {}
        }
    }
}


/* ============================================================
   LINEUP LAYOUT MATH
   (unchanged from your existing layout.jsx)
   ============================================================ */

// VERTICAL = stacked top-to-bottom standard lineup.
function computeLineupLayout(overrides) {

    overrides = overrides || {};

    var spec = {
        canvasWidth: 600,
        canvasHeight: 600,
        marginLeft: 17,
        marginRight: 17,
        marginTop: 20,
        variantAreaHeight: 50,
        middleSpacing: 20
    };

    for (var key in overrides) {
        if (overrides.hasOwnProperty(key)) {
            spec[key] = overrides[key];
        }
    }

    var contentWidth = spec.canvasWidth - spec.marginLeft - spec.marginRight;

    if (contentWidth <= 0) {
        throw new Error("Canvas too narrow for the configured margins.");
    }

    var fixedVertical =
        spec.marginTop +
        spec.variantAreaHeight +
        spec.middleSpacing +
        spec.variantAreaHeight;

    var photoSpace = spec.canvasHeight - fixedVertical;

    if (photoSpace <= 0) {
        throw new Error("Canvas too short for the Vertical (stacked) lineup.");
    }

    var photoHeight = photoSpace / 2;

    var x = spec.marginLeft;
    var y = spec.marginTop;

    var photo1 = { x: x, y: y, width: contentWidth, height: photoHeight };
    y += photoHeight;

    var variant1 = { x: x, y: y, width: contentWidth, height: spec.variantAreaHeight };
    y += spec.variantAreaHeight;

    y += spec.middleSpacing;

    var photo2 = { x: x, y: y, width: contentWidth, height: photoHeight };
    y += photoHeight;

    var variant2 = { x: x, y: y, width: contentWidth, height: spec.variantAreaHeight };
    y += spec.variantAreaHeight;

    if (Math.round(y) !== spec.canvasHeight) {
        throw new Error(
            "Vertical stacked layout calculation error: computed bottom is " +
            y + "px instead of " + spec.canvasHeight + "px."
        );
    }

    return {
        contentWidth: contentWidth,
        photo1: photo1,
        variant1: variant1,
        photo2: photo2,
        variant2: variant2
    };
}


// HORIZONTAL = side-by-side standard lineup.
function computeVerticalLineupLayout(overrides) {

    overrides = overrides || {};

    var spec = {
        canvasWidth: 600,
        canvasHeight: 600,
        marginLeft: 17,
        marginRight: 17,
        marginTop: 20,
        photoGap: 17,
        textAreaHeight: 50,
        marginBottom: 50
    };

    for (var key in overrides) {
        if (overrides.hasOwnProperty(key)) {
            spec[key] = overrides[key];
        }
    }

    var availableWidth = spec.canvasWidth - spec.marginLeft - spec.marginRight;
    var photoWidth = (availableWidth - spec.photoGap) / 2;

    if (photoWidth <= 0) {
        throw new Error("Canvas too narrow for the Horizontal (side-by-side) lineup.");
    }

    var photoHeight =
        spec.canvasHeight -
        spec.marginTop -
        spec.textAreaHeight -
        spec.marginBottom;

    if (photoHeight <= 0) {
        throw new Error("Canvas too short for the Horizontal (side-by-side) lineup.");
    }

    var photoY = spec.marginTop;

    var photo1 = { x: spec.marginLeft, y: photoY, width: photoWidth, height: photoHeight };

    var photo2 = {
        x: spec.marginLeft + photoWidth + spec.photoGap,
        y: photoY,
        width: photoWidth,
        height: photoHeight
    };

    var variant1 = {
        x: spec.marginLeft,
        y: photoY + photoHeight,
        width: photoWidth,
        height: spec.textAreaHeight
    };

    var variant2 = {
        x: spec.marginLeft + photoWidth + spec.photoGap,
        y: photoY + photoHeight,
        width: photoWidth,
        height: spec.textAreaHeight
    };

    var finalBottom =
        photoY + photoHeight + spec.textAreaHeight + spec.marginBottom;

    if (Math.round(finalBottom) !== spec.canvasHeight) {
        throw new Error(
            "Horizontal side-by-side layout calculation error: computed bottom is " +
            finalBottom + "px instead of " + spec.canvasHeight + "px."
        );
    }

    return {
        contentWidth: photoWidth,
        photo1: photo1,
        variant1: variant1,
        photo2: photo2,
        variant2: variant2
    };
}


// PA VERTICAL — production layout matching the supplied reference:
//   Item         571 x 280
//   Item Detail  571 x 250
//   Color Name   571 x  50
// The 20px top margin plus 580px of content fills the 600px canvas exactly.
function computePaVerticalLineupLayout() {
    return {
        item:      { x: 15, y: 20,  width: 571, height: 280 },
        detail:    { x: 15, y: 300, width: 571, height: 250 },
        colorName: { x: 15, y: 550, width: 571, height: 50 }
    };
}


function computeFourCutLayout(overrides) {

    overrides = overrides || {};

    var spec = {
        canvasWidth: 600,
        canvasHeight: 600,
        marginLeft: 17,
        marginRight: 17,
        marginTop: 20,
        columnGap: 17,
        rowGap: 20,
        textAreaHeight: 50
    };

    for (var key in overrides) {
        if (overrides.hasOwnProperty(key)) {
            spec[key] = overrides[key];
        }
    }

    var contentWidth = spec.canvasWidth - spec.marginLeft - spec.marginRight;
    var photoWidth = (contentWidth - spec.columnGap) / 2;

    var photoAreaHeight =
        (spec.canvasHeight - spec.marginTop - spec.rowGap - (spec.textAreaHeight * 2)) / 2;

    if (photoWidth <= 0) {
        throw new Error("Canvas too narrow for Four Cut layout.");
    }

    if (photoAreaHeight <= 0) {
        throw new Error("Canvas too short for Four Cut layout.");
    }

    var leftX = spec.marginLeft;
    var rightX = spec.marginLeft + photoWidth + spec.columnGap;
    var topY = spec.marginTop;
    var bottomY = spec.marginTop + photoAreaHeight + spec.textAreaHeight + spec.rowGap;

    var photo1 = { x: leftX, y: topY, width: photoWidth, height: photoAreaHeight };
    var photo2 = { x: rightX, y: topY, width: photoWidth, height: photoAreaHeight };

    var variant1 = { x: leftX, y: topY + photoAreaHeight, width: photoWidth, height: spec.textAreaHeight };
    var variant2 = { x: rightX, y: topY + photoAreaHeight, width: photoWidth, height: spec.textAreaHeight };

    var photo3 = { x: leftX, y: bottomY, width: photoWidth, height: photoAreaHeight };
    var photo4 = { x: rightX, y: bottomY, width: photoWidth, height: photoAreaHeight };

    var variant3 = { x: leftX, y: bottomY + photoAreaHeight, width: photoWidth, height: spec.textAreaHeight };
    var variant4 = { x: rightX, y: bottomY + photoAreaHeight, width: photoWidth, height: spec.textAreaHeight };

    return {
        contentWidth: contentWidth,
        photo1: photo1, variant1: variant1,
        photo2: photo2, variant2: variant2,
        photo3: photo3, variant3: variant3,
        photo4: photo4, variant4: variant4
    };
}


// Single copy — this used to be duplicated in layout.jsx AND psd-builder.jsx.
function fitImageInBox(imageSize, box) {

    if (imageSize.width <= 0 || imageSize.height <= 0) {
        throw new Error("Invalid image dimensions.");
    }

    var scale = Math.min(box.width / imageSize.width, box.height / imageSize.height);

    var scaledWidth = imageSize.width * scale;
    var scaledHeight = imageSize.height * scale;

    var x = box.x + (box.width - scaledWidth) / 2;
    var y = box.y + (box.height - scaledHeight) / 2;

    return { scale: scale, x: x, y: y, width: scaledWidth, height: scaledHeight };
}


/* ============================================================
   VALIDATION
   (unchanged from your existing validation.jsx)
   ============================================================ */

function trimStr(s) {
    return String(s).replace(/^\s+|\s+$/g, "");
}

function padLineupNumber(n) {
    var s = String(n);
    return s.length < 2 ? "0" + s : s;
}

function getExtension(filename) {
    if (!filename) return "";
    var parts = filename.split(".");
    if (parts.length < 2) return "";
    return parts[parts.length - 1].toLowerCase();
}

function isAcceptedFile(filename) {
    // Accept the common image/document formats Photoshop can work with,
    // including modern web formats such as AVIF and WebP.
    // Unknown extensions are still allowed because Photoshop may support
    // additional formats depending on the installed version/plugins.
    if (!filename) return false;
    var ext = getExtension(filename);
    if (!ext) return true;
    for (var i = 0; i < ACCEPTED_EXTENSIONS.length; i++) {
        if (ext === ACCEPTED_EXTENSIONS[i]) return true;
    }
    return true;
}

// NOTE: preserved exactly as in your existing validation.jsx.
// It only checks photo1/variant1/photo2/variant2 — it does NOT check
// photo3/photo4 even when Four Cut mode is active. That gap already
// existed in your Lineup Generator; it has not been changed here.
function validateLineups(lineups, layoutMode) {
    var errors = [];

    if (!lineups || lineups.length === 0) {
        errors.push("Add at least one lineup before creating the PSD.");
        return { valid: false, errors: errors };
    }

    for (var i = 0; i < lineups.length; i++) {
        var lineup = lineups[i];
        var label = "Lineup " + padLineupNumber(i + 1);

        // PA Vertical is a single composed card: Item + Item Detail + Color Name.
        // variant1 stores the single Color Name. variant2 is intentionally unused.
        if (layoutMode === "paVertical") {
            var hasItem = !!lineup.photo1;
            var hasDetail = !!lineup.photo2;
            var colorName = trimStr(lineup.variant1 || "");
            var hasAnyPa = hasItem || hasDetail || colorName !== "";

            if (!hasAnyPa) continue;
            if (!hasItem) errors.push(label + ": Item image is missing.");
            if (!hasDetail) errors.push(label + ": Item Detail image is missing.");
            if (colorName === "") errors.push(label + ": Color Name is empty.");

            if (hasItem && !isAcceptedFile(lineup.photo1.name)) {
                errors.push(label + ": Item image could not be recognized by Photoshop.");
            }
            if (hasDetail && !isAcceptedFile(lineup.photo2.name)) {
                errors.push(label + ": Item Detail image could not be recognized by Photoshop.");
            }

            if (hasItem && hasDetail && lineup.photo1.fsName && lineup.photo2.fsName &&
                String(lineup.photo1.fsName).toLowerCase() === String(lineup.photo2.fsName).toLowerCase()) {
                errors.push(label + ": Item and Item Detail use the same file. Please double check.");
            }
            continue;
        }

        var maxSlots = layoutMode === "fourCut" ? 4 : 2;

        for (var n = 1; n <= maxSlots; n++) {
            var photo = lineup["photo" + n];
            var variant = trimStr(lineup["variant" + n] || "");
            var hasPhoto = !!photo;
            var hasVariant = variant !== "";

            if (!hasPhoto && !hasVariant) continue;

            if (hasPhoto && !hasVariant) {
                errors.push(label + ": Variant Name " + n + " is empty for the selected photo.");
                continue;
            }

            if (!hasPhoto && hasVariant) {
                errors.push(label + ": Photo " + n + " has not been selected for Variant Name " + n + ".");
                continue;
            }

            if (!isAcceptedFile(photo.name)) {
                errors.push(label + ": Photo " + n + " (\"" + photo.name + "\") could not be recognized by Photoshop.");
            }
        }

        for (var a = 1; a <= maxSlots; a++) {
            var photoA = lineup["photo" + a];
            if (!photoA || !photoA.fsName) continue;

            for (var b = a + 1; b <= maxSlots; b++) {
                var photoB = lineup["photo" + b];
                if (!photoB || !photoB.fsName) continue;

                if (String(photoA.fsName).toLowerCase() === String(photoB.fsName).toLowerCase()) {
                    errors.push(label + ": Photo " + a + " and Photo " + b + " are the same file. Please double check.");
                }
            }
        }
    }

    return { valid: errors.length === 0, errors: errors };
}


/* ============================================================
   LINEUP PSD BUILDING
   (unchanged from your existing modules/psd-builder.jsx)
   ============================================================ */

// PSD/PSB MAIN + SHADOW IMPORT - ORIGINAL SHADOW, GROUP ONLY
// -------------------------------------------------------
// Import the named Main and Shadow as separate editable children in one group.
// Main is guaranteed to be a Smart Object before Slider placement so source
// quality is retained. Main + Shadow still receive one common size/position
// transform; after placement, Shadow alone is lifted a small fixed amount to
// cover white fringe at the product edge. No shadow resize/blur/opacity change.
// The existing slider layout transforms the WHOLE group using Main's bounds.
// Build the pair in a temporary source-sized document, then transfer it in ONE
// operation so both children use the same coordinate system.
var EDITABLE_PSD_IMPORTS = [];

function isPSDOrPSBSource(file) {
    return !!(file && file.name && /\.ps[db]$/i.test(file.name));
}

function cleanEditableSourceName(name) {
    return String(name || "").replace(/^\s+|\s+$/g, "").toLowerCase();
}

function findEditableSourceLayer(container, wantedName) {
    var wanted = cleanEditableSourceName(wantedName);

    for (var i = container.layers.length - 1; i >= 0; i--) {
        var layer = container.layers[i];

        if (cleanEditableSourceName(layer.name) === wanted) {
            return layer;
        }

        if (layer.typename === "LayerSet") {
            var nested = findEditableSourceLayer(layer, wantedName);
            if (nested) return nested;
        }
    }

    return null;
}

function moveItemInsideGroupSafe(item, targetGroup) {
    if (!item || !targetGroup) return;

    if (item.typename === "LayerSet") {
        var anchor = targetGroup.artLayers.add();
        anchor.name = "__SLIDER_GROUP_ANCHOR__";
        item.move(anchor, ElementPlacement.PLACEBEFORE);
        anchor.remove();
    } else {
        item.move(targetGroup, ElementPlacement.INSIDE);
    }
}

function moveItemToGroupTopSafe(item, targetGroup) {
    if (!item || !targetGroup) return;

    try {
        item.move(targetGroup, ElementPlacement.PLACEATBEGINNING);
        return;
    } catch (e0) {}

    try {
        if (targetGroup.layers.length > 0 && targetGroup.layers[0] !== item) {
            item.move(targetGroup.layers[0], ElementPlacement.PLACEBEFORE);
        }
    } catch (e1) {}
}

function rememberEditablePSDImport(info) {
    if (info && info.layer) EDITABLE_PSD_IMPORTS.push(info);
    return info;
}

function getEditableLayerDocument(layer) {
    var parent = layer;
    while (parent && parent.typename !== "Document") parent = parent.parent;
    return parent;
}

function sameEditableLayer(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    // Layer IDs are compared only inside the same document.
    try {
        if (typeof a.id === "undefined" || typeof b.id === "undefined" || a.id !== b.id) return false;
        var docA = getEditableLayerDocument(a);
        var docB = getEditableLayerDocument(b);
        if (!docA || !docB) return false;
        if (docA === docB) return true;
        return typeof docA.id !== "undefined" && typeof docB.id !== "undefined" && docA.id === docB.id;
    } catch (idError) {
        return false;
    }
}

function getEditablePSDImport(layer) {
    for (var i = EDITABLE_PSD_IMPORTS.length - 1; i >= 0; i--) {
        if (sameEditableLayer(EDITABLE_PSD_IMPORTS[i].layer, layer)) {
            return EDITABLE_PSD_IMPORTS[i];
        }
    }
    return null;
}

var SLIDER_PLACEMENT_SOURCES = [];
var SOURCE_VISIBLE_CONTENT_CACHE = {};

function rememberSliderPlacementSource(layer, sourceFile) {
    if (!layer || !sourceFile) return layer;
    SLIDER_PLACEMENT_SOURCES.push({ layer: layer, sourceFile: sourceFile });
    return layer;
}

function getSliderPlacementSource(layer) {
    for (var i = SLIDER_PLACEMENT_SOURCES.length - 1; i >= 0; i--) {
        if (sameEditableLayer(SLIDER_PLACEMENT_SOURCES[i].layer, layer)) {
            return SLIDER_PLACEMENT_SOURCES[i].sourceFile;
        }
    }
    return null;
}

function ensureSliderMainSmartObject(doc, layer) {
    if (!doc || !layer) throw new Error("Cannot convert Main to Smart Object.");

    try {
        if (layer.typename === "ArtLayer" && layer.kind === LayerKind.SMARTOBJECT) {
            layer.name = "Main";
            return layer;
        }
    } catch (kindError) {}

    app.activeDocument = doc;
    doc.activeLayer = layer;

    try {
        var desc = new ActionDescriptor();
        executeAction(stringIDToTypeID("newPlacedLayer"), desc, DialogModes.NO);
    } catch (e) {
        throw new Error("Could not convert Main to Smart Object: " + e.message);
    }

    var converted = doc.activeLayer;
    converted.name = "Main";
    return converted;
}

function liftEditablePSDShadowAfterPlacement(layer) {
    var info = getEditablePSDImport(layer);
    if (!info || !info.shadowLayer || info.shadowLiftApplied) return;

    var doc = getEditableLayerDocument(info.layer);
    if (!doc) return;

    var oldDoc = app.activeDocument;
    var oldActive = null;
    var oldAllLocked, oldPositionLocked;

    try {
        app.activeDocument = doc;
        oldActive = doc.activeLayer;
        doc.activeLayer = info.shadowLayer;

        try { oldAllLocked = info.shadowLayer.allLocked; info.shadowLayer.allLocked = false; } catch (e0) {}
        try { oldPositionLocked = info.shadowLayer.positionLocked; info.shadowLayer.positionLocked = false; } catch (e1) {}

        info.shadowLayer.translate(
            new UnitValue(0, "px"),
            new UnitValue(-PSD_SHADOW_LIFT_PX, "px")
        );
        info.shadowLiftApplied = true;
    } catch (e) {
        // Shadow lift is a visual correction only. Do not fail the whole job
        // when a source Shadow is locked in a way Photoshop cannot translate.
    } finally {
        try { if (oldPositionLocked !== undefined) info.shadowLayer.positionLocked = oldPositionLocked; } catch (e2) {}
        try { if (oldAllLocked !== undefined) info.shadowLayer.allLocked = oldAllLocked; } catch (e3) {}
        try { if (oldActive) doc.activeLayer = oldActive; } catch (e4) {}
        try { app.activeDocument = oldDoc; } catch (e5) {}
    }
}

function getSliderPlacementBounds(layer) {
    var info = getEditablePSDImport(layer);

    if (info && info.mainLayer) {
        // IMPORTANT PSD RULE:
        // A named Main layer already carries the real product bounds. Do NOT
        // remap whole-document white-space ratios onto Main again. Doing that
        // double-counts the source margins and makes PSD products scale far too
        // large, which can push the visible item past the Slider guides.
        //
        // Use the actual visible/transparency bounds of Main directly. Shadow is
        // deliberately ignored for sizing, then moved together with Main.
        return getLayerVisibleBoundsPx(info.mainLayer);
    }

    var sourceFile = getSliderPlacementSource(layer);
    var mapped = getOpaqueSourceMappedBounds(layer, sourceFile);
    if (mapped) return mapped;

    return getLayerVisibleBoundsPx(layer);
}

function findOpenEditableSource(sourceFile) {
    var wanted = String(sourceFile.fsName).toLowerCase();
    for (var i = 0; i < app.documents.length; i++) {
        try {
            if (String(app.documents[i].fullName.fsName).toLowerCase() === wanted) {
                return app.documents[i];
            }
        } catch (unsavedDocument) {}
    }
    return null;
}

function directEditableChild(group, name) {
    var wanted = cleanEditableSourceName(name);
    for (var i = 0; i < group.layers.length; i++) {
        if (cleanEditableSourceName(group.layers[i].name) === wanted) return group.layers[i];
    }
    return null;
}

function activateEditableGroup(doc, group) {
    app.activeDocument = doc;
    doc.activeLayer = group;
}

function resizeSliderPlacement(layer, horizontal, vertical, anchor) {
    var info = getEditablePSDImport(layer);
    if (!info) {
        layer.resize(horizontal, vertical, anchor);
        return;
    }
    var doc = getEditableLayerDocument(info.layer);
    if (!doc) throw new Error("Cannot find the document for Main + Shadow.");
    var oldUnits = app.preferences.rulerUnits;
    try {
        app.preferences.rulerUnits = Units.PIXELS;
        activateEditableGroup(doc, info.layer);
        // A leftover pixel selection must not limit the group transform.
        doc.selection.deselect();
        // One common transform only. Never resize Shadow on its own.
        info.layer.resize(horizontal, vertical, anchor);
    } finally {
        app.preferences.rulerUnits = oldUnits;
        try { activateEditableGroup(doc, info.layer); } catch (restoreActiveError) {}
    }
}

function translateSliderPlacement(layer, dx, dy) {
    var info = getEditablePSDImport(layer);
    if (!info) {
        layer.translate(dx, dy);
        return;
    }
    var doc = getEditableLayerDocument(info.layer);
    if (!doc) throw new Error("Cannot find the document for Main + Shadow.");
    var oldUnits = app.preferences.rulerUnits;
    try {
        app.preferences.rulerUnits = Units.PIXELS;
        activateEditableGroup(doc, info.layer);
        doc.selection.deselect();
        // Main and Shadow move together; preserve the original relative offset.
        info.layer.translate(new UnitValue(dx, "px"), new UnitValue(dy, "px"));
    } finally {
        app.preferences.rulerUnits = oldUnits;
        try { activateEditableGroup(doc, info.layer); } catch (restoreActiveError) {}
    }
}

function tryImportEditableMainShadowPSD(doc, sourceFile) {
    if (!isPSDOrPSBSource(sourceFile)) return null;

    var key = sourceFile.fsName ? String(sourceFile.fsName).toLowerCase() : "";
    var sourceDoc = null;
    var openedHere = false;
    var workDoc = null;
    var importedGroup = null;
    var originalDialogs = app.displayDialogs;
    var originalUnits = app.preferences.rulerUnits;

    app.displayDialogs = DialogModes.NO;
    app.preferences.rulerUnits = Units.PIXELS;

    try {
        sourceDoc = findOpenEditableSource(sourceFile);
        if (!sourceDoc) {
            sourceDoc = app.open(sourceFile);
            openedHere = true;
        }
        app.activeDocument = sourceDoc;

        var mainSource = findEditableSourceLayer(sourceDoc, "Main");
        var shadowSource = findEditableSourceLayer(sourceDoc, "Shadow");

        // Preserve the existing fallback for PSDs without the named pair.
        if (!mainSource || !shadowSource) {
            if (key) PREPARED_IMAGE_INFO[key] = { hasNamedShadowLayer: !!shadowSource };
            return null;
        }

        // Do not edit or regroup the source document, including an already-open
        // source that may contain unsaved work. Only operate on its duplicate.
        workDoc = sourceDoc.duplicate("__SLIDER_PAIR_WORK__", false);
        app.activeDocument = workDoc;
        mainSource = findEditableSourceLayer(workDoc, "Main");
        shadowSource = findEditableSourceLayer(workDoc, "Shadow");
        if (!mainSource || !shadowSource) {
            throw new Error("The source copy is missing Main or Shadow.");
        }

        var transferGroup = workDoc.layerSets.add();
        transferGroup.name = "__SLIDER_MAIN_SHADOW_TRANSFER__";

        // Both copies remain in the SAME source-sized document while grouping.
        // No cross-document per-layer centering or shadow correction is used.
        var mainCopy = mainSource.duplicate(transferGroup, ElementPlacement.PLACEATBEGINNING);
        var shadowCopy = shadowSource.duplicate(transferGroup, ElementPlacement.PLACEATEND);
        mainCopy.name = "Main";
        shadowCopy.name = "Shadow";
        // Preserve all copied visibility, opacity, blend mode, masks, effects,
        // linked masks, locks and source pixel data. Do not normalize Shadow.

        activateEditableGroup(workDoc, transferGroup);
        importedGroup = transferGroup.duplicate(doc, ElementPlacement.PLACEATBEGINNING);
        activateEditableGroup(doc, importedGroup);
        importedGroup.name = sourceFile.name.replace(/\.[^.]+$/, "");

        var importedMain = directEditableChild(importedGroup, "Main");
        var importedShadow = directEditableChild(importedGroup, "Shadow");
        if (!importedMain || !importedShadow) {
            throw new Error("The transferred group is missing Main or Shadow.");
        }

        // Quality rule: PSD Main must be a Smart Object before any Slider
        // resizing. Existing Smart Objects are preserved; normal pixel/group
        // Main layers are converted in the target document without touching
        // the original source PSD.
        importedMain = ensureSliderMainSmartObject(doc, importedMain);
        importedMain.name = "Main";

        // An existing source shadow prevents the separate auto-shadow generator
        // from creating a second shadow. JPG/PNG auto-shadow rules stay unchanged.
        if (key) PREPARED_IMAGE_INFO[key] = { hasNamedShadowLayer: true };
        rememberEditablePSDImport({
            layer: importedGroup,
            mainLayer: importedMain,
            shadowLayer: importedShadow,
            hasNamedShadowLayer: true,
            sourceFile: sourceFile,
            shadowLiftApplied: false
        });
        activateEditableGroup(doc, importedGroup);
        return importedGroup;

    } catch (e) {
        try {
            if (importedGroup) {
                app.activeDocument = doc;
                importedGroup.remove();
            }
        } catch (removeGroupError) {}
        throw new Error("Main + Shadow group import failed for " + sourceFile.name + ": " + e.message);
    } finally {
        if (workDoc) {
            try { workDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (closeWorkError) {}
        }
        if (sourceDoc && openedHere) {
            try { sourceDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (closeSourceError) {}
        }
        app.displayDialogs = originalDialogs;
        app.preferences.rulerUnits = originalUnits;
        try { app.activeDocument = doc; } catch (restoreDocumentError) {}
        if (importedGroup) {
            try { doc.activeLayer = importedGroup; } catch (restoreGroupError) {}
        }
    }
}

function placeFileAsSmartObject(file) {

    var originalSourceFile = file;
    var editableGroup = tryImportEditableMainShadowPSD(app.activeDocument, file);
    if (editableGroup) return editableGroup;

    file = prepareImageForSlider(file);

    var desc = new ActionDescriptor();

    desc.putPath(charIDToTypeID("null"), file);

    desc.putEnumerated(
        charIDToTypeID("FTcs"),
        charIDToTypeID("QCSt"),
        charIDToTypeID("Qcsa")
    );

    executeAction(charIDToTypeID("Plc "), desc, DialogModes.NO);

    var placed = app.activeDocument.activeLayer;
    rememberSliderPlacementSource(placed, originalSourceFile);
    return placed;
}


function layerBoundsPx(layer) {
    var b = layer.bounds;
    return {
        left: b[0].as("px"),
        top: b[1].as("px"),
        right: b[2].as("px"),
        bottom: b[3].as("px")
    };
}

// Return bounds of ACTUAL VISIBLE pixels only. Transparent canvas/padding is
// ignored. This is used by Creative, Detail and every Lineup placement.
function getLayerVisibleBoundsPx(layer) {
    var doc = getEditableLayerDocument(layer) || app.activeDocument;
    var oldDoc = app.activeDocument;
    var oldActive = null;

    try {
        app.activeDocument = doc;
        oldActive = doc.activeLayer;
        doc.activeLayer = layer;
        loadCompactTransparency();

        if (compactSelectionExists(doc)) {
            var sb = doc.selection.bounds;
            var result = {
                left: sb[0].as("px"),
                top: sb[1].as("px"),
                right: sb[2].as("px"),
                bottom: sb[3].as("px")
            };
            try { doc.selection.deselect(); } catch (e0) {}
            return result;
        }
    } catch (e) {
        // Some Photoshop layer types cannot expose a transparency selection.
        // Fall back to the normal layer bounds in that case.
    } finally {
        try { doc.selection.deselect(); } catch (e1) {}
        try { if (oldActive) doc.activeLayer = oldActive; } catch (e2) {}
        try { app.activeDocument = oldDoc; } catch (e3) {}
    }

    return layerBoundsPx(layer);
}

function sourceContentCacheKey(sourceFile) {
    return String(sourceFile && (sourceFile.fsName || sourceFile.name) || "").toLowerCase();
}

function selectionBoundsPx(doc) {
    if (!compactSelectionExists(doc)) return null;
    var sb = doc.selection.bounds;
    return {
        left: sb[0].as("px"),
        top: sb[1].as("px"),
        right: sb[2].as("px"),
        bottom: sb[3].as("px")
    };
}

function selectionCoversWholeCanvas(bounds, width, height) {
    if (!bounds) return false;
    var eps = 1.5;
    return bounds.left <= eps && bounds.top <= eps &&
        bounds.right >= (width - eps) && bounds.bottom >= (height - eps);
}

function bakeVisibleLayerMaskToTransparency(doc) {
    try {
        var blank = doc.artLayers.add();
        blank.name = "__SLIDER_ALPHA_BAKE__";
        try { blank.move(doc.activeLayer, ElementPlacement.PLACEAFTER); } catch (moveErr) {}
        doc.mergeVisibleLayers();
        return doc.activeLayer;
    } catch (e) {
        return doc.activeLayer;
    }
}

function analyzeSourceVisibleContent(sourceFile) {
    if (!sourceFile || !sourceFile.exists) return null;

    var key = sourceContentCacheKey(sourceFile);
    if (SOURCE_VISIBLE_CONTENT_CACHE.hasOwnProperty(key)) {
        return SOURCE_VISIBLE_CONTENT_CACHE[key];
    }

    var sourceDoc = null;
    var workDoc = null;
    var openedHere = false;
    var oldDoc = app.activeDocument;
    var oldDialogs = app.displayDialogs;

    try {
        app.displayDialogs = DialogModes.NO;
        sourceDoc = findOpenEditableSource(sourceFile);
        if (!sourceDoc) {
            sourceDoc = app.open(sourceFile);
            openedHere = true;
        }

        workDoc = sourceDoc.duplicate("__SLIDER_VISIBLE_ANALYZE__", false);
        app.activeDocument = workDoc;

        var target = findEditableSourceLayer(workDoc, "Main");
        if (!target) target = workDoc.activeLayer;
        if (!target) {
            SOURCE_VISIBLE_CONTENT_CACHE[key] = null;
            return null;
        }

        setOnlyAnalysisLayerVisible(workDoc, target);
        try {
            workDoc.mergeVisibleLayers();
            target = workDoc.activeLayer;
        } catch (mergeErr) {}

        workDoc.activeLayer = target;
        loadCompactTransparency();

        var docW = workDoc.width.as("px");
        var docH = workDoc.height.as("px");
        var nativeBounds = selectionBoundsPx(workDoc);
        try { workDoc.selection.deselect(); } catch (e0) {}

        // Transparent sources already expose their real item bounds directly
        // in the placed layer. Only run Photoshop Remove Background when the
        // source is effectively opaque/full-canvas (typical JPG/white PNG).
        if (nativeBounds && !selectionCoversWholeCanvas(nativeBounds, docW, docH)) {
            SOURCE_VISIBLE_CONTENT_CACHE[key] = null;
            return null;
        }

        try { if (target.isBackgroundLayer) target.isBackgroundLayer = false; } catch (bgErr) {}
        workDoc.activeLayer = target;

        var rbDesc = new ActionDescriptor();
        executeAction(stringIDToTypeID("removeBackground"), rbDesc, DialogModes.NO);

        target = workDoc.activeLayer;
        target = bakeVisibleLayerMaskToTransparency(workDoc);
        workDoc.activeLayer = target;
        loadCompactTransparency();

        var itemBounds = selectionBoundsPx(workDoc);
        try { workDoc.selection.deselect(); } catch (e1) {}

        if (!itemBounds || selectionCoversWholeCanvas(itemBounds, docW, docH)) {
            SOURCE_VISIBLE_CONTENT_CACHE[key] = null;
            return null;
        }

        var result = {
            left: itemBounds.left / docW,
            top: itemBounds.top / docH,
            right: itemBounds.right / docW,
            bottom: itemBounds.bottom / docH
        };

        SOURCE_VISIBLE_CONTENT_CACHE[key] = result;
        return result;

    } catch (e) {
        // If Remove Background is unavailable or Photoshop cannot analyze a
        // particular source, keep the previous Slider behavior rather than
        // blocking production.
        SOURCE_VISIBLE_CONTENT_CACHE[key] = null;
        return null;
    } finally {
        if (workDoc) {
            try { workDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
        }
        if (sourceDoc && openedHere) {
            try { sourceDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e3) {}
        }
        app.displayDialogs = oldDialogs;
        try { app.activeDocument = oldDoc; } catch (e4) {}
    }
}

function getOpaqueSourceMappedBounds(layer, sourceFile) {
    if (!layer || !sourceFile) return null;

    var normalized = analyzeSourceVisibleContent(sourceFile);
    if (!normalized) return null;

    var raw = layerBoundsPx(layer);
    var rawW = raw.right - raw.left;
    var rawH = raw.bottom - raw.top;
    if (rawW <= 0 || rawH <= 0) return null;

    return {
        left: raw.left + rawW * normalized.left,
        top: raw.top + rawH * normalized.top,
        right: raw.left + rawW * normalized.right,
        bottom: raw.top + rawH * normalized.bottom
    };
}

var SOURCE_CUT_CACHE = {};

function sourceSupportsCutAnalysis(file) {
    return !!(file && file.name && /\.(png|psd|psb|tif|tiff|webp|avif)$/i.test(file.name));
}

function setOnlyAnalysisLayerVisible(container, target) {
    var layers = container.layers;
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        if (layer.typename === "LayerSet") {
            var contains = false;
            var p = target;
            while (p && p.typename !== "Document") {
                if (p === layer) { contains = true; break; }
                p = p.parent;
            }
            try { layer.visible = contains; } catch (e0) {}
            if (contains) setOnlyAnalysisLayerVisible(layer, target);
        } else {
            try { layer.visible = (layer === target); } catch (e1) {}
        }
    }
}

function analyzeSourceCutEdges(sourceFile) {
    if (!sourceSupportsCutAnalysis(sourceFile)) return null;

    var key = String(sourceFile.fsName || sourceFile.name).toLowerCase();
    if (SOURCE_CUT_CACHE.hasOwnProperty(key)) return SOURCE_CUT_CACHE[key];

    var sourceDoc = null;
    var workDoc = null;
    var openedHere = false;
    var oldDoc = app.activeDocument;
    var oldDialogs = app.displayDialogs;

    try {
        app.displayDialogs = DialogModes.NO;
        sourceDoc = findOpenEditableSource(sourceFile);
        if (!sourceDoc) {
            sourceDoc = app.open(sourceFile);
            openedHere = true;
        }

        workDoc = sourceDoc.duplicate("__SLIDER_CUT_ANALYZE__", false);
        app.activeDocument = workDoc;

        var target = findEditableSourceLayer(workDoc, "Main");
        if (!target) target = workDoc.activeLayer;
        if (!target) {
            SOURCE_CUT_CACHE[key] = null;
            return null;
        }

        // Bake masks/effects only inside the throw-away copy so transparency
        // selection represents what is actually visible, not the source canvas.
        setOnlyAnalysisLayerVisible(workDoc, target);
        try {
            workDoc.mergeVisibleLayers();
            target = workDoc.activeLayer;
        } catch (mergeErr) {}

        workDoc.activeLayer = target;
        loadCompactTransparency();
        if (!compactSelectionExists(workDoc)) {
            SOURCE_CUT_CACHE[key] = null;
            return null;
        }

        var sb = workDoc.selection.bounds;
        var docW = workDoc.width.as("px");
        var docH = workDoc.height.as("px");
        var eps = 1.5;
        var bounds = {
            left: sb[0].as("px"),
            top: sb[1].as("px"),
            right: sb[2].as("px"),
            bottom: sb[3].as("px")
        };
        try { workDoc.selection.deselect(); } catch (e0) {}

        var result = {
            left: bounds.left <= eps,
            top: bounds.top <= eps,
            right: bounds.right >= (docW - eps),
            bottom: bounds.bottom >= (docH - eps)
        };

        SOURCE_CUT_CACHE[key] = result;
        return result;
    } catch (e) {
        SOURCE_CUT_CACHE[key] = null;
        return null;
    } finally {
        if (workDoc) {
            try { workDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e1) {}
        }
        if (sourceDoc && openedHere) {
            try { sourceDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
        }
        app.displayDialogs = oldDialogs;
        try { app.activeDocument = oldDoc; } catch (e3) {}
    }
}

function computeCutAwarePlacement(w, h, regionLeft, regionTop, regionW, regionH, cut) {
    cut = cut || {};

    var horizontalPair = !!(cut.left && cut.right);
    var verticalPair = !!(cut.top && cut.bottom);
    var allSides = horizontalPair && verticalPair;
    var scale = Math.min(regionW / w, regionH / h);

    if (allSides) {
        // All four sides touch the source canvas. For a clearly tall image,
        // honor top+bottom only; for a clearly wide image, honor left+right
        // only. Near the target aspect ratio, maximize the full 600x550 area.
        var aspect = w / h;
        var targetAspect = regionW / regionH;
        if (aspect < targetAspect * 0.90) {
            scale = regionH / h;
            horizontalPair = false;
        } else if (aspect > targetAspect * 1.10) {
            scale = regionW / w;
            verticalPair = false;
        } else {
            scale = Math.max(regionW / w, regionH / h);
        }
    } else {
        if (horizontalPair) scale = Math.max(scale, regionW / w);
        if (verticalPair) scale = Math.max(scale, regionH / h);
    }

    var newW = w * scale;
    var newH = h * scale;
    var left = regionLeft + (regionW - newW) / 2;
    var top = regionTop + (regionH - newH) / 2;

    if (horizontalPair) {
        left = regionLeft + (regionW - newW) / 2;
    } else if (cut.left && !(allSides && w / h < (regionW / regionH) * 0.90)) {
        left = regionLeft;
    } else if (cut.right && !(allSides && w / h < (regionW / regionH) * 0.90)) {
        left = regionLeft + regionW - newW;
    }

    if (verticalPair) {
        top = regionTop + (regionH - newH) / 2;
    } else if (cut.top && !(allSides && w / h > (regionW / regionH) * 1.10)) {
        top = regionTop;
    } else if (cut.bottom && !(allSides && w / h > (regionW / regionH) * 1.10)) {
        top = regionTop + regionH - newH;
    }

    return { scale: scale, left: left, top: top };
}

function fitCutLayerToRegion(layer, sourceFile, regionLeft, regionTop, regionW, regionH) {
    var b = getSliderPlacementBounds(layer);
    var w = b.right - b.left;
    var h = b.bottom - b.top;
    if (w <= 0 || h <= 0) throw new Error("Invalid Cut Image dimensions.");

    var cut = analyzeSourceCutEdges(sourceFile);
    var placement;

    if (cut) {
        placement = computeCutAwarePlacement(
            w, h, regionLeft, regionTop, regionW, regionH, cut
        );
    } else {
        var scale = Math.min(regionW / w, regionH / h);
        placement = {
            scale: scale,
            left: regionLeft + (regionW - w * scale) / 2,
            top: regionTop + (regionH - h * scale) / 2
        };
    }

    resizeSliderPlacement(
        layer,
        placement.scale * 100,
        placement.scale * 100,
        AnchorPosition.MIDDLECENTER
    );

    b = getSliderPlacementBounds(layer);
    translateSliderPlacement(
        layer,
        placement.left - b.left,
        placement.top - b.top
    );
    liftEditablePSDShadowAfterPlacement(layer);
}


function placeImageInBox(doc, fileEntry, box, layerName, bottomAlign) {

    if (!fileEntry || !fileEntry.file) {
        throw new Error("Missing image for " + layerName);
    }

    var sourceFile = fileEntry.file;
    var layer = placeFileAsSmartObject(sourceFile);

    var b = getSliderPlacementBounds(layer);
    var currentWidth = b.right - b.left;
    var currentHeight = b.bottom - b.top;

    if (currentWidth <= 0 || currentHeight <= 0) {
        throw new Error("Invalid image dimensions for " + fileEntry.name);
    }

    // IMPORTANT: keep the ORIGINAL SLIDER placement rule.
    // The slider fits the placed layer bounds into the configured 600px
    // layout box. The compact cleaner only removes stray pixels; it must
    // not replace the slider's own canvas/layout sizing math.
    var fit = fitImageInBox(
        { width: currentWidth, height: currentHeight },
        box
    );

    resizeSliderPlacement(layer, fit.scale * 100, fit.scale * 100, AnchorPosition.TOPLEFT);

    b = getSliderPlacementBounds(layer);
    var actualWidth = b.right - b.left;
    var actualHeight = b.bottom - b.top;

    // Lineup/PA Vertical slots are hard boundaries. If Photoshop transform
    // rounding leaves visible Main pixels outside the slot, shrink once more
    // before centering. Transparent/white source padding is not part of these
    // measurements.
    if (actualWidth > box.width + 0.25 || actualHeight > box.height + 0.25) {
        var slotCorrection = Math.min(
            box.width / actualWidth,
            box.height / actualHeight,
            1
        );
        if (slotCorrection < 1) {
            resizeSliderPlacement(
                layer,
                slotCorrection * 100,
                slotCorrection * 100,
                AnchorPosition.MIDDLECENTER
            );
            b = getSliderPlacementBounds(layer);
            actualWidth = b.right - b.left;
            actualHeight = b.bottom - b.top;
        }
    }

    var targetX = box.x + (box.width - actualWidth) / 2;
    var targetY;

    if (bottomAlign) {
        targetY = box.y + box.height - actualHeight;
    } else {
        targetY = box.y + (box.height - actualHeight) / 2;
    }

    translateSliderPlacement(layer, targetX - b.left, targetY - b.top);
    layer.name = layerName;
    liftEditablePSDShadowAfterPlacement(layer);

    return layer;
}


function createVariantTextLayer(doc, text, box, layerName) {

    var layer = doc.artLayers.add();

    layer.kind = LayerKind.TEXT;
    layer.name = layerName;
    layer.textItem.contents = text;
    layer.textItem.font = "HiraKakuPro-W3";
    layer.textItem.size = new UnitValue(21, "px");
    layer.textItem.justification = Justification.CENTER;

    // LINEUP variant / Color Name text: #1E1E1E (RGB 30, 30, 30).
    // Do not change shadow blacks, Creative, or Detail text styling.
    var lineupTextColor = new SolidColor();
    lineupTextColor.rgb.red = 30;
    lineupTextColor.rgb.green = 30;
    lineupTextColor.rgb.blue = 30;
    layer.textItem.color = lineupTextColor;

    var b = layerBoundsPx(layer);
    var textWidth = b.right - b.left;
    var textHeight = b.bottom - b.top;

    var targetX = box.x + (box.width - textWidth) / 2;
    var targetY = box.y + (box.height - textHeight) / 2;

    layer.translate(targetX - b.left, targetY - b.top);

    return layer;
}


function buildHorizontalLineupGroup(doc, lineupData, index) {
    var layout = computeLineupLayout();
    var group = doc.layerSets.add();
    group.name = "LINEUP " + padLineupNumber(index + 1);

    var photo1 = null, text1 = null, photo2 = null, text2 = null;

    if (lineupData.photo1 && lineupData.photo1.file) {
        photo1 = placeImageInBox(doc, lineupData.photo1, layout.photo1, lineupData.photo1.name, false);
        var photo1Shadow = applyConfiguredShadowIfNeeded(lineupData.photo1, photo1, lineupData.shadow1);
        if (photo1Shadow) photo1Shadow.move(group, ElementPlacement.INSIDE);
        moveItemInsideGroupSafe(photo1, group);
    }
    if (lineupData.variant1) {
        text1 = createVariantTextLayer(doc, lineupData.variant1, layout.variant1, lineupData.variant1 + " Variant");
        text1.move(group, ElementPlacement.INSIDE);
    }
    if (lineupData.photo2 && lineupData.photo2.file) {
        photo2 = placeImageInBox(doc, lineupData.photo2, layout.photo2, lineupData.photo2.name, false);
        var photo2Shadow = applyConfiguredShadowIfNeeded(lineupData.photo2, photo2, lineupData.shadow2);
        if (photo2Shadow) photo2Shadow.move(group, ElementPlacement.INSIDE);
        moveItemInsideGroupSafe(photo2, group);
    }
    if (lineupData.variant2) {
        text2 = createVariantTextLayer(doc, lineupData.variant2, layout.variant2, lineupData.variant2 + " Variant");
        text2.move(group, ElementPlacement.INSIDE);
    }

    if (text2) text2.move(group, ElementPlacement.PLACEATBEGINNING);
    if (photo2) moveItemToGroupTopSafe(photo2, group);
    if (text1) text1.move(group, ElementPlacement.PLACEATBEGINNING);
    if (photo1) moveItemToGroupTopSafe(photo1, group);
    return group;
}

function buildVerticalLineupGroup(doc, lineupData, index) {
    var layout = computeVerticalLineupLayout();
    var group = doc.layerSets.add();
    group.name = "LINEUP " + padLineupNumber(index + 1);

    var photo1 = null, photo2 = null, text1 = null, text2 = null;

    if (lineupData.photo1 && lineupData.photo1.file) {
        photo1 = placeImageInBox(doc, lineupData.photo1, layout.photo1, lineupData.photo1.name, false);
        var photo1Shadow = applyConfiguredShadowIfNeeded(lineupData.photo1, photo1, lineupData.shadow1);
        if (photo1Shadow) photo1Shadow.move(group, ElementPlacement.INSIDE);
        moveItemInsideGroupSafe(photo1, group);
    }
    if (lineupData.photo2 && lineupData.photo2.file) {
        photo2 = placeImageInBox(doc, lineupData.photo2, layout.photo2, lineupData.photo2.name, true);
        var photo2Shadow = applyConfiguredShadowIfNeeded(lineupData.photo2, photo2, lineupData.shadow2);
        if (photo2Shadow) photo2Shadow.move(group, ElementPlacement.INSIDE);
        moveItemInsideGroupSafe(photo2, group);
    }

    if (photo1 && photo2) {
        var b1 = getSliderPlacementBounds(photo1);
        var b2 = getSliderPlacementBounds(photo2);
        var diff = b1.bottom - b2.bottom;
        if (Math.abs(diff) > 0.01) translateSliderPlacement(photo2, 0, diff);
        b1 = getSliderPlacementBounds(photo1);
        b2 = getSliderPlacementBounds(photo2);
        if (lineupData.variant1) {
            text1 = createVariantTextLayer(doc, lineupData.variant1,
                { x: layout.photo1.x, y: b1.bottom, width: layout.photo1.width, height: 50 },
                lineupData.variant1 + " Variant");
            text1.move(group, ElementPlacement.INSIDE);
        }
        if (lineupData.variant2) {
            text2 = createVariantTextLayer(doc, lineupData.variant2,
                { x: layout.photo2.x, y: b2.bottom, width: layout.photo2.width, height: 50 },
                lineupData.variant2 + " Variant");
            text2.move(group, ElementPlacement.INSIDE);
        }
    } else {
        if (lineupData.variant1) {
            var box1 = layout.variant1;
            if (photo1) {
                var pb1 = getSliderPlacementBounds(photo1);
                box1 = { x: layout.photo1.x, y: pb1.bottom, width: layout.photo1.width, height: 50 };
            }
            text1 = createVariantTextLayer(doc, lineupData.variant1, box1, lineupData.variant1 + " Variant");
            text1.move(group, ElementPlacement.INSIDE);
        }
        if (lineupData.variant2) {
            var box2 = layout.variant2;
            if (photo2) {
                var pb2 = getSliderPlacementBounds(photo2);
                box2 = { x: layout.photo2.x, y: pb2.bottom, width: layout.photo2.width, height: 50 };
            }
            text2 = createVariantTextLayer(doc, lineupData.variant2, box2, lineupData.variant2 + " Variant");
            text2.move(group, ElementPlacement.INSIDE);
        }
    }

    if (text2) text2.move(group, ElementPlacement.PLACEATBEGINNING);
    if (photo2) moveItemToGroupTopSafe(photo2, group);
    if (text1) text1.move(group, ElementPlacement.PLACEATBEGINNING);
    if (photo1) moveItemToGroupTopSafe(photo1, group);
    return group;
}


function buildPaVerticalLineupGroup(doc, lineupData, index) {
    var layout = computePaVerticalLineupLayout();
    var group = doc.layerSets.add();
    group.name = "LINEUP " + padLineupNumber(index + 1);

    var itemLayer = null;
    var detailLayer = null;
    var colorLayer = null;

    if (lineupData.photo1 && lineupData.photo1.file) {
        itemLayer = placeImageInBox(
            doc,
            lineupData.photo1,
            layout.item,
            lineupData.photo1.name,
            false
        );
        var itemShadow = applyConfiguredShadowIfNeeded(
            lineupData.photo1,
            itemLayer,
            lineupData.shadow1
        );
        if (itemShadow) itemShadow.move(group, ElementPlacement.INSIDE);
        moveItemInsideGroupSafe(itemLayer, group);
    }

    if (lineupData.photo2 && lineupData.photo2.file) {
        detailLayer = placeImageInBox(
            doc,
            lineupData.photo2,
            layout.detail,
            lineupData.photo2.name,
            false
        );
        var detailShadow = applyConfiguredShadowIfNeeded(
            lineupData.photo2,
            detailLayer,
            lineupData.shadow2
        );
        if (detailShadow) detailShadow.move(group, ElementPlacement.INSIDE);
        moveItemInsideGroupSafe(detailLayer, group);
    }

    if (lineupData.variant1) {
        colorLayer = createVariantTextLayer(
            doc,
            lineupData.variant1,
            layout.colorName,
            lineupData.variant1 + " Color"
        );
        colorLayer.move(group, ElementPlacement.INSIDE);
    }

    if (colorLayer) colorLayer.move(group, ElementPlacement.PLACEATBEGINNING);
    if (detailLayer) moveItemToGroupTopSafe(detailLayer, group);
    if (itemLayer) moveItemToGroupTopSafe(itemLayer, group);

    return group;
}

function buildFourCutGroup(doc, lineupData, index) {
    var layout = computeFourCutLayout();
    var group = doc.layerSets.add();
    group.name = "LINEUP " + padLineupNumber(index + 1);

    var photos = [null, null, null, null];
    var texts = [null, null, null, null];

    for (var n = 1; n <= 4; n++) {
        var photoEntry = lineupData["photo" + n];
        var variant = lineupData["variant" + n];
        var photoBox = layout["photo" + n];
        var variantBox = layout["variant" + n];

        if (photoEntry && photoEntry.file) {
            photos[n - 1] = placeImageInBox(doc, photoEntry, photoBox, photoEntry.name, false);
            var photoShadow = applyConfiguredShadowIfNeeded(photoEntry, photos[n - 1], lineupData["shadow" + n]);
            if (photoShadow) photoShadow.move(group, ElementPlacement.INSIDE);
            moveItemInsideGroupSafe(photos[n - 1], group);
        }
        if (variant) {
            texts[n - 1] = createVariantTextLayer(doc, variant, variantBox, variant + " Variant");
            texts[n - 1].move(group, ElementPlacement.INSIDE);
        }
    }

    // Empty slots are valid. Only move layers that were actually created.
    for (var r = 3; r >= 0; r--) {
        if (texts[r]) texts[r].move(group, ElementPlacement.PLACEATBEGINNING);
        if (photos[r]) moveItemToGroupTopSafe(photos[r], group);
    }
    return group;
}

function setLineupLayerOrder(group, photo1, text1, photo2, text2) {
    text2.move(group, ElementPlacement.PLACEATBEGINNING);
    moveItemToGroupTopSafe(photo2, group);
    text1.move(group, ElementPlacement.PLACEATBEGINNING);
    moveItemToGroupTopSafe(photo1, group);
}


function setFourCutLayerOrder(group, photo1, text1, photo2, text2, photo3, text3, photo4, text4) {
    text4.move(group, ElementPlacement.PLACEATBEGINNING);
    moveItemToGroupTopSafe(photo4, group);
    text3.move(group, ElementPlacement.PLACEATBEGINNING);
    moveItemToGroupTopSafe(photo3, group);
    text2.move(group, ElementPlacement.PLACEATBEGINNING);
    moveItemToGroupTopSafe(photo2, group);
    text1.move(group, ElementPlacement.PLACEATBEGINNING);
    moveItemToGroupTopSafe(photo1, group);
}


// Generated shadow uses ONLY the LOWER HALF of the item's actual
// non-transparent pixels. Empty/transparent canvas pixels are ignored.
// The bottom edge of the item is preserved so the shadow follows the
// real product silhouette instead of the layer/canvas bounds.
var AUTO_SHADOW_OPACITY = 18;
var AUTO_SHADOW_BLUR = 5;
var AUTO_SHADOW_OFFSET_X = 0;
var AUTO_SHADOW_OFFSET_Y = 4;
var AUTO_SHADOW_LOWER_RATIO = 0.50;

function sourceFileHasNamedShadowLayer(file) {

    if (!file || !file.exists || !file.fsName) {
        return false;
    }

    var key = String(file.fsName).toLowerCase();
    var info = PREPARED_IMAGE_INFO[key];

    return !!(info && info.hasNamedShadowLayer);
}

function shouldApplyGeneratedShadow(fileEntry, wantsShadow) {

    if (!wantsShadow) {
        return false;
    }

    if (!fileEntry || !fileEntry.file) {
        return false;
    }

    // If the source PSD already contains a named Shadow layer,
    // preserve that source shadow and do not add an extra one.
    if (sourceFileHasNamedShadowLayer(fileEntry.file)) {
        return false;
    }

    return true;
}

function applyConfiguredShadowIfNeeded(fileEntry, layer, wantsShadow) {

    if (!shouldApplyGeneratedShadow(fileEntry, wantsShadow)) {
        return null;
    }

    return createBottomContactShadow(layer);
}

function createBottomContactShadow(layer, maxVisibleBottom) {

    if (!layer) {
        return null;
    }

    var doc = app.activeDocument;
    var oldActive = doc.activeLayer;
    var shadowLayer = null;

    try {
        doc.activeLayer = layer;

        // Select ONLY the actual visible/non-transparent pixels of the item.
        // Transparent/empty pixels around the item are never part of the shadow.
        loadCompactTransparency();

        if (!compactSelectionExists(doc)) {
            try { doc.selection.deselect(); } catch (e0) {}
            return null;
        }

        // Selection bounds come from the real visible pixels, not the layer canvas.
        var sb = doc.selection.bounds;
        var itemLeft = sb[0].as('px');
        var itemTop = sb[1].as('px');
        var itemRight = sb[2].as('px');
        var itemBottom = sb[3].as('px');

        // Cut Image may intentionally hide the bottom part of the Smart Object.
        // Clamp the visible/contact edge BEFORE building the shadow so the shadow
        // follows what the user actually sees, while the source Smart Object stays
        // fully editable and high-resolution.
        if (maxVisibleBottom !== undefined && maxVisibleBottom !== null) {
            itemBottom = Math.min(itemBottom, maxVisibleBottom);
        }

        var itemHeight = itemBottom - itemTop;

        if (itemHeight <= 0) {
            try { doc.selection.deselect(); } catch (e1) {}
            return null;
        }

        // Keep only the LOWER HALF of the actual item silhouette.
        // The bottom/item edge remains included in the selection.
        var lowerTop = itemBottom - (itemHeight * AUTO_SHADOW_LOWER_RATIO);

        doc.selection.select([
            [new UnitValue(Math.max(0, itemLeft - 2), 'px'), new UnitValue(Math.max(0, lowerTop), 'px')],
            [new UnitValue(Math.min(CANVAS_SIZE, itemRight + 2), 'px'), new UnitValue(Math.max(0, lowerTop), 'px')],
            [new UnitValue(Math.min(CANVAS_SIZE, itemRight + 2), 'px'), new UnitValue(Math.min(CANVAS_SIZE, itemBottom + 2), 'px')],
            [new UnitValue(Math.max(0, itemLeft - 2), 'px'), new UnitValue(Math.min(CANVAS_SIZE, itemBottom + 2), 'px')]
        ], SelectionType.INTERSECT, 0, false);

        if (!compactSelectionExists(doc)) {
            try { doc.selection.deselect(); } catch (e2) {}
            return null;
        }

        shadowLayer = doc.artLayers.add();
        shadowLayer.name = layer.name + ' Shadow';
        shadowLayer.move(layer, ElementPlacement.PLACEAFTER);
        doc.activeLayer = shadowLayer;

        var black = new SolidColor();
        black.rgb.red = 0;
        black.rgb.green = 0;
        black.rgb.blue = 0;

        // Fill only the selected lower-half item pixels.
        doc.selection.fill(black, ColorBlendMode.NORMAL, 100, false);
        doc.selection.deselect();

        // Keep the exact lower-half silhouette: no horizontal/vertical scaling.
        if (AUTO_SHADOW_OFFSET_X !== 0 || AUTO_SHADOW_OFFSET_Y !== 0) {
            shadowLayer.translate(
                AUTO_SHADOW_OFFSET_X,
                AUTO_SHADOW_OFFSET_Y
            );
        }

        try {
            shadowLayer.applyGaussianBlur(AUTO_SHADOW_BLUR);
        } catch (e3) {}

        shadowLayer.opacity = AUTO_SHADOW_OPACITY;

        doc.activeLayer = layer;
        return shadowLayer;

    } catch (err) {
        try { doc.selection.deselect(); } catch (e4) {}
        if (shadowLayer) {
            try { shadowLayer.remove(); } catch (e5) {}
        }
        return null;
    } finally {
        try { doc.activeLayer = oldActive; } catch (e6) {}
    }
}


// ------------------------------------------------------------
// DETAIL SHADOW ALIGNMENT
// The lower-half pixel mask is created directly from the Detail layer
// in the correct document coordinates, so it is already aligned.
// Do not re-center it afterward; re-centering would pull the half-shadow
// away from the item's bottom edge.
// ------------------------------------------------------------
function alignDetailShadowToItem(itemLayer, shadowLayer) {
    return;
}

function groupDetailItemWithShadow(doc, itemLayer, shadowLayer, groupName) {

    if (!doc || !itemLayer || !shadowLayer) return null;

    var group = doc.layerSets.add();
    group.name = groupName;

    // The generated shadow must not remain as an independent top-level layer.
    shadowLayer.name = "Shadow";
    itemLayer.name = "Main";

    shadowLayer.move(group, ElementPlacement.INSIDE);
    itemLayer.move(group, ElementPlacement.INSIDE);

    // Main above Shadow inside the Detail group.
    try {
        itemLayer.move(group, ElementPlacement.PLACEATBEGINNING);
    } catch (orderErr) {}

    doc.activeLayer = group;
    return group;
}


/* ============================================================
   CREATIVE / DETAIL PSD BUILDING
   (unchanged from your existing SIX PSD Generator)
   ============================================================ */

/* ============================================================
   INTEGRATED COMPACT BOUNDS CLEANER
   ------------------------------------------------------------
   Before any source PSD is placed into the slider, create a
   temporary cleaned copy and run the same Main / Shadow cleanup
   used by Compact_Bounds_Cleaner_Main_Shadow.jsx.

   - Original source files are NEVER modified.
   - Only PSD sources are processed.
   - Main:   radius 1 px / margin 8 px
   - Shadow: radius 2 px / margin 20 px
   - No backup layer is created in the temporary copy.
   - If a PSD has no Main/Shadow layers, the original file is used.
   ============================================================ */

var COMPACT_MAIN_RADIUS = 1;
var COMPACT_MAIN_MARGIN = 8;
var COMPACT_SHADOW_RADIUS = 2;
var COMPACT_SHADOW_MARGIN = 20;

var PREPARED_IMAGE_FILES = [];
var PREPARED_IMAGE_CACHE = {};
var PREPARED_IMAGE_INFO = {};

function placeSmartObject(doc, file) {

    var originalSourceFile = file;
    var editableGroup = tryImportEditableMainShadowPSD(doc, file);
    if (editableGroup) return editableGroup;

    file = prepareImageForSlider(file);

    var idPlc = charIDToTypeID("Plc ");

    var desc = new ActionDescriptor();
    desc.putPath(charIDToTypeID("null"), file);

    executeAction(idPlc, desc, DialogModes.NO);

    var placed = doc.activeLayer;
    rememberSliderPlacementSource(placed, originalSourceFile);
    return placed;
}

function prepareImageForSlider(sourceFile) {

    if (!sourceFile || !sourceFile.exists) {
        throw new Error("Source image not found.");
    }

    // A temporary PSD produced by this integrated cleaner is already
    // prepared. Never compact it a second time.
    if (/^_slider_compact_/i.test(sourceFile.name)) {
        return sourceFile;
    }

    var key = sourceFile.fsName.toLowerCase();

    // The original cleaner is specifically for PSD documents.
    if (!/\.psd$/i.test(sourceFile.name)) {
        PREPARED_IMAGE_INFO[key] = { hasNamedShadowLayer: false };
        return sourceFile;
    }

    // Reuse the same temporary cleaned file if the same PSD is used
    // more than once in the slider.
    if (PREPARED_IMAGE_CACHE[key] && PREPARED_IMAGE_CACHE[key].exists) {
        return PREPARED_IMAGE_CACHE[key];
    }

    var sourceDoc = null;
    var tempFile = null;
    var originalDialogs = app.displayDialogs;
    var originalUnits = app.preferences.rulerUnits;

    app.displayDialogs = DialogModes.NO;
    app.preferences.rulerUnits = Units.PIXELS;

    try {

        sourceDoc = app.open(sourceFile);

        var targets = [];
        findCompactTargets(sourceDoc, targets);

        var hasNamedShadowLayer = false;
        for (var t = 0; t < targets.length; t++) {
            if (targets[t].type === "shadow") {
                hasNamedShadowLayer = true;
                break;
            }
        }
        PREPARED_IMAGE_INFO[key] = { hasNamedShadowLayer: hasNamedShadowLayer };

        // No Main/Shadow = nothing to clean. Use the source directly.
        if (targets.length === 0) {
            sourceDoc.close(SaveOptions.DONOTSAVECHANGES);
            sourceDoc = null;
            PREPARED_IMAGE_CACHE[key] = sourceFile;
            return sourceFile;
        }

        var cleanedAnything = false;

        for (var i = 0; i < targets.length; i++) {

            var target = targets[i];
            var radius = target.type === "main"
                ? COMPACT_MAIN_RADIUS
                : COMPACT_SHADOW_RADIUS;

            var margin = target.type === "main"
                ? COMPACT_MAIN_MARGIN
                : COMPACT_SHADOW_MARGIN;

            if (compactLayerForSlider(
                sourceDoc,
                target.layer,
                radius,
                margin
            )) {
                cleanedAnything = true;
            }
        }

        if (!cleanedAnything) {
            sourceDoc.close(SaveOptions.DONOTSAVECHANGES);
            sourceDoc = null;
            PREPARED_IMAGE_CACHE[key] = sourceFile;
            return sourceFile;
        }

        tempFile = new File(
            Folder.temp.fsName +
            "/_slider_compact_" +
            Math.round(Math.random() * 1e9) +
            ".psd"
        );

        saveCompactPSD(sourceDoc, tempFile);

        sourceDoc.close(SaveOptions.DONOTSAVECHANGES);
        sourceDoc = null;

        PREPARED_IMAGE_FILES.push(tempFile);
        PREPARED_IMAGE_CACHE[key] = tempFile;

        return tempFile;

    } catch (e) {

        if (sourceDoc) {
            try {
                sourceDoc.close(SaveOptions.DONOTSAVECHANGES);
            } catch (closeErr) {}
        }

        if (tempFile && tempFile.exists) {
            try {
                tempFile.remove();
            } catch (removeErr) {}
        }

        // If cleanup fails for any reason, do not destroy the slider
        // workflow. Fall back to the original source.
        if (!PREPARED_IMAGE_INFO[key]) {
            PREPARED_IMAGE_INFO[key] = { hasNamedShadowLayer: false };
        }
        PREPARED_IMAGE_CACHE[key] = sourceFile;
        return sourceFile;

    } finally {

        app.displayDialogs = originalDialogs;
        app.preferences.rulerUnits = originalUnits;
    }
}

function findCompactTargets(container, out) {

    var layers = container.layers;

    for (var i = 0; i < layers.length; i++) {

        var layer = layers[i];

        if (layer.typename === "LayerSet") {
            if (!layer.visible) continue;
            findCompactTargets(layer, out);
            continue;
        }

        if (layer.typename !== "ArtLayer") continue;
        if (!layer.visible) continue;

        var name = cleanCompactName(layer.name);

        if (name === "main") {
            out.push({ layer: layer, type: "main" });
        } else if (name === "shadow") {
            out.push({ layer: layer, type: "shadow" });
        }
    }
}

function compactLayerForSlider(doc, layer, cleanupRadius, protectionMargin) {

    doc.activeLayer = layer;

    // QUALITY RULE:
    // Never rasterize a Smart Object, text layer, shape layer, etc. just to
    // run the compact-bounds cleanup. Rasterizing here would bake the layer
    // at its current displayed resolution and throw away the original
    // high-resolution Smart Object data before the slider even places it.
    //
    // Normal pixel layers can still be cleaned safely because they are
    // already raster data at the source PSD's native resolution.
    if (layer.kind !== LayerKind.NORMAL) {
        return false;
    }

    var lockState = unlockCompactLayer(layer);

    try {

        doc.activeLayer = layer;

        loadCompactTransparency();

        if (!compactSelectionExists(doc)) {
            doc.selection.deselect();
            return false;
        }

        if (cleanupRadius > 0) {
            try {
                doc.selection.contract(cleanupRadius);
            } catch (e1) {}
        }

        if (!compactSelectionExists(doc)) {
            doc.selection.deselect();
            return false;
        }

        var expansion = cleanupRadius + protectionMargin;

        if (expansion > 0) {
            try {
                doc.selection.expand(expansion);
            } catch (e2) {}
        }

        doc.selection.invert();

        try {
            doc.selection.clear();
        } catch (e3) {
            doc.selection.deselect();
            return false;
        }

        doc.selection.deselect();
        return true;

    } finally {
        restoreCompactLocks(layer, lockState);
    }
}

function loadCompactTransparency() {

    var setID = charIDToTypeID("setd");
    var d = new ActionDescriptor();

    var target = new ActionReference();
    target.putProperty(
        charIDToTypeID("Chnl"),
        charIDToTypeID("fsel")
    );

    d.putReference(charIDToTypeID("null"), target);

    var source = new ActionReference();
    source.putEnumerated(
        charIDToTypeID("Chnl"),
        charIDToTypeID("Chnl"),
        charIDToTypeID("Trsp")
    );

    d.putReference(charIDToTypeID("T   "), source);

    executeAction(setID, d, DialogModes.NO);
}

function compactSelectionExists(doc) {

    try {
        doc.selection.bounds;
        return true;
    } catch (e) {
        return false;
    }
}

function unlockCompactLayer(layer) {

    var s = {};

    try {
        s.allLocked = layer.allLocked;
        layer.allLocked = false;
    } catch (e) {}

    try {
        s.pixelsLocked = layer.pixelsLocked;
        layer.pixelsLocked = false;
    } catch (e2) {}

    try {
        s.positionLocked = layer.positionLocked;
        layer.positionLocked = false;
    } catch (e3) {}

    try {
        s.transparentPixelsLocked = layer.transparentPixelsLocked;
        layer.transparentPixelsLocked = false;
    } catch (e4) {}

    return s;
}

function restoreCompactLocks(layer, s) {

    try {
        if (s.transparentPixelsLocked !== undefined)
            layer.transparentPixelsLocked = s.transparentPixelsLocked;
    } catch (e) {}

    try {
        if (s.positionLocked !== undefined)
            layer.positionLocked = s.positionLocked;
    } catch (e2) {}

    try {
        if (s.pixelsLocked !== undefined)
            layer.pixelsLocked = s.pixelsLocked;
    } catch (e3) {}

    try {
        if (s.allLocked !== undefined)
            layer.allLocked = s.allLocked;
    } catch (e4) {}
}

function cleanCompactName(name) {
    return String(name).replace(/^\s+|\s+$/g, "").toLowerCase();
}

function saveCompactPSD(doc, file) {

    var opts = new PhotoshopSaveOptions();

    opts.layers = true;
    opts.alphaChannels = true;
    opts.annotations = true;
    opts.embedColorProfile = true;
    opts.spotColors = true;
    opts.maximizeCompatibility = true;

    doc.saveAs(file, opts, true, Extension.LOWERCASE);
}

function cleanupPreparedImageFiles() {

    for (var i = 0; i < PREPARED_IMAGE_FILES.length; i++) {

        try {
            if (PREPARED_IMAGE_FILES[i] &&
                PREPARED_IMAGE_FILES[i].exists) {
                PREPARED_IMAGE_FILES[i].remove();
            }
        } catch (e) {}
    }

    PREPARED_IMAGE_FILES = [];
    PREPARED_IMAGE_CACHE = {};
    PREPARED_IMAGE_INFO = {};
    EDITABLE_PSD_IMPORTS = [];
    SLIDER_PLACEMENT_SOURCES = [];
    SOURCE_VISIBLE_CONTENT_CACHE = {};
    SOURCE_CUT_CACHE = {};
}




function centerLayerInRegion(layer, regionLeft, regionTop, regionW, regionH) {
    var bounds = getSliderPlacementBounds(layer);
    var w = bounds.right - bounds.left;
    var h = bounds.bottom - bounds.top;

    if (w <= 0 || h <= 0) {
        throw new Error("Invalid layer dimensions while centering detail image.");
    }

    var targetLeft = regionLeft + (regionW - w) / 2;
    var targetTop = regionTop + (regionH - h) / 2;
    translateSliderPlacement(
        layer,
        targetLeft - bounds.left,
        targetTop - bounds.top
    );
}


function createCutClipBase(doc, cutHeight, baseName) {

    var revealBottom = CANVAS_SIZE - cutHeight;
    var oldActive = doc.activeLayer;
    var base = null;

    try {
        base = doc.artLayers.add();
        base.name = baseName || "Cut Area";
        doc.activeLayer = base;

        // Opaque pixels only in the visible top region. The clipped Smart Object
        // uses this alpha as its crop boundary, so no source pixels are destroyed.
        doc.selection.select([
            [new UnitValue(0, "px"), new UnitValue(0, "px")],
            [new UnitValue(CANVAS_SIZE, "px"), new UnitValue(0, "px")],
            [new UnitValue(CANVAS_SIZE, "px"), new UnitValue(revealBottom, "px")],
            [new UnitValue(0, "px"), new UnitValue(revealBottom, "px")]
        ]);

        var white = new SolidColor();
        white.rgb.red = 255;
        white.rgb.green = 255;
        white.rgb.blue = 255;

        doc.selection.fill(white, ColorBlendMode.NORMAL, 100, false);
        doc.selection.deselect();

        return base;
    } catch (e) {
        try { doc.selection.deselect(); } catch (ignore) {}
        if (base) {
            try { base.remove(); } catch (ignore2) {}
        }
        throw new Error("Could not create Cut Image clipping area: " + e.message);
    } finally {
        try { doc.activeLayer = oldActive; } catch (ignore3) {}
    }
}

function applyEditablePSDGroupCutClip(doc, sourceGroup, cutHeight, groupName) {

    var info = getEditablePSDImport(sourceGroup);
    if (!info || !info.mainLayer || !info.shadowLayer) return null;

    var base = null;

    try {
        base = createCutClipBase(doc, cutHeight, "Cut Area");
        moveItemInsideGroupSafe(base, sourceGroup);
        base.name = "Cut Area";

        // Keep the requested editable structure. Main and Shadow remain separate
        // layers; Cut Area only acts as a non-destructive clipping base.
        try { base.move(sourceGroup, ElementPlacement.PLACEATEND); } catch (e0) {}
        try { info.shadowLayer.move(base, ElementPlacement.PLACEBEFORE); } catch (e1) {}
        try { info.mainLayer.move(info.shadowLayer, ElementPlacement.PLACEBEFORE); } catch (e2) {}

        try { info.shadowLayer.grouped = true; } catch (clipShadowErr) {}
        try { info.mainLayer.grouped = true; } catch (clipMainErr) {}

        sourceGroup.name = groupName;
        doc.activeLayer = sourceGroup;
        return sourceGroup;

    } catch (e) {
        if (base) {
            try { base.remove(); } catch (removeErr) {}
        }
        throw new Error("Could not apply Cut Image crop to editable Main + Shadow group: " + e.message);
    }
}

function applyNonDestructiveCutClip(doc, mainLayer, shadowLayer, cutHeight, groupName) {

    var editableInfo = getEditablePSDImport(mainLayer);
    if (editableInfo && editableInfo.hasNamedShadowLayer) {
        return applyEditablePSDGroupCutClip(doc, mainLayer, cutHeight, groupName);
    }

    if (!doc || !mainLayer) {
        throw new Error("Missing document or Cut Image layer.");
    }

    var base = null;
    var group = null;

    try {
        // Create a 600 x (600-cutHeight) alpha base. The actual image remains
        // an untouched Smart Object; Photoshop only clips its DISPLAY to this base.
        base = createCutClipBase(doc, cutHeight, "Cut Area");

        // Keep the clipping base immediately under the visual layers.
        base.move(mainLayer, ElementPlacement.PLACEAFTER);

        if (shadowLayer) {
            shadowLayer.move(base, ElementPlacement.PLACEBEFORE);
            shadowLayer.grouped = true;
        }

        doc.activeLayer = mainLayer;
        mainLayer.grouped = true;

        group = doc.layerSets.add();
        group.name = groupName;

        base.name = "Cut Area";
        mainLayer.name = "Main";
        if (shadowLayer) shadowLayer.name = "Shadow";

        // Move base first, then clipped layers above it. Their clipping flags
        // remain intact inside the new group.
        base.move(group, ElementPlacement.INSIDE);
        if (shadowLayer) shadowLayer.move(group, ElementPlacement.INSIDE);
        mainLayer.move(group, ElementPlacement.INSIDE);

        try {
            base.move(group, ElementPlacement.PLACEATEND);
        } catch (orderErr0) {}
        if (shadowLayer) {
            try { shadowLayer.move(base, ElementPlacement.PLACEBEFORE); } catch (orderErr1) {}
        }
        try { mainLayer.move(group, ElementPlacement.PLACEATBEGINNING); } catch (orderErr2) {}

        // Re-assert clipping after moves because some Photoshop versions can
        // clear the grouped flag during layer re-parenting.
        try { mainLayer.grouped = true; } catch (clipErr1) {}
        if (shadowLayer) {
            try { shadowLayer.grouped = true; } catch (clipErr2) {}
        }

        doc.activeLayer = group;
        return group;

    } catch (e) {
        if (group) {
            try { group.remove(); } catch (ignore0) {}
        } else if (base) {
            try { base.remove(); } catch (ignore1) {}
        }

        throw new Error(
            "Could not apply the non-destructive Cut Image crop: " +
            e.message
        );
    }
}

function fitLayerToRegion(layer, regionLeft, regionTop, regionW, regionH, mode) {

    var b = getSliderPlacementBounds(layer);

    var w = b.right - b.left;
    var h = b.bottom - b.top;

    if (w <= 0 || h <= 0) {
        throw new Error("Invalid layer dimensions.");
    }

    var scale;

    // Placement is based ONLY on the actual visible item bounds. For normal
    // Detail this means the item must fit inside the 570x530 guide area and
    // one visible dimension should touch its guide when aspect ratio allows.
    if (mode === "fill") {
        scale = Math.max(regionW / w, regionH / h) * 100;
    } else {
        scale = Math.min(regionW / w, regionH / h) * 100;
    }

    resizeSliderPlacement(layer, scale, scale, AnchorPosition.MIDDLECENTER);

    b = getSliderPlacementBounds(layer);
    var newW = b.right - b.left;
    var newH = b.bottom - b.top;

    // STRICT FIT SAFETY:
    // Photoshop Smart Object/group transforms can round slightly differently
    // from the source analysis. Never allow a normal FIT item to cross the
    // dedicated Slider guides. If it does, shrink just enough to be contained.
    if (mode !== "fill" && (newW > regionW + 0.25 || newH > regionH + 0.25)) {
        var correction = Math.min(regionW / newW, regionH / newH, 1);
        if (correction < 1) {
            resizeSliderPlacement(
                layer,
                correction * 100,
                correction * 100,
                AnchorPosition.MIDDLECENTER
            );
            b = getSliderPlacementBounds(layer);
            newW = b.right - b.left;
            newH = b.bottom - b.top;
        }
    }

    var targetLeft = regionLeft + (regionW - newW) / 2;
    var targetTop = regionTop + (regionH - newH) / 2;

    translateSliderPlacement(layer, targetLeft - b.left, targetTop - b.top);

    // Final one-pixel-class clamp after translation. This uses visible Main
    // pixels, not the group/white source canvas, and keeps all four sides at or
    // inside the guide rectangle.
    if (mode !== "fill") {
        b = getSliderPlacementBounds(layer);
        var dx = 0;
        var dy = 0;
        var regionRight = regionLeft + regionW;
        var regionBottom = regionTop + regionH;

        if (b.left < regionLeft) dx += regionLeft - b.left;
        if (b.right > regionRight) dx -= b.right - regionRight;
        if (b.top < regionTop) dy += regionTop - b.top;
        if (b.bottom > regionBottom) dy -= b.bottom - regionBottom;

        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
            translateSliderPlacement(layer, dx, dy);
        }
    }

    liftEditablePSDShadowAfterPlacement(layer);
}



/* ============================================================
   UNIFIED DOCUMENT BUILD
   ============================================================ */

function countTotalImages(state) {
    // One complete Lineup set creates one final lineup image,
    // regardless of whether that lineup uses 2 photos or Four Cut's 4 photos.
    var lineupCount = state.lineupRows.length;
    return state.creative.length + lineupCount + state.detail.length;
}

function collectLineupsData(lineupRows) {

    var data = [];

    for (var i = 0; i < lineupRows.length; i++) {
        var row = lineupRows[i];

        data.push({
            photo1: row.photo1,
            photo2: row.photo2,
            photo3: row.photo3,
            photo4: row.photo4,
            shadow1: !!row.shadow1,
            shadow2: !!row.shadow2,
            shadow3: !!row.shadow3,
            shadow4: !!row.shadow4,
            variant1: row.variant1 || "",
            variant2: row.variant2 || "",
            variant3: row.variant3 || "",
            variant4: row.variant4 || ""
        });
    }

    return data;
}

function getUnifiedOutputOrder(state) {

    var order = [];
    var seen = {};

    function add(type, index) {

        index = parseInt(index, 10);
        if (isNaN(index) || index < 0) return;

        var max = 0;
        if (type === "creative") max = state.creative.length;
        else if (type === "lineup") max = state.lineupRows.length;
        else if (type === "detail") max = state.detail.length;
        else return;

        if (index >= max) return;

        var key = type + ":" + index;
        if (seen[key]) return;

        seen[key] = true;
        order.push({ type: type, index: index });
    }

    // Electron Overview can provide a custom mixed order such as:
    // Lineup -> Creative -> Creative -> Detail.
    if (state.outputOrder && state.outputOrder.length) {
        for (var o = 0; o < state.outputOrder.length; o++) {
            var item = state.outputOrder[o] || {};
            add(item.type, item.index);
        }
    }

    // Safety fallback: if an older Electron build sends no order, or if any
    // item is missing from the custom order, retain the original sequence for
    // those remaining items so nothing is silently skipped.
    var i;
    for (i = 0; i < state.creative.length; i++) add("creative", i);
    for (i = 0; i < state.lineupRows.length; i++) add("lineup", i);
    for (i = 0; i < state.detail.length; i++) add("detail", i);

    return order;
}

function buildUnifiedDocument(state, productCode) {

    var doc = app.documents.add(
        CANVAS_SIZE,
        CANVAS_SIZE,
        72,
        productCode,
        NewDocumentMode.RGB,
        DocumentFill.WHITE
    );

    var layerIndex = 1;
    var lineups = collectLineupsData(state.lineupRows);
    var outputOrder = getUnifiedOutputOrder(state);

    for (var outputIndex = 0; outputIndex < outputOrder.length; outputIndex++) {

        var output = outputOrder[outputIndex];

        // ---- CREATIVE ----
        if (output.type === "creative") {

            var c = output.index;
            var cLayer = placeSmartObject(doc, state.creative[c].file);
            cLayer.name = productCode + "_" + layerIndex;

            // Creative keeps the original slider rule: use the full 600x600 canvas.
            fitLayerToRegion(
                cLayer,
                0,
                0,
                CANVAS_SIZE,
                CANVAS_SIZE,
                "fill"
            );

            doc.activeLayer = cLayer;
            layerIndex++;
            continue;
        }

        // ---- LINEUP ----
        if (output.type === "lineup") {

            var i = output.index;
            var group;

            if (state.layoutMode === "horizontal") {
                // Horizontal = photos side by side.
                group = buildVerticalLineupGroup(doc, lineups[i], i);
            } else if (state.layoutMode === "vertical") {
                // Vertical = standard stacked photos.
                group = buildHorizontalLineupGroup(doc, lineups[i], i);
            } else if (state.layoutMode === "paVertical") {
                group = buildPaVerticalLineupGroup(doc, lineups[i], i);
            } else if (state.layoutMode === "fourCut") {
                group = buildFourCutGroup(doc, lineups[i], i);
            } else {
                group = buildVerticalLineupGroup(doc, lineups[i], i);
            }

            // Overview master order controls the final shared numbering.
            group.name = productCode + "_" + layerIndex;

            // Keep the next placed item outside this Lineup group.
            doc.activeLayer = group;

            layerIndex++;
            continue;
        }

        // ---- DETAIL ----
        if (output.type === "detail") {

            var d = output.index;
            var detailOutputName = productCode + "_" + layerIndex;
            var dLayer = placeSmartObject(doc, state.detail[d].file);
            dLayer.name = detailOutputName;

            // Detail has two placement modes:
            // 1) Normal Detail: 15/20/15/50px safe area (570x530), centered.
            // 2) Cut Image: scale/fill against the FULL 600x600 canvas, then
            //    hide the bottom 50px non-destructively.
            if (state.detail[d].isCut) {

                fitCutLayerToRegion(
                    dLayer,
                    state.detail[d].file,
                    DETAIL_CUT_LEFT,
                    DETAIL_CUT_TOP,
                    DETAIL_CUT_WIDTH,
                    DETAIL_CUT_HEIGHT
                );

                // Build the shadow from the visible portion only. This happens BEFORE
                // clipping so transparency can still be read directly from the Smart Object.
                var cutVisibleBottom = CANVAS_SIZE - DETAIL_CUT_BOTTOM_WHITE;
                var cutDetailShadow = null;

                if (shouldApplyGeneratedShadow(
                    state.detail[d],
                    state.detail[d].hasShadow
                )) {
                    cutDetailShadow = createBottomContactShadow(
                        dLayer,
                        cutVisibleBottom
                    );
                }

                if (cutDetailShadow) {
                    alignDetailShadowToItem(dLayer, cutDetailShadow);
                }

                // Non-destructive crop: Smart Object stays high-resolution and editable.
                applyNonDestructiveCutClip(
                    doc,
                    dLayer,
                    cutDetailShadow,
                    DETAIL_CUT_BOTTOM_WHITE,
                    detailOutputName
                );

            } else {

                fitLayerToRegion(
                    dLayer,
                    CREATIVE_DETAIL_LEFT,
                    CREATIVE_DETAIL_TOP,
                    CREATIVE_DETAIL_WIDTH,
                    CREATIVE_DETAIL_HEIGHT,
                    "fit"
                );

                var detailShadow = applyConfiguredShadowIfNeeded(
                    state.detail[d],
                    dLayer,
                    state.detail[d].hasShadow
                );

                if (detailShadow) {

                    alignDetailShadowToItem(dLayer, detailShadow);

                    groupDetailItemWithShadow(
                        doc,
                        dLayer,
                        detailShadow,
                        detailOutputName
                    );

                } else {

                    dLayer.name = detailOutputName;
                    doc.activeLayer = dLayer;
                }
            }

            layerIndex++;
        }
    }

    return doc;
}


/* ============================================================
   UI — CREATIVE / DETAIL SECTION (Add / Remove / Move Up / Move Down)
   ------------------------------------------------------------
   CHANGED: this now renders directly into its parent tab instead of
   wrapping everything in an extra titled panel. The tab label already
   says "Creative" / "Detail", so the inner panel + border was just
   eating vertical space for no benefit. The listbox is also taller
   now that it has the whole tab to itself.
   ============================================================ */

function pickImages(title) {
    // Show all files. Photoshop will be responsible for determining which
    // selected files it can actually open.
    // Use a standard ExtendScript filter. A callback here can appear as
    // "FUNCTION (F)" in Photoshop's file-type dropdown on some versions.
    var files = File.openDialog(title, "All Files:*.*", true);
    if (!files) return [];

    // IMPORTANT: File.openDialog's multi-select does NOT preserve the
    // order you clicked files in — the OS hands them back in its own
    // internal order. There is no ExtendScript API to recover click
    // order, so instead we sort the batch naturally/numerically by
    // filename (e.g. "img2.jpg" before "img10.jpg") so the result is
    // at least predictable. Use the Move Up / Move Down buttons for
    // anything that still needs manual reordering.
    files.sort(function (a, b) {
        return naturalCompare(a.name, b.name);
    });

    return files;
}

// Numeric-aware "natural" sort comparator: splits each name into
// alternating text/number chunks and compares number chunks as
// numbers rather than strings, so "2" sorts before "10".
function naturalCompare(a, b) {

    var ax = [], bx = [];

    String(a).replace(/(\d+)|(\D+)/g, function (_, digits, other) {
        ax.push([digits ? parseInt(digits, 10) : Infinity, other || ""]);
    });

    String(b).replace(/(\d+)|(\D+)/g, function (_, digits, other) {
        bx.push([digits ? parseInt(digits, 10) : Infinity, other || ""]);
    });

    while (ax.length && bx.length) {
        var an = ax.shift();
        var bn = bx.shift();

        if (an[0] !== bn[0]) return an[0] - bn[0];
        if (an[1] !== bn[1]) return an[1] < bn[1] ? -1 : 1;
    }

    return ax.length - bx.length;
}

// Sets an ScriptUI "image" element's picture to a given File, safely.
function trySetPreviewImage(imageControl, file) {
    try {
        imageControl.image = file ? file : undefined;
        return true;
    } catch (e) {
        return false;
    }
}

/* ============================================================
   THUMBNAIL PREVIEW GENERATION
   ------------------------------------------------------------
   Why previews were showing "unsupported": ScriptUI's own image
   loader only reliably decodes plain RGB PNG/JPEG. Real product
   photos are frequently CMYK JPEGs (very common for print/e-comm
   assets), have embedded ICC profiles, or are simply too large —
   and any of those makes ScriptUI's built-in loader fail silently.
   Fix: let PHOTOSHOP do the decoding, including AVIF and WebP on
   Photoshop versions that support those formats. We open the source file, flatten it, force it to RGB,
   downscale it, and re-export a small plain PNG to a temp file —
   THAT temp PNG is what gets handed to ScriptUI, and it will always
   be a format ScriptUI can display.
   Trade-off: this is slower than a direct preview (each thumbnail
   briefly opens/closes a document in Photoshop), so there may be a
   short flicker/delay when adding several images at once — that is
   expected and is what makes the preview reliable.
   ============================================================ */

var GENERATED_THUMB_FILES = [];

function generateThumbnail(sourceFile, maxSize) {

    var originalDisplayDialogs = app.displayDialogs;
    app.displayDialogs = DialogModes.NO;

    var thumbDoc = null;
    var thumbFile = null;

    try {
        thumbDoc = app.open(sourceFile);

        if (thumbDoc.layers.length > 1) {
            thumbDoc.flatten();
        }

        if (thumbDoc.mode !== DocumentMode.RGB) {
            thumbDoc.changeMode(ChangeMode.RGB);
        }

        var w = thumbDoc.width.as("px");
        var h = thumbDoc.height.as("px");
        var scale = Math.min(maxSize / w, maxSize / h, 1);

        if (scale < 1) {
            thumbDoc.resizeImage(
                new UnitValue(Math.max(1, Math.round(w * scale)), "px"),
                new UnitValue(Math.max(1, Math.round(h * scale)), "px"),
                thumbDoc.resolution,
                ResampleMethod.BICUBIC
            );
        }

        var tempName = "_psdgen_thumb_" + Math.round(Math.random() * 1e9) + ".png";
        thumbFile = new File(Folder.temp + "/" + tempName);

        thumbDoc.saveAs(thumbFile, new PNGSaveOptions(), true, Extension.LOWERCASE);

        GENERATED_THUMB_FILES.push(thumbFile);

    } catch (thumbErr) {
        thumbFile = null;
    } finally {
        if (thumbDoc) {
            try {
                thumbDoc.close(SaveOptions.DONOTSAVECHANGES);
            } catch (closeErr) {}
        }
        app.displayDialogs = originalDisplayDialogs;
    }

    return thumbFile;
}

// Best-effort cleanup of the temp PNGs created for previews. Safe to
// call multiple times; missing/already-removed files are ignored.
function cleanupGeneratedThumbs() {
    for (var i = 0; i < GENERATED_THUMB_FILES.length; i++) {
        try {
            if (GENERATED_THUMB_FILES[i].exists) {
                GENERATED_THUMB_FILES[i].remove();
            }
        } catch (e) {}
    }
    GENERATED_THUMB_FILES = [];
}

function buildSimpleSection(parent, title, list, onChange) {

    var label = parent.add("statictext", undefined, title + " Images");
    label.graphics.font = ScriptUI.newFont(label.graphics.font.name, "Bold", label.graphics.font.size);

    if (title === "Detail") {
        var detailHelp = parent.add(
            "statictext",
            undefined,
            "Normal Detail: 570x530 safe area.  Cut Image: visible pixels fit/maximize within 600x550, cut sides flush to their edge, with 50px white space at the bottom.",
            { multiline: true }
        );
        detailHelp.alignment = "fill";
        detailHelp.preferredSize.height = 32;
    }

    // Body: list + buttons on the left, a larger live preview on the right.
    var body = parent.add("group");
    body.orientation = "row";
    body.alignChildren = ["fill", "top"];
    body.alignment = "fill";
    body.spacing = 10;

    var listColumn = body.add("group");
    listColumn.orientation = "column";
    listColumn.alignChildren = "fill";
    listColumn.alignment = ["fill", "fill"];

    var listBox = listColumn.add("listbox", undefined, []);
    listBox.alignment = "fill";
    // Taller now that this section has the full tab to itself instead
    // of a squeezed third of the dialog.
    listBox.preferredSize.height = 300;

    var btnRow1 = listColumn.add("group");
    btnRow1.orientation = "row";
    btnRow1.alignChildren = "fill";
    btnRow1.alignment = "fill";

    var addBtn = btnRow1.add("button", undefined, "Add");
    var addCutBtn = null;
    if (title === "Detail") {
        addCutBtn = btnRow1.add("button", undefined, "Add Cut Image");
    }
    var removeBtn = btnRow1.add("button", undefined, "Remove");

    var btnRow2 = listColumn.add("group");
    btnRow2.orientation = "row";
    btnRow2.alignChildren = "fill";
    btnRow2.alignment = "fill";

    var upBtn = btnRow2.add("button", undefined, "Move Up");
    var downBtn = btnRow2.add("button", undefined, "Move Down");

    var shadowBtn = null;
    var allShadowBtn = null;
    var allShadowEnabled = false;

    if (title === "Detail") {
        var btnRow3 = listColumn.add("group");
        btnRow3.orientation = "row";
        btnRow3.alignChildren = "fill";
        btnRow3.alignment = "fill";

        // Individual Detail shadow control — preserved.
        shadowBtn = btnRow3.add("button", undefined, "Shadow On/Off");

        // Whole Detail shadow control — applies to every Detail image.
        allShadowBtn = btnRow3.add("button", undefined, "All Shadow: OFF");
    }

    // ---- Live preview panel ----
    var previewPanel = body.add("panel", undefined, "Preview");
    previewPanel.orientation = "column";
    previewPanel.alignChildren = "center";
    previewPanel.alignment = ["right", "fill"];
    previewPanel.preferredSize.width = 200;
    previewPanel.margins = 10;

    var previewImage = previewPanel.add("image", undefined, undefined);
    previewImage.preferredSize = [180, 180];

    var previewLabel = previewPanel.add("statictext", undefined, "No image selected", { multiline: true });
    previewLabel.alignment = "fill";
    previewLabel.preferredSize.height = 45;

    // entry = { file, name, fsName, thumb } — thumb is the generated
    // preview-safe PNG (or null if generation failed for that file).
    function showPreview(entry) {
        if (!entry) {
            trySetPreviewImage(previewImage, null);
            previewLabel.text = "No image selected";
            return;
        }
        var suffix = "";
        if (title === "Detail" && entry.isCut) suffix += " [CUT]";
        if (title === "Detail" && entry.hasShadow) suffix += " [SHADOW]";

        if (entry.thumb) {
            trySetPreviewImage(previewImage, entry.thumb);
            previewLabel.text = entry.name + suffix;
        } else {
            trySetPreviewImage(previewImage, null);
            previewLabel.text = entry.name + suffix + " (preview unavailable)";
        }
    }

    function refreshAllShadowButton() {
        if (!allShadowBtn) return;

        // When there are no Detail images yet, preserve the toggle state so
        // newly added Detail images can inherit ALL SHADOW = ON.
        if (list.length === 0) {
            allShadowBtn.text = allShadowEnabled
                ? "All Shadow: ON"
                : "All Shadow: OFF";
            return;
        }

        var shadowCount = 0;
        for (var s = 0; s < list.length; s++) {
            if (list[s].hasShadow) shadowCount++;
        }

        if (shadowCount === list.length) {
            allShadowEnabled = true;
            allShadowBtn.text = "All Shadow: ON";
        } else if (shadowCount === 0) {
            allShadowEnabled = false;
            allShadowBtn.text = "All Shadow: OFF";
        } else {
            // Some images have shadow and some do not because of individual
            // toggling. Clicking the whole button from MIXED turns ALL ON.
            allShadowEnabled = false;
            allShadowBtn.text = "All Shadow: MIXED";
        }
    }

    // Small inline thumbnail per row, in addition to the big preview,
    // so you can see every added image at a glance without clicking
    // through the list one at a time.
    function refreshList() {
        listBox.removeAll();
        for (var i = 0; i < list.length; i++) {
            var label = list[i].name;
            if (title === "Detail" && list[i].isCut) {
                label += "   [CUT - 50px bottom]";
            }
            if (title === "Detail" && list[i].hasShadow) {
                label += "   [SHADOW]";
            }
            listBox.add("item", label);
        }

        refreshAllShadowButton();
    }

    listBox.onChange = function () {
        var idx = listBox.selection ? listBox.selection.index : -1;
        showPreview(idx === -1 ? null : list[idx]);
    };

    function addFilesWithMode(isCut) {
        var pickerTitle = title === "Detail" && isCut
            ? "Select Detail Cut Images"
            : "Select " + title + " Images";

        var files = pickImages(pickerTitle);

        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            list.push({
                file: f,
                name: f.name,
                fsName: f.fsName,
                thumb: generateThumbnail(f, 220),
                isCut: (title === "Detail" && isCut),
                // If Whole Detail Shadow is ON, newly added Detail images
                // automatically inherit shadow. Creative is unchanged.
                hasShadow: (title === "Detail" && allShadowEnabled)
            });
        }

        refreshList();

        // Jump the preview to the last file just added, so adding a
        // file gives you immediate visual confirmation of what it was.
        if (list.length > 0) {
            var lastIdx = list.length - 1;
            listBox.selection = lastIdx;
            showPreview(list[lastIdx]);
        }
        onChange();
    }

    addBtn.onClick = function () {
        addFilesWithMode(false);
    };

    if (addCutBtn) {
        addCutBtn.onClick = function () {
            addFilesWithMode(true);
        };
    }

    removeBtn.onClick = function () {
        var idx = listBox.selection ? listBox.selection.index : -1;
        if (idx === -1) return;

        var removed = list.splice(idx, 1)[0];
        if (removed && removed.thumb) {
            try {
                if (removed.thumb.exists) removed.thumb.remove();
            } catch (e) {}
        }

        refreshList();

        if (list.length > 0) {
            var newIdx = Math.min(idx, list.length - 1);
            listBox.selection = newIdx;
            showPreview(list[newIdx]);
        } else {
            showPreview(null);
        }
        onChange();
    };

    upBtn.onClick = function () {
        var idx = listBox.selection ? listBox.selection.index : -1;
        if (idx <= 0) return;
        var tmp = list[idx - 1];
        list[idx - 1] = list[idx];
        list[idx] = tmp;
        refreshList();
        listBox.selection = idx - 1;
        showPreview(list[idx - 1]);
    };

    downBtn.onClick = function () {
        var idx = listBox.selection ? listBox.selection.index : -1;
        if (idx === -1 || idx >= list.length - 1) return;
        var tmp = list[idx + 1];
        list[idx + 1] = list[idx];
        list[idx] = tmp;
        refreshList();
        listBox.selection = idx + 1;
        showPreview(list[idx + 1]);
    };

    if (shadowBtn) {
        shadowBtn.onClick = function () {
            var idx = listBox.selection ? listBox.selection.index : -1;
            if (idx === -1) return;

            list[idx].hasShadow = !list[idx].hasShadow;
            refreshList();
            listBox.selection = idx;
            showPreview(list[idx]);
            onChange();
        };
    }

    if (allShadowBtn) {
        allShadowBtn.onClick = function () {
            // Empty list: act as a mode toggle. The next Detail images added
            // will inherit this state.
            if (list.length === 0) {
                allShadowEnabled = !allShadowEnabled;
                refreshAllShadowButton();
                onChange();
                return;
            }

            var allCurrentlyOn = true;
            for (var i = 0; i < list.length; i++) {
                if (!list[i].hasShadow) {
                    allCurrentlyOn = false;
                    break;
                }
            }

            // If every image already has shadow -> turn all OFF.
            // If OFF or MIXED -> turn all ON.
            var newState = !allCurrentlyOn;

            for (var n = 0; n < list.length; n++) {
                list[n].hasShadow = newState;
            }

            allShadowEnabled = newState;

            var selectedIdx = listBox.selection ? listBox.selection.index : -1;
            refreshList();

            if (selectedIdx >= 0 && selectedIdx < list.length) {
                listBox.selection = selectedIdx;
                showPreview(list[selectedIdx]);
            }

            onChange();
        };
    }

    return { refreshList: refreshList };
}


/* ============================================================
   UI — LINEUP SECTION
   ------------------------------------------------------------
   CHANGED: renders directly into its parent tab (no redundant
   "Lineup" panel wrapper), and the editor panel is a bit taller
   since it no longer has to compete with Creative/Detail columns
   for horizontal space.
   ============================================================ */

function buildOverviewSection(parent, state, codeField) {

    var label = parent.add("statictext", undefined, "All Images — in PSD build order");
    label.graphics.font = ScriptUI.newFont(label.graphics.font.name, "Bold", label.graphics.font.size);

    var listBox = parent.add("listbox", undefined, []);
    listBox.alignment = "fill";
    listBox.preferredSize.height = 330;

    parent.add(
        "statictext",
        undefined,
        "Read-only. Use the Creative / Lineup / Detail tabs to add, remove, or reorder."
    );

    // Mirrors buildUnifiedDocument's actual layer-naming logic exactly:
    // Creative -> Lineup -> Detail share one running "<code>_N" counter.
    // Each complete Lineup group consumes exactly ONE number, even when
    // some or all slots are empty.
    function refresh() {

        listBox.removeAll();

        var code = trimStr(codeField.text) || "IMG";
        var layerIndex = 1;
        var hasAny = false;

        for (var c = 0; c < state.creative.length; c++) {
            listBox.add("item", code + "_" + layerIndex + "   [Creative]   " + state.creative[c].name);
            layerIndex++;
            hasAny = true;
        }

        for (var i = 0; i < state.lineupRows.length; i++) {

            var row = state.lineupRows[i];
            var parts = [];

            if (row.photo1 && row.photo1.name) parts.push(row.photo1.name + (row.shadow1 ? " [S]" : ""));
            if (row.photo2 && row.photo2.name) parts.push(row.photo2.name + (row.shadow2 ? " [S]" : ""));

            if (state.layoutMode === "fourCut") {
                if (row.photo3 && row.photo3.name) parts.push(row.photo3.name + (row.shadow3 ? " [S]" : ""));
                if (row.photo4 && row.photo4.name) parts.push(row.photo4.name + (row.shadow4 ? " [S]" : ""));
            }

            var modeLabel =
                state.layoutMode === "vertical" ? "Vertical - Stacked" :
                state.layoutMode === "paVertical" ? "PA Vertical" :
                state.layoutMode === "fourCut" ? "Four Cut" : "Horizontal - Side by Side";

            var text = code + "_" + layerIndex + "   [Lineup " + padLineupNumber(i + 1) + "]   (" + modeLabel + ")";
            if (parts.length > 0) text += "   " + parts.join(" / ");

            listBox.add("item", text);
            layerIndex++;
            hasAny = true;
        }

        for (var d = 0; d < state.detail.length; d++) {
            var detailLabel = code + "_" + layerIndex + "   [Detail]   " + state.detail[d].name;
            if (state.detail[d].isCut) detailLabel += "   [CUT - 50px bottom]";
            if (state.detail[d].hasShadow) detailLabel += "   [SHADOW]";
            listBox.add("item", detailLabel);
            layerIndex++;
            hasAny = true;
        }

        if (!hasAny) {
            listBox.add("item", "(No images added yet)");
        }
    }

    return { refresh: refresh };
}


function buildLineupSection(parent, dlg, state, onChange) {

    parent.add(
        "statictext",
        undefined,
        "Add lineups, then select one below to edit it."
    );

    var modePanel = parent.add("panel", undefined, "Layout");
    modePanel.orientation = "row";
    modePanel.alignChildren = "center";
    modePanel.margins = 6;

    var horizontalRadio = modePanel.add("radiobutton", undefined, "Horizontal - Side by Side");
    var verticalRadio = modePanel.add("radiobutton", undefined, "Vertical - Stacked");
    var paVerticalRadio = modePanel.add("radiobutton", undefined, "PA Vertical - Item / Item Detail / Color Name");
    var fourCutRadio = modePanel.add("radiobutton", undefined, "Four Cut");

    horizontalRadio.value = true;

    // Fixed-height lineup list. ScriptUI listboxes scroll automatically,
    // so adding more lineups never increases the dialog height.
    var lineupList = parent.add("listbox", undefined, []);
    lineupList.alignment = "fill";
    lineupList.preferredSize.height = 90;

    var listButtons = parent.add("group");
    listButtons.orientation = "row";

    var addBtn = listButtons.add("button", undefined, "+ Add Lineup");
    var removeBtn = listButtons.add("button", undefined, "Remove Lineup");

    // One reusable editor only. We load the selected lineup into these
    // controls instead of creating a new panel for every lineup.
    var editorPanel = parent.add("panel", undefined, "LINEUP 01");
    editorPanel.orientation = "column";
    editorPanel.alignChildren = "fill";
    editorPanel.margins = 7;
    // Taller than before to leave room for the new thumbnail previews
    // next to each "Choose Photo" button.
    editorPanel.preferredSize.height = 340;

    var currentIndex = -1;
    var loadingEditor = false;

    var photoControls = [];
    var variantFields = [];

    function updateLineupPhotoLabel(fileEntry, wantsShadow) {
        if (!fileEntry || !fileEntry.name) {
            return "No file selected";
        }

        return fileEntry.name + (wantsShadow ? "  [SHADOW]" : "");
    }

    function createPhotoEditorRow(container, number) {

        var group = container.add("group");
        group.orientation = "row";
        group.alignChildren = ["left", "center"];

        var thumb = group.add("image", undefined, undefined);
        thumb.preferredSize = [46, 46];

        var chooseBtn = group.add("button", undefined, "Choose Photo " + number + "...");
        var fileLabel = group.add("statictext", undefined, "No file selected");
        fileLabel.preferredSize.width = 220;
        var shadowCheck = group.add("checkbox", undefined, "Shadow");
        shadowCheck.value = false;

        function setThumb(fileEntry) {
            trySetPreviewImage(thumb, fileEntry && fileEntry.thumb ? fileEntry.thumb : null);
        }

        chooseBtn.onClick = function () {

            if (currentIndex < 0 || currentIndex >= state.lineupRows.length) return;

            // Do not restrict the picker to PNG/JPG/JPEG. Use the standard
            // All Files filter so AVIF, WebP and other supported formats can be selected.
            var f = File.openDialog("Choose Photo " + number, "All Files:*.*");

            if (f) {
                var entry = {
                    file: f,
                    name: f.name,
                    fsName: f.fsName,
                    thumb: generateThumbnail(f, 120)
                };

                state.lineupRows[currentIndex]["photo" + number] = entry;

                fileLabel.text = updateLineupPhotoLabel(entry, !!state.lineupRows[currentIndex]["shadow" + number]);
                setThumb(entry);
                refreshLineupList(currentIndex);
                onChange();
            }
        };


        shadowCheck.onClick = function () {
            if (loadingEditor) return;
            if (currentIndex < 0 || currentIndex >= state.lineupRows.length) return;

            state.lineupRows[currentIndex]["shadow" + number] = shadowCheck.value;
            var currentPhoto = state.lineupRows[currentIndex]["photo" + number];
            fileLabel.text = updateLineupPhotoLabel(currentPhoto, shadowCheck.value);
            refreshLineupList(currentIndex);
            onChange();
        };
        photoControls[number] = {
            group: group,
            chooseBtn: chooseBtn,
            fileLabel: fileLabel,
            shadowCheck: shadowCheck,
            setThumb: setThumb
        };
    }

    function createVariantEditorRow(container, number) {

        var group = container.add("group");
        group.orientation = "row";
        group.add("statictext", undefined, "Variant " + number + ":");

        var field = group.add("edittext", undefined, "");
        field.characters = 30;

        field.onChanging = function () {
            if (loadingEditor) return;
            if (currentIndex < 0 || currentIndex >= state.lineupRows.length) return;

            state.lineupRows[currentIndex]["variant" + number] = field.text;
        };

        variantFields[number] = {
            group: group,
            field: field
        };
    }

    createPhotoEditorRow(editorPanel, 1);
    createVariantEditorRow(editorPanel, 1);

    createPhotoEditorRow(editorPanel, 2);

    // Dedicated PA Vertical Color Name row. It is physically placed AFTER
    // Item and Item Detail. Normal modes keep using Variant 1 instead.
    var paVerticalColorGroup = editorPanel.add("group");
    paVerticalColorGroup.orientation = "row";
    paVerticalColorGroup.alignChildren = ["left", "center"];
    paVerticalColorGroup.visible = false;
    var paVerticalColorLabel = paVerticalColorGroup.add("statictext", undefined, "Color Name:");
    paVerticalColorLabel.preferredSize.width = 90;
    var paVerticalColorField = paVerticalColorGroup.add("edittext", undefined, "");
    paVerticalColorField.characters = 30;
    paVerticalColorField.onChanging = function () {
        if (loadingEditor) return;
        if (currentIndex < 0 || currentIndex >= state.lineupRows.length) return;
        state.lineupRows[currentIndex].variant1 = paVerticalColorField.text;
    };

    createVariantEditorRow(editorPanel, 2);

    createPhotoEditorRow(editorPanel, 3);
    createVariantEditorRow(editorPanel, 3);

    createPhotoEditorRow(editorPanel, 4);
    createVariantEditorRow(editorPanel, 4);

    function makeNewRow() {
        return {
            photo1: null,
            photo2: null,
            photo3: null,
            photo4: null,
            shadow1: false,
            shadow2: false,
            shadow3: false,
            shadow4: false,
            variant1: "",
            variant2: "",
            variant3: "",
            variant4: ""
        };
    }

    function getLineupListLabel(row, index) {

        var label = "LINEUP " + padLineupNumber(index + 1);
        var parts = [];

        if (row.photo1 && row.photo1.name) parts.push(row.photo1.name + (row.shadow1 ? " [S]" : ""));
        if (row.photo2 && row.photo2.name) parts.push(row.photo2.name + (row.shadow2 ? " [S]" : ""));

        if (parts.length > 0) {
            label += "  -  " + parts.join(" / ");
        }

        return label;
    }

    function refreshLineupList(selectIndex) {

        lineupList.removeAll();

        for (var i = 0; i < state.lineupRows.length; i++) {
            lineupList.add("item", getLineupListLabel(state.lineupRows[i], i));
        }

        if (state.lineupRows.length === 0) {
            currentIndex = -1;
            lineupList.selection = null;
            return;
        }

        if (selectIndex < 0) selectIndex = 0;
        if (selectIndex >= state.lineupRows.length) selectIndex = state.lineupRows.length - 1;

        currentIndex = selectIndex;
        lineupList.selection = selectIndex;
    }

    function updateEditorForLayout() {

        var isFourCut = state.layoutMode === "fourCut";
        var isPaVertical = state.layoutMode === "paVertical";

        photoControls[3].group.visible = isFourCut;
        variantFields[3].group.visible = isFourCut;
        photoControls[4].group.visible = isFourCut;
        variantFields[4].group.visible = isFourCut;

        // PA Vertical order must be exactly:
        //   1) Item
        //   2) Item Detail
        //   3) Color Name
        // Variant 1 remains the storage field internally, but its normal editor
        // row is hidden and the dedicated Color Name row is shown after Photo 2.
        variantFields[1].group.visible = !isPaVertical;
        variantFields[2].group.visible = !isPaVertical;
        paVerticalColorGroup.visible = isPaVertical;
        try {
            variantFields[1].group.children[0].text = "Variant 1:";
            photoControls[1].chooseBtn.text = isPaVertical ? "Choose Item..." : "Choose Photo 1...";
            photoControls[2].chooseBtn.text = isPaVertical ? "Choose Item Detail..." : "Choose Photo 2...";
        } catch (ignoreLabels) {}

        // Keep the editor height fixed even when controls are hidden/shown.
        editorPanel.preferredSize.height = 340;
        dlg.layout.layout(true);
    }

    function loadCurrentRow() {

        loadingEditor = true;

        var hasRow = currentIndex >= 0 && currentIndex < state.lineupRows.length;
        editorPanel.enabled = hasRow;
        removeBtn.enabled = hasRow;

        if (!hasRow) {
            editorPanel.text = "LINEUP";

            for (var n = 1; n <= 4; n++) {
                photoControls[n].fileLabel.text = "No file selected";
                photoControls[n].setThumb(null);
                photoControls[n].shadowCheck.value = false;
                variantFields[n].field.text = "";
            }
            paVerticalColorField.text = "";

            loadingEditor = false;
            return;
        }

        var row = state.lineupRows[currentIndex];
        editorPanel.text = "LINEUP " + padLineupNumber(currentIndex + 1);

        for (var i = 1; i <= 4; i++) {
            var photo = row["photo" + i];
            var wantsShadow = !!row["shadow" + i];
            photoControls[i].fileLabel.text = updateLineupPhotoLabel(photo, wantsShadow);
            photoControls[i].setThumb(photo);
            photoControls[i].shadowCheck.value = wantsShadow;
            variantFields[i].field.text = row["variant" + i] || "";
        }
        paVerticalColorField.text = row.variant1 || "";

        loadingEditor = false;
    }

    lineupList.onChange = function () {
        if (!lineupList.selection) return;
        currentIndex = lineupList.selection.index;
        loadCurrentRow();
    };

    addBtn.onClick = function () {

        state.lineupRows.push(makeNewRow());
        refreshLineupList(state.lineupRows.length - 1);
        loadCurrentRow();
        onChange();
    };

    removeBtn.onClick = function () {

        if (currentIndex < 0 || currentIndex >= state.lineupRows.length) return;

        var removedRow = state.lineupRows[currentIndex];
        for (var n = 1; n <= 4; n++) {
            var photo = removedRow["photo" + n];
            if (photo && photo.thumb) {
                try {
                    if (photo.thumb.exists) photo.thumb.remove();
                } catch (e) {}
            }
        }

        state.lineupRows.splice(currentIndex, 1);

        if (currentIndex >= state.lineupRows.length) {
            currentIndex = state.lineupRows.length - 1;
        }

        refreshLineupList(currentIndex);
        loadCurrentRow();
        onChange();
    };

    horizontalRadio.onClick = function () {
        state.layoutMode = "horizontal";
        updateEditorForLayout();
        onChange();
    };

    verticalRadio.onClick = function () {
        state.layoutMode = "vertical";
        updateEditorForLayout();
        onChange();
    };

    paVerticalRadio.onClick = function () {
        state.layoutMode = "paVertical";
        updateEditorForLayout();
        onChange();
    };

    fourCutRadio.onClick = function () {
        state.layoutMode = "fourCut";
        updateEditorForLayout();
        onChange();
    };

    // Seed with one lineup, matching the original startup behavior.
    state.lineupRows.push(makeNewRow());
    refreshLineupList(0);
    updateEditorForLayout();
    loadCurrentRow();
}


/* ============================================================
   MAIN DIALOG
   ------------------------------------------------------------
   CHANGED:
     - Creative / Lineup / Detail are now tabs (tabbedpanel) instead
       of three fixed-width columns crammed side by side. Each
       section now gets the dialog's full width and height.
     - dlg.resizeable = true, and dlg.maximumSize is capped to the
       actual screen bounds (via $.screens), so the dialog can never
       be taller or wider than the screen it opens on.
     - dlg.onResizing / dlg.onResize re-run layout so resizing the
       window doesn't leave stale/clipped control positions.
   ============================================================ */

function showUnifiedDialog() {

    var state = {
        creative: [],
        detail: [],
        lineupRows: [],
        layoutMode: "horizontal"
    };

    var dlg = new Window("dialog", "Creative / Lineup / Detail PSD Generator");
    dlg.orientation = "column";
    dlg.alignChildren = "fill";
    dlg.spacing = 8;
    dlg.margins = 12;

    // Resizable, and capped to the screen it's opening on — this is
    // the main fix for controls being cut off / unreachable.
    dlg.resizeable = true;

    try {
        var screenBounds = $.screens[0];
        dlg.maximumSize = [
            screenBounds.right - screenBounds.left - 80,
            screenBounds.bottom - screenBounds.top - 120
        ];
    } catch (screenErr) {
        // Fallback if $.screens isn't available in this host/version.
        dlg.maximumSize = [1200, 900];
    }

    // Only needs to be as wide as ONE section now, not all three.
    // A bit wider than before to fit the new Creative/Detail preview panel.
    dlg.preferredSize.width = 700;

    // ---- Header: Product Code | Total | Cancel | CREATE ----
    // CREATE stays at the TOP so it can never be pushed below the
    // visible area by the Lineup editor or an error message.
    var header = dlg.add("group");
    header.orientation = "row";
    header.alignChildren = ["left", "center"];
    header.alignment = "fill";
    header.spacing = 10;

    var codeGroup = header.add("group");
    codeGroup.orientation = "row";
    codeGroup.add("statictext", undefined, "Product Code:");
    var codeField = codeGroup.add("edittext", undefined, "");
    codeField.characters = 18;

    var totalText = header.add("statictext", undefined, "");
    totalText.preferredSize.width = 160;

    var headerSpacer = header.add("statictext", undefined, "");
    headerSpacer.alignment = ["fill", "center"];

    var cancelBtn = header.add("button", undefined, "Cancel", { name: "cancel" });
    var createBtn = header.add("button", undefined, "CREATE", { name: "ok" });

    function updateTotalCount() {
        var total = countTotalImages(state);
        totalText.text = "Total images: " + total + " / " + MAX_TOTAL_IMAGES;
    }

    // ---- Errors directly under the header ----
    // Hidden on startup, so it consumes no space until validation is needed.
    var errorText = dlg.add("statictext", undefined, "", { multiline: true });
    errorText.alignment = "fill";
    errorText.preferredSize.height = 55;
    errorText.visible = false;

    // ---- Main content: Creative | Lineup | Detail as TABS ----
    var tabs = dlg.add("tabbedpanel");
    tabs.alignChildren = "fill";
    tabs.alignment = "fill";

    var creativeTab = tabs.add("tab", undefined, "Creative");
    creativeTab.orientation = "column";
    creativeTab.alignChildren = "fill";
    creativeTab.margins = 10;

    var lineupTab = tabs.add("tab", undefined, "Lineup");
    lineupTab.orientation = "column";
    lineupTab.alignChildren = "fill";
    lineupTab.margins = 10;

    var detailTab = tabs.add("tab", undefined, "Detail");
    detailTab.orientation = "column";
    detailTab.alignChildren = "fill";
    detailTab.margins = 10;

    tabs.selection = creativeTab;

    // ---- Creative ----
    buildSimpleSection(creativeTab, "Creative", state.creative, updateTotalCount);

    // ---- Lineup ----
    buildLineupSection(lineupTab, dlg, state, updateTotalCount);

    // ---- Detail ----
    buildSimpleSection(detailTab, "Detail", state.detail, updateTotalCount);

    updateTotalCount();

    // ScriptUI bug workaround: controls added to a tab while it is NOT
    // the active tab (Lineup and Detail here, since Creative is selected
    // first) can end up with zero/stale layout bounds and simply fail to
    // render until something forces a relayout. Force one now, and force
    // one again every time the user switches tabs, so Detail (and Lineup)
    // actually draw their contents instead of appearing empty.
    tabs.onChange = function () {
        dlg.layout.layout(true);
        dlg.layout.resize();
    };

    dlg.layout.layout(true);
    dlg.layout.resize();

    // Re-run layout whenever the user drags the window to resize it,
    // so controls reflow instead of clipping.
    dlg.onResizing = dlg.onResize = function () {
        this.layout.resize();
    };

    cancelBtn.onClick = function () {
        cleanupGeneratedThumbs();
        cleanupPreparedImageFiles();
        dlg.close();
    };

    createBtn.onClick = function () {

        var errors = [];

        var productCode = trimStr(codeField.text);

        if (!productCode) {
            errors.push("Please enter a product code.");
        }

        var lineups = collectLineupsData(state.lineupRows);

        if (state.lineupRows.length > 0) {
            var lineupResult = validateLineups(lineups, state.layoutMode);
            if (!lineupResult.valid) {
                errors = errors.concat(lineupResult.errors);
            }
        }

        var total = countTotalImages(state);

        if (total === 0) {
            errors.push("Add at least one image (Creative, Lineup, or Detail).");
        }

        if (total > MAX_TOTAL_IMAGES) {
            errors.push(
                "Maximum " + MAX_TOTAL_IMAGES + " images total across Creative, " +
                "Lineup, and Detail. You currently have " + total + "."
            );
        }

        updateTotalCount();

        if (errors.length > 0) {
            errorText.text = errors.join("\n");
            errorText.visible = true;
            dlg.layout.layout(true);
            return;
        }

        errorText.visible = false;

        cleanupGeneratedThumbs();
        dlg.close();

        try {
            buildUnifiedDocument(state, productCode);
        } catch (e) {
            alert("Error building PSD: " + e.message + "  Line: " + e.line);
        } finally {
            cleanupPreparedImageFiles();
        }
    };

    // Belt-and-suspenders: some Photoshop/ScriptUI versions only compute
    // correct bounds for tab content once the window has actually been
    // shown, so force one more relayout right after show() fires.
    dlg.onShow = function () {
        dlg.layout.layout(true);
        dlg.layout.resize();
    };

    dlg.center();
    dlg.show();
}

main();