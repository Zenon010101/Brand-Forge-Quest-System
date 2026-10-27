"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Keep Chromium's browser/GPU caches separate from BrandForge's persistent
 * profile/EXP/history files in app.getPath('userData'). This MUST run before
 * Electron's app.ready event, before any BrowserWindow or session is created.
 *
 * A local per-user directory avoids roaming/shared-drive permissions and the
 * legacy userData GPUCache location. If LOCALAPPDATA is unavailable or cannot
 * be written, fall back to the current user's temporary directory.
 */
function configureSessionCache(app, options = {}) {
    const env = options.env || process.env;
    const fileSystem = options.fileSystem || fs;
    const logger = options.logger || console;
    const candidates = [];

    if (typeof env.LOCALAPPDATA === "string" && env.LOCALAPPDATA.trim()) {
        candidates.push(path.join(env.LOCALAPPDATA, "BrandForge", "ChromiumSession-v1"));
    }

    try {
        candidates.push(path.join(app.getPath("temp"), "BrandForge", "ChromiumSession-v1"));
    } catch (error) {
        logger.warn(`[BrandForge] Could not resolve temp cache directory: ${error.message}`);
    }

    let lastError = null;
    for (const directory of [...new Set(candidates)]) {
        let probePath = null;
        try {
            fileSystem.mkdirSync(directory, { recursive: true });
            // A mkdir check alone is insufficient: existing directories may
            // be readable but have their write permissions denied on Windows.
            probePath = path.join(
                directory,
                `.brandforge-write-probe-${process.pid}-${Math.random().toString(16).slice(2)}`
            );
            fileSystem.writeFileSync(probePath, "ok", { flag: "wx" });
            fileSystem.unlinkSync(probePath);
            probePath = null;
            app.setPath("sessionData", directory);
            return { ok: true, directory };
        } catch (error) {
            lastError = error;
            logger.warn(`[BrandForge] Session cache unavailable at ${directory}: ${error.message}`);
        } finally {
            if (probePath) {
                try { fileSystem.unlinkSync(probePath); } catch (_) { /* best effort */ }
            }
        }
    }

    // Never redirect userData (which holds profiles and history) and do not
    // abort the production app solely because the optional cache is blocked.
    logger.warn("[BrandForge] Chromium cache location could not be changed; check local folder permissions.");
    return { ok: false, error: lastError ? lastError.message : "No writable cache directory available." };
}

module.exports = { configureSessionCache };
