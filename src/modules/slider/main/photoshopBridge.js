const fs = require("fs");
const path = require("path");
const os = require("os");
const { buildJsxLaunchVbs, runVbsScript, explainFailure } = require("../../../shared/photoshopCom");

function jsxString(value) {
    return JSON.stringify(String(value));
}

function vbString(value) {
    return '"' + String(value).replace(/"/g, '""') + '"';
}

async function runPhotoshopScript(scriptText, label = "Photoshop task") {
    if (process.platform !== "win32") {
        throw new Error("Slider Maker Photoshop automation currently requires Windows.");
    }

    const workDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "slider-maker-photoshop-")
    );

    const jsxPath = path.join(workDir, "worker.jsx");
    const vbsPath = path.join(workDir, "launch.vbs");
    const statusPath = path.join(workDir, "status.txt");

    const cleanScript = String(scriptText)
        .replace(/^\uFEFF/, "")
        .replace(/^\s*#target\s+photoshop\s*/i, "");

    const jsx = `#target photoshop
app.bringToFront();

function __sliderWriteStatus(text) {
    var f = new File(${jsxString(statusPath)});
    f.encoding = "UTF8";
    f.open("w");
    f.write(String(text));
    f.close();
}

${cleanScript}
`;

    const vbs = buildJsxLaunchVbs(jsxPath, { variableName: "photoshopApp", reveal: true });

    await fs.promises.writeFile(jsxPath, jsx, "utf8");
    await fs.promises.writeFile(vbsPath, "\uFEFF" + vbs, "utf16le");

    try {
        const processResult = await runVbsScript(vbsPath, { timeoutMs: 900000 });

        let status = "";
        try {
            status = await fs.promises.readFile(statusPath, "utf8");
        } catch (error) {
            const details = [processResult.stdout, processResult.stderr]
                .filter(Boolean)
                .join("\n");

            throw new Error(
                explainFailure(processResult, label) + (details ? `\n\n${details}` : "")
            );
        }

        if (status.indexOf("ERROR") === 0) {
            throw new Error(status.replace(/^ERROR\s*/i, "").trim());
        }

        if (processResult.code !== 0) {
            throw new Error(
                explainFailure(processResult, label)
            );
        }

        return status;
    } finally {
        await fs.promises.rm(workDir, { recursive: true, force: true })
            .catch(() => {});
    }
}

module.exports = {
    runPhotoshopScript
};
