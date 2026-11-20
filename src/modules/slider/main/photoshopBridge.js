const fs = require("fs");
const path = require("path");
const os = require("os");
const { buildJsxLaunchVbs, runVbsScript, explainFailure } = require("../../../shared/photoshopCom");
const { writeJsxFile } = require("../../../shared/photoshopFiles");
const { withPhotoshopTask } = require("../../../shared/photoshopTaskQueue");

function jsxString(value) {
    return JSON.stringify(String(value));
}

function vbString(value) {
    return '"' + String(value).replace(/"/g, '""') + '"';
}

/**
 * Build the exact JSX written for Slider Maker. Kept pure so tests can parse
 * the complete generated worker before Adobe Photoshop is contacted.
 *
 * IMPORTANT: Escape error-prefix newlines as a JS string literal. A literal
 * newline inside "ERROR..." caused Photoshop 2027 JSX Error 4 at line 4060.
 */
function buildSliderWorkerJsx(scriptText, statusPath) {
    const cleanScript = String(scriptText)
        .replace(/^\uFEFF/, "")
        .replace(/^\s*#target\s+photoshop\s*/i, "");

    const jsx = `#target photoshop
app.bringToFront();

var __sliderDidWriteStatus = false;
function __sliderWriteStatus(text) {
    var f = new File(${jsxString(statusPath)});
    f.encoding = "UTF8";
    if (!f.open("w")) throw new Error("Could not write Slider status file.");
    f.write(String(text));
    f.close();
    __sliderDidWriteStatus = true;
}

try {
${cleanScript}
    if (!__sliderDidWriteStatus) __sliderWriteStatus("OK");
} catch (__sliderError) {
    var __sliderMessage = String(__sliderError && __sliderError.message ? __sliderError.message : __sliderError);
    try { if (__sliderError && __sliderError.line) __sliderMessage += " (JSX line " + __sliderError.line + ")"; } catch (__ignoreLine) {}
    __sliderWriteStatus(${jsxString("ERROR\n")} + __sliderMessage);
}
`;

    return jsx;
}

async function runPhotoshopScriptDirect(scriptText, label = "Photoshop task") {
    if (process.platform !== "win32") {
        throw new Error("Slider Maker Photoshop automation currently requires Windows.");
    }

    const workDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "slider-maker-photoshop-")
    );

    const jsxPath = path.join(workDir, "worker.jsx");
    const vbsPath = path.join(workDir, "launch.vbs");
    const statusPath = path.join(workDir, "status.txt");

    const jsx = buildSliderWorkerJsx(scriptText, statusPath);

    const vbs = buildJsxLaunchVbs(jsxPath, { variableName: "photoshopApp", reveal: true, receiptPath: statusPath });

    await writeJsxFile(jsxPath, jsx);
    await fs.promises.writeFile(vbsPath, "\uFEFF" + vbs, "utf16le");

    try {
        const processResult = await runVbsScript(vbsPath, { timeoutMs: 900000, rotFallback: { jsxPath, receiptPath: statusPath } });

        let status = "";
        try {
            status = (await fs.promises.readFile(statusPath, "utf8")).replace(/^\uFEFF/, "").trim();
        } catch (error) {
            const details = [processResult.stdout, processResult.stderr]
                .filter(Boolean)
                .join("\n");

            throw new Error(
                explainFailure(processResult, label) + (details ? `\n\n${details}` : "")
            );
        }

        if (/^ERROR(?:\s|$)/i.test(status)) {
            throw new Error(status.replace(/^ERROR\s*/i, "").trim());
        }

        if (processResult.code !== 0) {
            throw new Error(
                explainFailure(processResult, label)
            );
        }

        if (status !== "OK") throw new Error(`${label}: unexpected Photoshop status: ${status}`);
        return status;
    } finally {
        await fs.promises.rm(workDir, { recursive: true, force: true })
            .catch(() => {});
    }
}

function runPhotoshopScript(scriptText, label = "Photoshop task") {
    return withPhotoshopTask(label, () => runPhotoshopScriptDirect(scriptText, label));
}

module.exports = { runPhotoshopScript, buildSliderWorkerJsx };
