"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { app, ipcMain, shell } = require("electron");
const { WORKFLOW_RULES } = require("../../../shared/workflowConfig");
const { buildJsxLaunchVbs, runVbsScript, explainFailure, parseSuccessfulConnection, connectionAdvice } = require("../../../shared/photoshopCom");
const { writeJsxFile } = require("../../../shared/photoshopFiles");
const { withPhotoshopTask } = require("../../../shared/photoshopTaskQueue");
const { getComRegistration, findInstallations, formatReport } = require("./photoshopDiagnostics");
const { runCheck, readState, persistState, REPORT_FILE } = require("./compatibilityManager");
const { setPreferredMajor, validatePreferredMajor } = require("../../../shared/photoshopVersionPolicy");

const SHARED_RULES = Object.freeze({
    sliderShadow: {
        lowerRatio: WORKFLOW_RULES.slider.shadow.lowerRatio,
        opacity: WORKFLOW_RULES.slider.shadow.opacity,
        blurPx: WORKFLOW_RULES.slider.shadow.blur,
        offsetX: WORKFLOW_RULES.slider.shadow.offsetX,
        offsetY: WORKFLOW_RULES.slider.shadow.offsetY
    },
    amazon: {
        canvas: WORKFLOW_RULES.amazon.canvasSize,
        firstArea: WORKFLOW_RULES.amazon.firstImageArea.width,
        restArea: WORKFLOW_RULES.amazon.restImageArea.width,
        strictSlots: "1-8"
    },
    slider: {
        canvas: WORKFLOW_RULES.slider.canvasSize,
        detailCutVisibleHeight: WORKFLOW_RULES.slider.cutVisibleHeight,
        detailBottomWhite: WORKFLOW_RULES.slider.cutBottomWhite,
        maxOutputs: 18
    }
});

const DIAGNOSTIC_FILENAME = "photoshop-connection-diagnostic.txt";

function statusFileJsx(statusPath) {
    return `#target photoshop\nvar f = new File(${JSON.stringify(statusPath.replace(/\\/g, "/"))});\n` +
        `f.encoding = "UTF8";\n` +
        `if (!f.open("w")) throw new Error("BrandForge probe cannot write status file.");\n` +
        `f.write("OK");\n` +
        `f.close();\n`;
}

async function runPhotoshopProbe() {
    const result = { ok: false, version: "", method: "", invocationMethod: "", error: "", stdout: "", stderr: "" };
    if (process.platform !== "win32") {
        result.error = "Photoshop COM automation is supported by BrandForge on Windows only.";
    } else {
        const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-photoshop-probe-"));
        const launch = path.join(temp, "probe.vbs");
        const worker = path.join(temp, "probe.jsx");
        const status = path.join(temp, "status.txt");
        try {
            await writeJsxFile(worker, statusFileJsx(status));
            await fs.promises.writeFile(launch, "\uFEFF" + buildJsxLaunchVbs(worker, { receiptPath: status }), "utf16le");
            const processResult = await withPhotoshopTask("Photoshop connection test", () => runVbsScript(launch, { timeoutMs: 90000, rotFallback: { jsxPath: worker, receiptPath: status } }));
            result.stdout = processResult.stdout;
            result.stderr = processResult.stderr;
            const conn = parseSuccessfulConnection(processResult.stdout);
            if (conn) { result.version = conn.version; result.method = conn.method; result.invocationMethod = conn.invocationMethod || "DoJavaScriptFile"; }
            let reply = "";
            try { reply = (await fs.promises.readFile(status, "utf8")).replace(/^\uFEFF/, "").trim(); }
            catch (_) { /* NO STATUS indicates script failed or did not run */ }
            if (processResult.code === 0 && conn && reply === "OK") {
                result.ok = true;
            } else if (processResult.code !== 0) {
                result.error = explainFailure(processResult, "Photoshop connection test");
            } else {
                result.error = "Connected to Photoshop, but its JSX probe did not write a status file. " +
                    connectionAdvice("missing JSX status");
            }
        } catch (error) {
            result.error = error?.message || String(error);
        } finally {
            await fs.promises.rm(temp, { recursive: true, force: true }).catch(() => {});
        }
    }

    // Always write a local read-only diagnostic, even when Photoshop fails.
    try {
        const [registration, installations] = await Promise.all([getComRegistration(), findInstallations()]);
        const report = formatReport({ result, registration, installations });
        const diagnosticPath = path.join(app.getPath("userData"), DIAGNOSTIC_FILENAME);
        await fs.promises.mkdir(path.dirname(diagnosticPath), { recursive: true });
        await fs.promises.writeFile(diagnosticPath, report, "utf8");
        result.diagnosticPath = diagnosticPath;
        result.diagnosticDetails = report;
    } catch (error) {
        result.diagnosticDetails = `Diagnostic report could not be saved: ${error?.message || error}`;
    }
    return result;
}

// Restore the selected Photoshop version guard before any renderer can launch a job.
// This never edits the Windows registry or launches a Photoshop installation.
app.whenReady().then(async () => {
    try { setPreferredMajor((await readState(app.getPath("userData"))).preferredMajor); }
    catch (error) { console.warn("Compatibility preference not loaded:", error?.message || error); }
});

ipcMain.handle("settings:compat:get", async () => {
    const dataDir = app.getPath("userData");
    // Refresh quick inventory at every app launch. A Photoshop update can
    // replace the executable without changing the registered file path.
    await runCheck({ mode: "quick", userDataPath: dataDir });
    return readState(dataDir);
});

ipcMain.handle("settings:compat:set-preference", async (_event, major) => {
    const preferredMajor = validatePreferredMajor(major);
    const folder = app.getPath("userData");
    const state = await readState(folder);
    state.preferredMajor = preferredMajor;
    await persistState(folder, state);
    setPreferredMajor(preferredMajor);
    return { ok: true, preferredMajor, lastWorking: state.lastWorking,
        note: "The preference guards Photoshop version; it does not switch installations. Run the Live Test to verify." };
});

let compatibilityRunning = false;
ipcMain.handle("settings:compat:scan", async (_event, mode) => {
    if (mode !== "quick" && mode !== "full") throw new Error("Invalid compatibility test type.");
    if (compatibilityRunning) throw new Error("A Photoshop compatibility check is already running.");
    compatibilityRunning = true;
    try {
        return await runCheck({ mode, userDataPath: app.getPath("userData"),
            connectionProbe: runPhotoshopProbe });
    } finally { compatibilityRunning = false; }
});

ipcMain.handle("settings:compat:open-report", async () => {
    const filename = path.join(app.getPath("userData"), REPORT_FILE);
    if (!fs.existsSync(filename)) return { ok: false, error: "Run a Compatibility Manager scan first." };
    const error = await shell.openPath(filename);
    return error ? { ok: false, error } : { ok: true, path: filename };
});

ipcMain.handle("settings:get", async () => ({
    appName: app.getName(),
    appVersion: app.getVersion(),
    platform: process.platform,
    userDataPath: app.getPath("userData"),
    sharedRules: SHARED_RULES
}));

ipcMain.handle("settings:test-photoshop", runPhotoshopProbe);

ipcMain.handle("settings:open-photoshop-diagnostics", async () => {
    const file = path.join(app.getPath("userData"), DIAGNOSTIC_FILENAME);
    if (!fs.existsSync(file)) return { ok: false, error: "Run Test Photoshop first to generate a diagnostic report." };
    const error = await shell.openPath(file);
    return error ? { ok: false, error } : { ok: true, path: file };
});

ipcMain.handle("settings:open-user-data", async () => {
    const folder = app.getPath("userData");
    await fs.promises.mkdir(folder, { recursive: true });
    const error = await shell.openPath(folder);
    return error ? { ok: false, error } : { ok: true, path: folder };
});

ipcMain.handle("settings:reset-recent-folders", async () => {
    const names = ["dialog-state.json", "amazon-dialog-state.json"];
    const folder = app.getPath("userData");
    const removed = [];
    for (const name of names) {
        const file = path.join(folder, name);
        try {
            await fs.promises.unlink(file);
            removed.push(name);
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
    }
    return { ok: true, removed };
});
