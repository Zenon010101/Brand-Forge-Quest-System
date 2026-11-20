"use strict";

/**
 * Photoshop has a single active document and application-global preferences.
 * All BrandForge modules share this queue to prevent scripts from changing
 * each other's active document during a concurrent export or preview.
 * This is intentionally process-local; the app runs one Electron main process.
 */
let tail = Promise.resolve();
let activeLabel = "";
let waiting = 0;

function withPhotoshopTask(label, run) {
    if (typeof run !== "function") throw new TypeError("Photoshop task must be a function.");
    waiting += 1;
    const task = tail.then(async () => {
        waiting -= 1;
        activeLabel = String(label || "Photoshop task");
        try { return await run(); }
        finally { activeLabel = ""; }
    });
    // A failed job must not poison the queue.
    tail = task.then(() => {}, () => {});
    return task;
}

function queueState() { return { activeLabel, waiting }; }

module.exports = { withPhotoshopTask, queueState };
