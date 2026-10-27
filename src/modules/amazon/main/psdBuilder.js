const fs = require("fs");
const path = require("path");
const { jsxString, runPhotoshopJSX } = require("./photoshopBridge");

function toJsxData(parentGroups) {
    return parentGroups.map(parent => ({
        name: parent.parentId,
        variants: (parent.variants || []).map(variant => ({
            name: variant.variantId,
            layers: (variant.layers || []).map(layer => ({
                file: layer.pngPath,
                name: layer.layerName
            }))
        }))
    }));
}

async function buildAmazonPsd(psdName, parentGroups, outputPsd) {
    if (!Array.isArray(parentGroups) || parentGroups.length === 0) {
        throw new Error("No successful variants available for PSD creation.");
    }

    await fs.promises.mkdir(path.dirname(outputPsd), { recursive: true });

    const data = JSON.stringify(toJsxData(parentGroups));

    const body = `
var doc = null;
var DATA = ${data};

function placeSmartObject(filePath) {
    var desc = new ActionDescriptor();
    desc.putPath(charIDToTypeID("null"), new File(filePath));
    desc.putEnumerated(
        charIDToTypeID("FTcs"),
        charIDToTypeID("QCSt"),
        charIDToTypeID("Qcsa")
    );
    executeAction(charIDToTypeID("Plc "), desc, DialogModes.NO);
    return app.activeDocument.activeLayer;
}

function forceEveryTopLevelLayerVisible(targetDoc) {
    for (var li = 0; li < targetDoc.layers.length; li++) {
        try {
            targetDoc.layers[li].visible = true;
        } catch (visibilityErr) {}
    }
}

try {
    doc = app.documents.add(
        1001,
        1001,
        72,
        ${jsxString(psdName)},
        NewDocumentMode.RGB,
        DocumentFill.WHITE
    );

    // FLAT TOP-LEVEL PSD ONLY.
    // No Parent groups and no Variant groups are created.
    //
    // IMPORTANT LAYER ORDER:
    // Photoshop places each newly embedded Smart Object ABOVE the current stack.
    // Therefore we place images in NORMAL forward order so the first Amazon image
    // remains at the BOTTOM, directly above Background:
    //
    // top    VARIANT_4
    //        VARIANT_3
    //        VARIANT_2
    // bottom VARIANT
    //        Background
    //
    // This also means later variants/parents naturally stack above earlier ones.
    for (var p = 0; p < DATA.length; p++) {
        var parentData = DATA[p];

        for (var v = 0; v < parentData.variants.length; v++) {
            var variantData = parentData.variants[v];

            for (var i = 0; i < variantData.layers.length; i++) {
                var layerData = variantData.layers[i];
                app.activeDocument = doc;

                var placed = placeSmartObject(layerData.file);
                placed.name = layerData.name;
                placed.visible = true;
            }
        }
    }

    // Photoshop can sometimes inherit visibility state during scripted placement.
    // Enforce eye icon ON for every top-level layer immediately before saving.
    forceEveryTopLevelLayerVisible(doc);

    var options = new PhotoshopSaveOptions();
    options.layers = true;
    options.embedColorProfile = true;
    options.maximizeCompatibility = true;

    doc.saveAs(
        new File(${jsxString(outputPsd)}),
        options,
        true,
        Extension.LOWERCASE
    );
} finally {
    if (doc) {
        try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreClose) {}
    }
}
`;

    await runPhotoshopJSX(body, `${psdName} PSD build`);

    if (!fs.existsSync(outputPsd)) {
        throw new Error(`Photoshop did not create ${path.basename(outputPsd)}.`);
    }

    return outputPsd;
}

module.exports = {
    buildAmazonPsd
};
