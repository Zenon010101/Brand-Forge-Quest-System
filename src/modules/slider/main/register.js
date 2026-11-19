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
const { suggestFromSlider, generateSliderCombine } = require("./combineFromSlider");

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

// Electron does not expose an OS file path directly to a sandboxed renderer File.
// The preload resolves files dragged from Explorer, and main validates the paths.
const DROP_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp",
    ".tif", ".tiff", ".psd", ".psb", ".avif", ".heic", ".heif", ".tga"]);
ipcMain.handle("slider:describe-dropped-files", async (_event, paths) => {
    const files = [], rejected = [], seen = new Set();
    if (!Array.isArray(paths) || paths.length > 300) throw new Error("Drop at most 300 image files at a time.");
    for (const candidate of paths) {
        if (typeof candidate !== "string" || !path.isAbsolute(candidate)) {
            rejected.push("Invalid file path"); continue;
        }
        const key = process.platform === "win32" ? candidate.toLowerCase() : candidate;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!DROP_IMAGE_EXTS.has(path.extname(candidate).toLowerCase())) {
            rejected.push(`${path.basename(candidate)}: unsupported image type`); continue;
        }
        try {
            const stat = await fs.promises.stat(candidate);
            if (!stat.isFile()) throw new Error("not a regular file");
            files.push(fileRecord(candidate));
        } catch (error) { rejected.push(`${path.basename(candidate)}: ${error.message}`); }
    }
    if (files.length) saveDialogState({ lastImageFolder: path.dirname(files[0].path) });
    return { files, rejected };
});

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


// New Brand Combine belongs to Slider Maker, not the Rakuten Standalone app.
// Only the selected Single and explicit reviewed Slider sections are exported.
ipcMain.handle("slider:combine:get-settings", () => {
    const state = loadDialogState();
    return { outputFolder: usableDefaultPath(state.lastSliderCombineOutputFolder) || null,
        singleFolder: usableDefaultPath(state.lastSliderCombineSingleFolder) || null };
});
ipcMain.handle("slider:combine:choose-single", async () => {
    const state = loadDialogState();
    const result = await dialog.showOpenDialog({
        title: "Select New Brand Single image",
        defaultPath: usableDefaultPath(state.lastSliderCombineSingleFolder || state.lastImageFolder),
        properties: ["openFile"],
        filters: [{ name: "All supported image formats", extensions: ["jpg","jpeg","png","webp","gif","bmp","tif","tiff","psd","psb","avif","heic","heif","svg","tga","jp2","j2k","exr","hdr","ppm","pgm","jpe","jfif"] }, { name: "All files", extensions: ["*"] }]
    });
    if (result.canceled || !result.filePaths.length) return null;
    saveDialogState({ lastSliderCombineSingleFolder: path.dirname(result.filePaths[0]) });
    return fileRecord(result.filePaths[0]);
});
ipcMain.handle("slider:combine:choose-output", async () => {
    const state = loadDialogState();
    const result = await dialog.showOpenDialog({
        title: "Choose folder for New Brand Combine JPEG, HTML and optional PSD",
        defaultPath: usableDefaultPath(state.lastSliderCombineOutputFolder || state.lastOutputFolder) || app.getPath("documents"),
        properties: ["openDirectory"]
    });
    if (result.canceled || !result.filePaths.length) return null;
    saveDialogState({ lastSliderCombineOutputFolder: result.filePaths[0] });
    return { folderPath: result.filePaths[0] };
});
ipcMain.handle("slider:combine:suggest", (_event, job) => suggestFromSlider(job));
ipcMain.handle("slider:combine:generate", async (event, payload) => {
    const send = progress => {
        try { if (!event.sender.isDestroyed()) event.sender.send("slider:combine:progress", progress); }
        catch (_) { /* caller receives final result */ }
    };
    try {
        const result = await generateSliderCombine(payload || {}, send);
        let progression = null;
        try {
            progression = await recordProductionEvent({
                kind: "combine", label: result.outputName,
                subtitle: "Slider -> New Brand Combine (JPEG + HTML)",
                brandNames: payload?.brandName ? [payload.brandName] : [],
                itemCount: result.lineupCount + result.detailCount + (payload?.singlePath ? 1 : 0),
                outputFiles: result.jpegPaths.length + 1 + (result.psdPath ? 1 : 0),
                outputPath: result.htmlPath, status: "success",
                xp: 20 + (result.lineupCount + result.detailCount) * 2
            });
        } catch (_) { /* saving the user's files is independent of EXP */ }
        return { ...result, progression };
    } catch (error) {
        send({ stage: "error", message: error.message || String(error) });
        return { ok: false, error: error.message || String(error) };
    }
});
ipcMain.handle("slider:combine:open-output", async (_event, folder) => {
    const saved = loadDialogState().lastSliderCombineOutputFolder;
    if (!saved || pathKey(folder) !== pathKey(saved)) throw new Error("Choose a New Brand Combine output folder first.");
    const error = await require("electron").shell.openPath(saved);
    if (error) throw new Error(error);
    return { ok: true };
});
