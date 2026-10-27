#target photoshop
// Preview of PSD / PSB sources. Never save or modify source PSDs.
(function () {
    var source = new File(FOLDER_LP_SOURCE);
    var dest = new File(FOLDER_LP_PREVIEW);
    var opened = null;
    var image = null;
    var closeOpened = false;
    if (!source.exists) throw new Error("Preview source does not exist");
    try {
        // Do not close the designer's original document if it was already open.
        for (var i = 0; i < app.documents.length; i++) {
            try {
                if (app.documents[i].fullName.fsName.toLowerCase() === source.fsName.toLowerCase()) {
                    opened = app.documents[i]; break;
                }
            } catch(ignoreName) {}
        }
        if (!opened) { opened = app.open(source); closeOpened = true; }
        image = opened.duplicate("BrandForge LP Folder - QC Preview", false);
        app.activeDocument = image;
        image.flatten();
        var w = Number(image.width.as("px"));
        var h = Number(image.height.as("px"));
        var ratio = Math.min(1, FOLDER_LP_MAX_EDGE / Math.max(w, h));
        if (ratio < 1) image.resizeImage(new UnitValue(Math.max(1, Math.round(w * ratio)), "px"),
            new UnitValue(Math.max(1, Math.round(h * ratio)), "px"), null, ResampleMethod.BICUBIC);
        image.saveAs(dest, new PNGSaveOptions(), true, Extension.LOWERCASE);
    } finally {
        try { if (image) image.close(SaveOptions.DONOTSAVECHANGES); } catch(ignoreImage) {}
        try { if (closeOpened && opened) opened.close(SaveOptions.DONOTSAVECHANGES); } catch(ignoreSource) {}
    }
})();
