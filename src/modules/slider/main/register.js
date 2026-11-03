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
const { buildOpenSavedPsdScript } = require("./openSavedPsd");
const { recordProductionEvent } = require("../../profile/main/service");
const os = require("os");
const { randomUUID } = require("crypto");
const { getStoredLink } = require("../../project-location/main/register");
const { pathKey, assertMarkerSafe } = require("../../project-location/main/projectPaths");
const { publishGroup } = require("../../amazon/main/sharedExporter");

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

    // Always publish a real PSD before bringing it forward in Photoshop.
    // Leaving an unsaved/staged document active caused designers to Save As
    // over the production PSD manually and mistake temp documents for output.
    const outputFolder = payload?.outputFolder || null;
    if (!outputFolder) return { ok: false, error: "Select a Slider PSD output folder or link your Google Drive brand project before generating." };
    let linkedProject = null;
    let stageRoot = null;
    let finalPsdPath = null;
    let overwriteApproved = false;
    let retainStage = false;
    if (payload?.projectRoot) {
        try {
            linkedProject = getStoredLink(payload.projectRoot);
            if (!linkedProject.roles.slider?.folderPath ||
                pathKey(linkedProject.roles.slider.folderPath) !== pathKey(outputFolder)) {
                return { ok: false, error: "Slider destination differs from the verified G: project. Reapply the project or choose a folder manually." };
            }
        } catch (error) {
            return { ok: false, error: error.message || String(error) };
        }
    }
    if (outputFolder) {
        finalPsdPath = path.join(outputFolder, `${safeFileName(productCode)}.psd`);
        if (linkedProject) {
            try { assertMarkerSafe(linkedProject, "slider", finalPsdPath); }
            catch (error) { return { ok: false, error: error.message }; }
        }
        // Never let a completed PSD (especially a marker in G:) be removed
        // just because Photoshop or a shared-drive write subsequently fails.
        try {
            const stat = await fs.promises.lstat(finalPsdPath).catch(error => {
                if (error.code === "ENOENT") return null;
                throw error;
            });
            if (stat) {
                if (!stat.isFile() || stat.isSymbolicLink()) return { ok: false, error: "Slider output exists but is not a regular file." };
                const answer = await dialog.showMessageBox({
                    type: "question", title: "Existing Slider PSD",
                    message: `Replace existing ${path.basename(finalPsdPath)}?`,
                    detail: "A verified backup will be made before publishing. PSD location markers are protected.",
                    buttons: ["Replace Existing", "Cancel"], defaultId: 1, cancelId: 1, noLink: true
                });
                if (answer.response !== 0) return { ok: false, error: "Slider export canceled; existing PSD preserved." };
                overwriteApproved = true;
            }
            stageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-slider-stage-"));
            job.outputPsdPath = path.join(stageRoot, `${randomUUID()}.psd`);
        } catch (error) { return { ok: false, error: error.message || String(error) }; }
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
        if (finalPsdPath) {
            if (linkedProject) {
                // A second check prevents a template from being moved/renamed
                // into the chosen output path while Photoshop is running.
                const freshLink = getStoredLink(payload.projectRoot);
                assertMarkerSafe(freshLink, "slider", finalPsdPath);
            }
            await publishGroup([{ staged: job.outputPsdPath, name: path.basename(finalPsdPath) }], {
                outputFolder, backupFolder: path.join(stageRoot, "backups"),
                confirmedExistingPaths: overwriteApproved ? [path.basename(finalPsdPath)] : []
            });
            job.outputPsdPath = finalPsdPath;
        }

        // Reopen the verified published PSD. Staging files must never remain
        // as the active Photoshop document after a successful export.
        let openWarning = null;
        if (finalPsdPath) {
            event.sender.send("slider:progress", {
                status: "opening",
                message: "Opening the saved PSD in Photoshop..."
            });
            try {
                await runPhotoshopScript(buildOpenSavedPsdScript(finalPsdPath),
                    `${productCode} open published Slider PSD`);
            } catch (openError) {
                // The verified PSD was already saved. A UI/Photoshop failure to
                // open it must never misreport the completed export as failed.
                openWarning = `PSD saved at ${finalPsdPath}, but Photoshop could not open it automatically: ${openError.message || openError}`;
            }
        }

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
                ? (openWarning ? "PSD saved, but could not be opened automatically." : "Final saved PSD opened in Photoshop.")
                : "PSD generated in Photoshop."
        });

        return {
            ok: true,
            outputPsdPath: job.outputPsdPath,
            openedInPhotoshop: finalPsdPath ? !openWarning : true,
            openWarning,
            productCode,
            progression
        };
    } catch (error) {
        if (error?.retainStage) retainStage = true;
        const message = error?.message || String(error);

        event.sender.send("slider:progress", {
            status: "error",
            message
        });

        return {
            ok: false,
            error: message
        };
    } finally {
        if (stageRoot && !retainStage) await fs.promises.rm(stageRoot, { recursive: true, force: true }).catch(() => {});
    }
});
