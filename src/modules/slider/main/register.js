const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const {
    app,
    BrowserWindow,
    dialog,
    ipcMain
} = require("electron");

const { runPhotoshopScript } = require("./photoshopBridge");
const { buildJobScript } = require("./jobBuilder");
const { recordProductionEvent } = require("../../profile/main/service");

function safeFileName(value) {
    return (
        String(value || "")
            .trim()
            .replace(/[<>:"/\\|?*]+/g, "_")
            .replace(/[. ]+$/g, "") ||
        "SLIDER"
    );
}

function fileRecord(filePath) {
    const stat = fs.statSync(filePath);
    return {
        path: filePath,
        name: path.basename(filePath),
        extension: path.extname(filePath).toLowerCase(),
        size: stat.size,
        modifiedMs: stat.mtimeMs,
        url: pathToFileURL(filePath).href
    };
}

function getDialogStatePath() {
    return path.join(app.getPath("userData"), "dialog-state.json");
}

function loadDialogState() {
    try {
        const statePath = getDialogStatePath();
        if (!fs.existsSync(statePath)) return {};

        const raw = fs.readFileSync(statePath, "utf8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
        return {};
    }
}

function saveDialogState(patch) {
    try {
        const statePath = getDialogStatePath();
        const current = loadDialogState();
        const next = { ...current, ...patch };

        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        fs.writeFileSync(statePath, JSON.stringify(next, null, 2), "utf8");
    } catch (error) {
        // Remembering the last folder is a convenience feature only.
        // Never block the Slider Maker if Windows cannot save this setting.
    }
}

function usableDefaultPath(candidate) {
    if (!candidate) return undefined;

    try {
        const stat = fs.statSync(candidate);
        if (stat.isDirectory()) return candidate;
    } catch (error) {}

    return undefined;
}

async function pickFiles(multi) {
    const state = loadDialogState();

    const result = await dialog.showOpenDialog({
        title: multi ? "Select images" : "Select image",
        defaultPath: usableDefaultPath(state.lastImageFolder),
        properties: multi
            ? ["openFile", "multiSelections"]
            : ["openFile"]
    });

    if (result.canceled || !result.filePaths.length) return [];

    saveDialogState({
        lastImageFolder: path.dirname(result.filePaths[0])
    });

    return result.filePaths.map(fileRecord);
}

ipcMain.handle("slider:select-images", async () => pickFiles(true));
ipcMain.handle("slider:select-image", async () => {
    const files = await pickFiles(false);
    return files[0] || null;
});

ipcMain.handle("slider:select-output-folder", async () => {
    const state = loadDialogState();

    const result = await dialog.showOpenDialog({
        title: "Select PSD output folder",
        defaultPath: usableDefaultPath(
            state.lastOutputFolder || state.lastImageFolder
        ),
        properties: ["openDirectory"]
    });

    if (result.canceled || !result.filePaths.length) return null;

    saveDialogState({
        lastOutputFolder: result.filePaths[0]
    });

    return { folderPath: result.filePaths[0] };
});

ipcMain.handle("slider:generate", async (event, payload) => {
    const productCode = String(payload?.productCode || "").trim();
    if (!productCode) {
        return { ok: false, error: "Product Code is required." };
    }

    const brandName = String(payload?.brandName || "").trim();

    const job = {
        productCode,
        brandName,
        creative: Array.isArray(payload?.creative) ? payload.creative : [],
        detail: Array.isArray(payload?.detail) ? payload.detail : [],
        lineupRows: Array.isArray(payload?.lineupRows) ? payload.lineupRows : [],
        outputOrder: Array.isArray(payload?.outputOrder)
            ? payload.outputOrder
                .filter(item =>
                    item &&
                    ["creative", "lineup", "detail"].includes(item.type) &&
                    Number.isInteger(item.index) &&
                    item.index >= 0
                )
                .map(item => ({ type: item.type, index: item.index }))
            : [],
        layoutMode: ["horizontal", "vertical", "paVertical", "fourCut"].includes(payload?.layoutMode)
            ? payload.layoutMode
            : "horizontal",
        outputPsdPath: null
    };

    const outputFolder = payload?.outputFolder || null;
    if (outputFolder) {
        const outputPsdPath = path.join(
            outputFolder,
            `${safeFileName(productCode)}.psd`
        );

        await fs.promises.mkdir(outputFolder, { recursive: true });
        await fs.promises.unlink(outputPsdPath).catch(error => {
            if (error.code !== "ENOENT") throw error;
        });

        job.outputPsdPath = outputPsdPath;
    }

    event.sender.send("slider:progress", {
        status: "starting",
        message: "Starting Photoshop..."
    });

    try {
        const enginePath = path.join(__dirname, "../jsx/sliderEngine.jsx");
        const scriptText = buildJobScript(enginePath, job);

        event.sender.send("slider:progress", {
            status: "photoshop",
            message: "Photoshop is building the editable PSD..."
        });

        await runPhotoshopScript(scriptText, `${productCode} slider build`);

        const outputCount = job.creative.length + job.lineupRows.length + job.detail.length;
        const progression = await recordProductionEvent({
            kind: "slider",
            label: productCode,
            subtitle: brandName ? `${brandName} · Slider PSD` : "Slider PSD",
            brandNames: brandName ? [brandName] : [],
            itemCount: outputCount,
            outputFiles: job.outputPsdPath ? 1 : 0,
            outputPath: job.outputPsdPath,
            status: "success",
            xp: 20 + (outputCount * 2)
        });

        event.sender.send("slider:progress", {
            status: "complete",
            message: job.outputPsdPath
                ? "PSD generated and saved."
                : "PSD generated in Photoshop."
        });

        return {
            ok: true,
            outputPsdPath: job.outputPsdPath,
            productCode,
            progression
        };
    } catch (error) {
        const message = error?.message || String(error);

        event.sender.send("slider:progress", {
            status: "error",
            message
        });

        return {
            ok: false,
            error: message
        };
    }
});
