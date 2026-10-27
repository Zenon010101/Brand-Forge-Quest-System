// Read-only preview of a Photoshop-only source (PSD/PSB/Camera HEIC/etc.).
var gwsOriginal = null;
var gwsWork = null;
var gwsOpened = false;
var gwsPrior = app.documents.length ? app.activeDocument : null;
try {
    var input = new File(GWS_PREVIEW_SOURCE);
    if (!input.exists) throw new Error("Preview source is missing.");
    for (var i = 0; i < app.documents.length; i++) {
        try {
            if (String(app.documents[i].fullName.fsName).toLowerCase() === String(input.fsName).toLowerCase()) {
                gwsOriginal = app.documents[i];
                break;
            }
        } catch (ignoreFile) {}
    }
    if (!gwsOriginal) { gwsOriginal = app.open(input); gwsOpened = true; }
    gwsWork = gwsOriginal.duplicate("__GWS_PREVIEW__", true);
    app.activeDocument = gwsWork;
    if (gwsWork.mode !== DocumentMode.RGB) gwsWork.changeMode(ChangeMode.RGB);
    if (gwsWork.bitsPerChannel !== BitsPerChannelType.EIGHT) gwsWork.bitsPerChannel = BitsPerChannelType.EIGHT;
    var p = new PNGSaveOptions(); p.interlaced = false;
    gwsWork.saveAs(new File(GWS_PREVIEW_OUTPUT), p, true, Extension.LOWERCASE);
} finally {
    if (gwsWork) { try { gwsWork.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreWork) {} }
    if (gwsOriginal && gwsOpened) { try { gwsOriginal.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreOriginal) {} }
    if (gwsPrior) { try { app.activeDocument = gwsPrior; } catch (ignoreFocus) {} }
}
