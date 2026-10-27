"use strict";

/**
 * ipcMain.handle() requests from a module iframe share the BrowserWindow's
 * webContents with the parent shell. webContents.send() always targets the
 * main frame, not the module that invoked the handler. Route progress to the
 * invoking frame and never let navigation/closing cancel a batch.
 */
function sendProgressToRequestFrame(event, payload) {
    try {
        const frame = event && event.senderFrame;
        if (!frame || (typeof frame.isDestroyed === "function" && frame.isDestroyed())) return false;
        frame.send("remove-bg:progress", payload);
        return true;
    } catch (_) {
        // Final IPC invoke responses and the processor's queue snapshot are
        // authoritative even if the UI iframe is reloaded mid-process.
        return false;
    }
}

module.exports = { sendProgressToRequestFrame };
