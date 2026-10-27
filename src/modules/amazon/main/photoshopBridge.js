const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

function jsxString(value) {
    return JSON.stringify(String(value).replace(/\\/g, "/"));
}

function vbString(value) {
    return '"' + String(value).replace(/"/g, '""') + '"';
}

async function runPhotoshopJSX(body, label = "Photoshop task") {
    if (process.platform !== "win32") {
        throw new Error(`${label} requires Windows + Adobe Photoshop.`);
    }

    const workDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "amazon-photoshop-")
    );

    const jsxPath = path.join(workDir, "worker.jsx");
    const vbsPath = path.join(workDir, "launch.vbs");
    const statusPath = path.join(workDir, "status.txt");

    const jsx = `
#target photoshop
app.bringToFront();

var __oldDialogs = app.displayDialogs;
app.displayDialogs = DialogModes.NO;

function __writeStatus(text) {
    var f = new File(${jsxString(statusPath)});
    f.encoding = "UTF8";
    if (!f.open("w")) throw new Error("Could not write Photoshop status file.");
    f.write(String(text));
    f.close();
}

try {
${body}
    __writeStatus("OK");
} catch (e) {
    var message = "ERROR\\n" + String(e && e.message ? e.message : e);
    try {
        if (e && e.line) message += "\\nLine: " + e.line;
    } catch (ignoreLine) {}
    __writeStatus(message);
} finally {
    app.displayDialogs = __oldDialogs;
}
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

        status = status.replace(/^\uFEFF/, "").trim();

        if (/^ERROR(?:\r?\n|\s)/i.test(status)) {
            throw new Error(status.replace(/^ERROR\s*/i, "").trim());
        }

        if (processResult.code !== 0) {
            throw new Error(
                `Photoshop bridge failed for ${label}.\n\n` +
                processResult.stdout + "\n" + processResult.stderr
            );
        }

        if (status !== "OK") {
            throw new Error(`Unexpected Photoshop response for ${label}: ${status}`);
        }
    } finally {
        await fs.promises.rm(workDir, { recursive: true, force: true })
            .catch(() => {});
    }
}

/**
 * Amazon PSD/PSB preprocessing.
 *
 * This intentionally follows the production Photoshop rule supplied by the
 * user: open the PSD, hide the SECOND TOP-LEVEL layer, export the visible
 * composite to PNG, then close the source without saving. The original PSD is
 * never modified. In the team's normal PSD structure the second top-level
 * layer is the Shadow layer, so the exported PNG is the no-shadow product.
 *
 * If a source has only one top-level layer we still export it instead of
 * failing the entire Amazon batch.
 */
async function extractPsdNoShadowToPng(sourcePath, outputPng) {
    await fs.promises.mkdir(path.dirname(outputPng), { recursive: true });

    const body = `
var sourceDoc = null;
try {
    var sourceFile = new File(${jsxString(sourcePath)});
    if (!sourceFile.exists) throw new Error("Source PSD/PSB does not exist.");

    sourceDoc = app.open(sourceFile);

    if (sourceDoc.layers.length >= 2) {
        sourceDoc.layers[1].visible = false;
    }

    try {
        if (sourceDoc.mode !== DocumentMode.RGB) {
            sourceDoc.changeMode(ChangeMode.RGB);
        }
    } catch (ignoreMode) {}

    var pngOptions = new PNGSaveOptions();
    pngOptions.interlaced = false;

    sourceDoc.saveAs(
        new File(${jsxString(outputPng)}),
        pngOptions,
        true,
        Extension.LOWERCASE
    );
} finally {
    if (sourceDoc) {
        try { sourceDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreClose) {}
    }
}
`;

    await runPhotoshopJSX(body, "PSD no-shadow extraction");

    if (!fs.existsSync(outputPng)) {
        throw new Error("Photoshop did not create the no-shadow PSD PNG.");
    }

    return outputPng;
}

async function convertFileToPng(sourcePath, outputPng) {
    await fs.promises.mkdir(path.dirname(outputPng), { recursive: true });

    const body = `
var sourceDoc = null;
try {
    var sourceFile = new File(${jsxString(sourcePath)});
    if (!sourceFile.exists) throw new Error("Source file does not exist.");

    sourceDoc = app.open(sourceFile);

    try {
        if (sourceDoc.mode !== DocumentMode.RGB) {
            sourceDoc.changeMode(ChangeMode.RGB);
        }
    } catch (ignoreMode) {}

    try { sourceDoc.flatten(); } catch (ignoreFlatten) {}

    var pngOptions = new PNGSaveOptions();
    pngOptions.interlaced = false;
    sourceDoc.saveAs(
        new File(${jsxString(outputPng)}),
        pngOptions,
        true,
        Extension.LOWERCASE
    );
} finally {
    if (sourceDoc) {
        try { sourceDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreClose) {}
    }
}
`;

    await runPhotoshopJSX(body, "image conversion");

    if (!fs.existsSync(outputPng)) {
        throw new Error("Photoshop did not create the converted PNG.");
    }

    return outputPng;
}

module.exports = {
    jsxString,
    runPhotoshopJSX,
    extractPsdNoShadowToPng,
    convertFileToPng
};
