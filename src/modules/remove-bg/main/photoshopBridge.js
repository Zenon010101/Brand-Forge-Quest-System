"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { buildJsxLaunchVbs, runVbsScript, explainFailure } = require("../../../shared/photoshopCom");
const { writeJsxFile } = require("../../../shared/photoshopFiles");
const { withPhotoshopTask } = require("../../../shared/photoshopTaskQueue");
const { WORKFLOW_RULES } = require("../../../shared/workflowConfig");

function jsxString(value) {
    return JSON.stringify(String(value).replace(/\\/g, "/"));
}

function vbsString(value) {
    return '"' + String(value).replace(/"/g, '""') + '"';
}

function jsxFromFile(filename, variables) {
    const jsx = fs.readFileSync(path.join(__dirname, "../jsx", filename), "utf8");
    const constants = Object.entries(variables).map(([key, value]) =>
        `var ${key} = ${typeof value === "number" ? String(value) : jsxString(value)};`
    );
    return constants.join("\n") + "\n" + jsx;
}

// Serialize *this module's* Photoshop calls. Preview generation cannot
// change the active Photoshop document while a cutout/PSD job is running.
let pendingPhotoshop = Promise.resolve();
function runPhotoshopJSX(scriptText, label, timeoutMs = 300000) {
    const task = pendingPhotoshop.then(() => withPhotoshopTask(label, () => runPhotoshopJSXDirect(scriptText, label, timeoutMs)));
    pendingPhotoshop = task.catch(() => {});
    return task;
}

async function runPhotoshopJSXDirect(scriptText, label, timeoutMs = 300000) {
    if (process.platform !== "win32") {
        throw new Error("This workflow requires Adobe Photoshop on Windows.");
    }
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "gws-removebg-"));
    const worker = path.join(dir, "worker.jsx");
    const launch = path.join(dir, "launch.vbs");
    const statusFile = path.join(dir, "status.txt");
    const body = String(scriptText).replace(/^\uFEFF/, "").replace(/^\s*#target\s+photoshop\s*/i, "");
    const wrapped = `#target photoshop\n` +
        `var __gwsOldDialogs = app.displayDialogs;\n` +
        `app.displayDialogs = DialogModes.NO;\n` +
        `function __gwsStatus(s) { var f = new File(${jsxString(statusFile)}); f.encoding = "UTF8"; if (!f.open("w")) throw new Error("Cannot write status"); f.write(String(s)); f.close(); }\n` +
        `try {\n${body}\n__gwsStatus("OK");\n` +
        `} catch (e) { var message = String(e && e.message ? e.message : e); try { if (e && e.line) message += " (JSX line " + e.line + ")"; } catch (ignore) {} __gwsStatus("ERROR\\n" + message); }\n` +
        `finally { app.displayDialogs = __gwsOldDialogs; }\n`;
    const vbs = buildJsxLaunchVbs(worker, { variableName: "ps", receiptPath: statusFile });
    await writeJsxFile(worker, wrapped);
    await fs.promises.writeFile(launch, "\uFEFF" + vbs, "utf16le");

    try {
        const result = await runVbsScript(launch, { timeoutMs, rotFallback: { jsxPath: worker, receiptPath: statusFile } });
        let status = "";
        try {
            status = (await fs.promises.readFile(statusFile, "utf8")).replace(/^\uFEFF/, "").trim();
        } catch (error) {
            throw new Error(`${label}: Photoshop did not send a result. ${explainFailure(result, label)}`.trim());
        }
        if (/^ERROR(?:\s|$)/.test(status)) throw new Error(status.slice(5).trim());
        if (result.code !== 0 || status !== "OK") {
            throw new Error(`${label} failed: ${explainFailure(result, label)} ${status}`.trim());
        }
    } finally {
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
}

async function removeBackgroundInPhotoshop(source, stagedPng) {
    return runPhotoshopJSX(jsxFromFile("removeBackground.jsx", {
        GWS_SOURCE: source,
        GWS_OUTPUT: stagedPng
    }), `Remove Background: ${path.basename(source)}`);
}

async function createShadowPsdInPhotoshop(png, stagedPsd) {
    const rules = WORKFLOW_RULES.slider.shadow;
    return runPhotoshopJSX(jsxFromFile("addShadow.jsx", {
        GWS_PNG: png,
        GWS_PSD: stagedPsd,
        GWS_LOWER_RATIO: rules.lowerRatio,
        GWS_OPACITY: rules.opacity,
        GWS_BLUR: rules.blur,
        GWS_OFFSET_X: rules.offsetX,
        GWS_OFFSET_Y: rules.offsetY
    }), `Add Shadow: ${path.basename(png)}`);
}

module.exports = { jsxFromFile, runPhotoshopJSX, removeBackgroundInPhotoshop, createShadowPsdInPhotoshop };
