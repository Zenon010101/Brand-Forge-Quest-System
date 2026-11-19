"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { app, ipcMain, shell } = require("electron");
const { WORKFLOW_RULES } = require("../../../shared/workflowConfig");
const { buildJsxLaunchVbs, runVbsScript, explainFailure, parseSuccessfulConnection, connectionAdvice } = require("../../../shared/photoshopCom");
const { getComRegistration, findInstallations, formatReport } = require("./photoshopDiagnostics");

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
    const result = { ok: false, version: "", method: "", error: "", stdout: "", stderr: "" };
    if (process.platform !== "win32") {
        result.error = "Photoshop COM automation is supported by BrandForge on Windows only.";
    } else {
        const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-ps2027-probe-"));
        const launch = path.join(temp, "probe.vbs");
        const worker = path.join(temp, "probe.jsx");
        const status = path.join(temp, "status.txt");
        try {
            await fs.promises.writeFile(worker, statusFileJsx(status), "utf8");
            await fs.promises.writeFile(launch, "\uFEFF" + buildJsxLaunchVbs(worker), "utf16le");
            const processResult = await runVbsScript(launch, { timeoutMs: 90000 });
            result.stdout = processResult.stdout;
            result.stderr = processResult.stderr;
            const conn = parseSuccessfulConnection(processResult.stdout);
            if (conn) { result.version = conn.version; result.method = conn.method; }
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
