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
    version: "1.7.49",
    selectImages: options => ipcRenderer.invoke("slider:select-images", options || {}),
    selectImage: options => ipcRenderer.invoke("slider:select-image", options || {}),
    getPathForFile: file => webUtils.getPathForFile(file),
    describeDroppedFiles: paths => ipcRenderer.invoke("slider:describe-dropped-files", paths),
    selectOutputFolder: () => ipcRenderer.invoke("slider:select-output-folder"),
    generate: job => ipcRenderer.invoke("slider:generate", job),
    getNewBrandCombineSettings: () => ipcRenderer.invoke("slider:combine:get-settings"),
    chooseNewBrandSingle: () => ipcRenderer.invoke("slider:combine:choose-single"),
    chooseNewBrandOutput: () => ipcRenderer.invoke("slider:combine:choose-output"),
    suggestNewBrandCombine: job => ipcRenderer.invoke("slider:combine:suggest", job),
    generateNewBrandCombine: payload => ipcRenderer.invoke("slider:combine:generate", payload),
    openNewBrandOutput: folder => ipcRenderer.invoke("slider:combine:open-output", folder),
    onNewBrandCombineProgress: callback => {
        const listener = (_event, update) => callback(update);
        ipcRenderer.on("slider:combine:progress", listener);
        return () => ipcRenderer.removeListener("slider:combine:progress", listener);
    },
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
    chooseCreative: () => ipcRenderer.invoke("amazon:choose-creative"),
    findRkPlain: projectRoot => ipcRenderer.invoke("amazon:rk-plain-find", { projectRoot }),
    chooseRkPlain: () => ipcRenderer.invoke("amazon:rk-plain-choose"),
    offerRkPlain: jobId => ipcRenderer.invoke("amazon:offer-rk-plain", { jobId }),
    chooseImageFolder: () => ipcRenderer.invoke("amazon:choose-image-folder"),
    scanImageFolder: options => ipcRenderer.invoke("amazon:scan-image-folder", options || {}),
    inspectBatchImages: paths => ipcRenderer.invoke("amazon:inspect-batch-images", { paths }),
    getPathForFile: file => webUtils.getPathForFile(file),
    preflightBatch: payload => ipcRenderer.invoke("amazon:preflight-batch", payload),
    getFilePreview: filePath => ipcRenderer.invoke("amazon:get-file-preview", { filePath }),
    getFileThumbnail: filePath => ipcRenderer.invoke("amazon:get-file-thumbnail", { filePath }),
    getPsdCacheStatus: paths => ipcRenderer.invoke("amazon:psd-cache-status", { paths }),
    clearPsdCache: () => ipcRenderer.invoke("amazon:psd-cache-clear"),
    openPsdCacheLogs: () => ipcRenderer.invoke("amazon:psd-cache-open-logs"),
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
    getCompatibility: () => ipcRenderer.invoke("settings:compat:get"),
    scanCompatibility: mode => ipcRenderer.invoke("settings:compat:scan", mode),
    setPhotoshopPreference: major => ipcRenderer.invoke("settings:compat:set-preference", major),
    openCompatibilityReport: () => ipcRenderer.invoke("settings:compat:open-report"),
    openPhotoshopDiagnostics: () => ipcRenderer.invoke("settings:open-photoshop-diagnostics"),
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
    // v1.7.44: HTML/Excel Combine, no Photoshop or image downloads.
    chooseHtmlExcel: () => ipcRenderer.invoke("combine:html:choose-excel"),
    chooseHtmlOutput: () => ipcRenderer.invoke("combine:html:choose-output"),
    inspectHtmlExcel: file => ipcRenderer.invoke("combine:html:inspect-excel",file),
    previewIframeHtml: payload => ipcRenderer.invoke("combine:html:preview",payload),
    generateIframeBatch: payload => ipcRenderer.invoke("combine:html:batch",payload),
    cancelIframeBatch: () => ipcRenderer.invoke("combine:html:cancel"),
    saveSingleHtml: payload => ipcRenderer.invoke("combine:html:save-single",payload),
    openHtmlBatchFolder: folder => ipcRenderer.invoke("combine:html:open-folder",folder),
    onIframeBatchProgress: callback => {
        const listener=(_event,data)=>callback(data);
        ipcRenderer.on("combine:html:progress",listener);
        return ()=>ipcRenderer.removeListener("combine:html:progress",listener);
    },
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

// Arcade scores/preferences are profile-keyed in a separate local store.
// No production data or Photoshop APIs are exposed to the mini games.
contextBridge.exposeInMainWorld("arcadeApp", {
    getState: () => ipcRenderer.invoke("arcade:get-state"),
    saveScore: (game, score) => ipcRenderer.invoke("arcade:save-score", game, score),
    setSound: enabled => ipcRenderer.invoke("arcade:set-sound", enabled)
});
