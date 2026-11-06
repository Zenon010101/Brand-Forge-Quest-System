const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("workflowApp", {
    getAppInfo: () => ipcRenderer.invoke("app:get-info")
});

contextBridge.exposeInMainWorld("profileApp", {
    getSession: () => ipcRenderer.invoke("profile:get-session"),
    createAccount: payload => ipcRenderer.invoke("profile:create-account", payload || {}),
    login: payload => ipcRenderer.invoke("profile:login", payload || {}),
    logout: () => ipcRenderer.invoke("profile:logout"),
    getDashboard: () => ipcRenderer.invoke("profile:get-dashboard")
});

contextBridge.exposeInMainWorld("sliderApp", {
    version: "1.4.3-unified",
    selectImages: options => ipcRenderer.invoke("slider:select-images", options || {}),
    selectImage: options => ipcRenderer.invoke("slider:select-image", options || {}),
    selectOutputFolder: () => ipcRenderer.invoke("slider:select-output-folder"),
    generate: job => ipcRenderer.invoke("slider:generate", job),
    onProgress: callback => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on("slider:progress", listener);
        return () => ipcRenderer.removeListener("slider:progress", listener);
    }
});

contextBridge.exposeInMainWorld("amazonApp", {
    getVersion: () => ipcRenderer.invoke("amazon:get-app-version"),
    selectParentFolders: () => ipcRenderer.invoke("amazon:select-parent-folder"),
    selectOutputFolder: () => ipcRenderer.invoke("amazon:select-output-folder"),
    chooseBatchImages: () => ipcRenderer.invoke("amazon:choose-batch-images"),
    chooseImageFolder: () => ipcRenderer.invoke("amazon:choose-image-folder"),
    scanImageFolder: options => ipcRenderer.invoke("amazon:scan-image-folder", options || {}),
    inspectBatchImages: paths => ipcRenderer.invoke("amazon:inspect-batch-images", { paths }),
    getPathForFile: file => webUtils.getPathForFile(file),
    preflightBatch: payload => ipcRenderer.invoke("amazon:preflight-batch", payload),
    getFilePreview: filePath => ipcRenderer.invoke("amazon:get-file-preview", { filePath }),
    preflightSharing: payload => ipcRenderer.invoke("amazon:preflight-sharing", payload),
    startProcessing: payload => ipcRenderer.invoke("amazon:start-processing", payload),
    offerColorbox: jobId => ipcRenderer.invoke("amazon:offer-colorbox", { jobId }),
    onProcessingProgress: callback => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on("amazon:processing-progress", handler);
        return () => ipcRenderer.removeListener("amazon:processing-progress", handler);
    }
});

contextBridge.exposeInMainWorld("settingsApp", {
    get: () => ipcRenderer.invoke("settings:get"),
    testPhotoshop: () => ipcRenderer.invoke("settings:test-photoshop"),
    openUserData: () => ipcRenderer.invoke("settings:open-user-data"),
    resetRecentFolders: () => ipcRenderer.invoke("settings:reset-recent-folders")
});


contextBridge.exposeInMainWorld("removeBgApp", {
    selectImages: () => ipcRenderer.invoke("remove-bg:select-images"),
    addPaths: paths => ipcRenderer.invoke("remove-bg:add-paths", paths),
    forget: paths => ipcRenderer.invoke("remove-bg:forget", paths),
    getState: () => ipcRenderer.invoke("remove-bg:get-state"),
    getPathForFile: file => webUtils.getPathForFile(file),
    getPreview: (filePath, maxEdge) => ipcRenderer.invoke("remove-bg:get-preview", { filePath, maxEdge }),
    removeBackground: payload => ipcRenderer.invoke("remove-bg:remove-background", payload),
    addShadow: payload => ipcRenderer.invoke("remove-bg:add-shadow", payload),
    onProgress: callback => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on("remove-bg:progress", handler);
        return () => ipcRenderer.removeListener("remove-bg:progress", handler);
    }
});


contextBridge.exposeInMainWorld("landingPageApp", {
    selectScreenshots: () => ipcRenderer.invoke("landing-page:select-screenshots"),
    selectSingle: () => ipcRenderer.invoke("landing-page:select-single"),
    selectOutput: () => ipcRenderer.invoke("landing-page:select-output"),
    validateFiles: payload => ipcRenderer.invoke("landing-page:validate-files", payload),
    analyze: payload => ipcRenderer.invoke("landing-page:analyze", payload),
    getAnalysis: () => ipcRenderer.invoke("landing-page:get-analysis"),
    preview: payload => ipcRenderer.invoke("landing-page:preview", payload),
    generate: payload => ipcRenderer.invoke("landing-page:generate", payload),
    discard: () => ipcRenderer.invoke("landing-page:discard"),
    getPathForFile: file => webUtils.getPathForFile(file),
    onProgress: callback => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on("landing-page:progress", listener);
        return () => ipcRenderer.removeListener("landing-page:progress", listener);
    }
});


contextBridge.exposeInMainWorld("lpFolderApp", {
    chooseFolder: () => ipcRenderer.invoke("lp-folder:choose-folder"),
    refresh: () => ipcRenderer.invoke("lp-folder:refresh"),
    getState: () => ipcRenderer.invoke("lp-folder:get-state"),
    preview: payload => ipcRenderer.invoke("lp-folder:preview", payload || {}),
    layout: payload => ipcRenderer.invoke("lp-folder:layout", payload || {}),
    generate: payload => ipcRenderer.invoke("lp-folder:generate", payload || {}),
    openOutput: () => ipcRenderer.invoke("lp-folder:open-output"),
    onProgress: callback => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on("lp-folder:progress", listener);
        return () => ipcRenderer.removeListener("lp-folder:progress", listener);
    }
});


contextBridge.exposeInMainWorld("brandProjectApp", {
    last: () => ipcRenderer.invoke("brand-project:last"),
    chooseRoot: () => ipcRenderer.invoke("brand-project:choose-root"),
    scan: root => ipcRenderer.invoke("brand-project:scan", { root }),
    link: (root, selectedMarkers) => ipcRenderer.invoke("brand-project:link", { root, selectedMarkers })
});


contextBridge.exposeInMainWorld("combineApp", {
    chooseCleanupFiles: () => ipcRenderer.invoke("combine:cleanup-choose-files"),
    addDownloadedToCleanup: () => ipcRenderer.invoke("combine:cleanup-add-downloaded"),
    scanCleanup: filePath => ipcRenderer.invoke("combine:cleanup-scan", filePath),
    previewCleanup: data => ipcRenderer.invoke("combine:cleanup-preview", data),
    saveCleanup: data => ipcRenderer.invoke("combine:cleanup-save", data),
    scanRakuten: data => ipcRenderer.invoke("combine:rakuten-scan", data),
    chooseRakutenFolder: () => ipcRenderer.invoke("combine:rakuten-choose-folder"),
    downloadRakuten: (folder, options = {}) => ipcRenderer.invoke("combine:rakuten-download", {folder,autoClean:options.autoClean === true}),
    openRakutenFolder: () => ipcRenderer.invoke("combine:rakuten-open-folder"),
    previewRakuten: (index, options = {}) => ipcRenderer.invoke("combine:rakuten-preview", {index,original:options.original === true}),
    onRakutenProgress: callback => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on("combine:rakuten-progress", handler);
        return () => ipcRenderer.removeListener("combine:rakuten-progress", handler);
    },
    chooseFiles: section => ipcRenderer.invoke("combine:choose-files", section),
    addPaths: paths => ipcRenderer.invoke("combine:add-paths", paths),
    getPathForFile: file => webUtils.getPathForFile(file),
    getState: () => ipcRenderer.invoke("combine:get-state"),
    reset: () => ipcRenderer.invoke("combine:reset"),
    chooseOutput: () => ipcRenderer.invoke("combine:choose-output"),
    preview: payload => ipcRenderer.invoke("combine:preview", payload || {}),
    layout: payload => ipcRenderer.invoke("combine:layout", payload || {}),
    generate: payload => ipcRenderer.invoke("combine:generate", payload || {}),
    openOutput: () => ipcRenderer.invoke("combine:open-output"),
    onProgress: callback => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on("combine:progress", handler);
        return () => ipcRenderer.removeListener("combine:progress", handler);
    }
});
