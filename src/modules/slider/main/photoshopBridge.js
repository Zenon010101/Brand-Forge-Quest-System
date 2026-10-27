const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

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

    const vbs = `
On Error Resume Next
Set photoshopApp = CreateObject("Photoshop.Application")
If Err.Number <> 0 Then
    WScript.Echo "Could not start Photoshop: " & Err.Description
    WScript.Quit 2
End If
Err.Clear
photoshopApp.Visible = True
photoshopApp.DoJavaScriptFile ${vbString(jsxPath)}
If Err.Number <> 0 Then
    WScript.Echo "Photoshop script error: " & Err.Description
    WScript.Quit 3
End If
WScript.Quit 0
`;

    await fs.promises.writeFile(jsxPath, jsx, "utf8");
    await fs.promises.writeFile(vbsPath, vbs, "utf8");

    try {
        const processResult = await new Promise((resolve, reject) => {
            const child = spawn(
                "cscript.exe",
                ["//nologo", vbsPath],
                { windowsHide: true }
            );

            let stdout = "";
            let stderr = "";

            child.stdout.on("data", data => { stdout += data.toString(); });
            child.stderr.on("data", data => { stderr += data.toString(); });
            child.on("error", reject);
            child.on("close", code => resolve({ code, stdout, stderr }));
        });

        let status = "";
        try {
            status = await fs.promises.readFile(statusPath, "utf8");
        } catch (error) {
            const details = [processResult.stdout, processResult.stderr]
                .filter(Boolean)
                .join("\n");

            throw new Error(
                `Photoshop did not return a result for ${label}.` +
                (details ? `\n\n${details}` : "")
            );
        }

        if (status.indexOf("ERROR") === 0) {
            throw new Error(status.replace(/^ERROR\s*/i, "").trim());
        }

        if (processResult.code !== 0) {
            throw new Error(
                `Photoshop bridge failed for ${label}.\n\n` +
                processResult.stdout + "\n" + processResult.stderr
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
