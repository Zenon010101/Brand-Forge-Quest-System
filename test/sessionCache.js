"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { configureSessionCache } = require("../src/main/sessionCache");

const quiet = { warn() {} };

async function testWritableCacheAndPersistentData() {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bf-session-cache-test-"));
    try {
        const data = path.join(temp, "roaming-profile");
        fs.mkdirSync(data);
        const profilePath = path.join(data, "profiles.json");
        fs.writeFileSync(profilePath, '{"profiles":[{"name":"Existing Profile"}]}');
        const app = {
            getPath(name) {
                if (name === "temp") return path.join(temp, "tmp");
                if (name === "userData") return data;
                throw Error(`Unexpected path: ${name}`);
            },
            setPath(name, directory) {
                assert.strictEqual(name, "sessionData", "Must never modify userData");
                assert(fs.statSync(directory).isDirectory());
                this.sessionData = directory;
            }
        };
        const result = configureSessionCache(app, {
            env: { LOCALAPPDATA: path.join(temp, "local") },
            logger: quiet
        });
        assert(result.ok, "Local writable cache should be selected");
        assert.strictEqual(result.directory, path.join(temp, "local", "BrandForge", "ChromiumSession-v1"));
        assert.strictEqual(app.sessionData, result.directory);
        assert.strictEqual(app.getPath("userData"), data, "Persistent profile path unchanged");
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(profilePath, "utf8")).profiles.map(p => p.name), ["Existing Profile"]);
        assert(fs.readdirSync(result.directory).length === 0, "Writable test must clean its probe");
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
}

async function testFallbackFromBlockedLocalAppData() {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bf-cache-fallback-test-"));
    try {
        const inaccessible = path.join(temp, "blocked-file");
        fs.writeFileSync(inaccessible, "not a directory");
        const app = {
            getPath(name) { assert.strictEqual(name, "temp"); return path.join(temp, "writable-tmp"); },
            setPath(name, directory) { assert.strictEqual(name, "sessionData"); this.selected = directory; }
        };
        const result = configureSessionCache(app, { env: { LOCALAPPDATA: inaccessible }, logger: quiet });
        assert(result.ok, "Should use user temp when LOCALAPPDATA is blocked");
        assert.strictEqual(result.directory, path.join(temp, "writable-tmp", "BrandForge", "ChromiumSession-v1"));
        assert.strictEqual(app.selected, result.directory);
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
}

async function testFallbackWhenSetPathThrows() {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bf-cache-setpath-test-"));
    try {
        const app = {
            getPath(name) { assert.strictEqual(name, "temp"); return path.join(temp, "user-tmp"); },
            setPath(name, directory) {
                assert.strictEqual(name, "sessionData");
                if (directory.includes("local")) throw Object.assign(new Error("Access is denied"), { code: "EACCES" });
                this.selected = directory;
            }
        };
        const result = configureSessionCache(app, {
            env: { LOCALAPPDATA: path.join(temp, "local") }, logger: quiet
        });
        assert(result.ok, "setPath failure should be recoverable");
        assert.strictEqual(app.selected, path.join(temp, "user-tmp", "BrandForge", "ChromiumSession-v1"));
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
}

async function testAllPathsBlockedNeverModifiesUserData() {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bf-cache-all-blocked-"));
    try {
        const block = path.join(temp, "blocked");
        fs.writeFileSync(block, "x");
        const app = {
            getPath(name) { assert.strictEqual(name, "temp"); return block; },
            setPath() { throw Error("Should not reach setPath when directories are blocked"); }
        };
        const result = configureSessionCache(app, { env: { LOCALAPPDATA: block }, logger: quiet });
        assert(!result.ok, "When cache isn't writable, return a warning rather than throwing");
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
}

async function testSingleInstanceStartup() {
    const source = fs.readFileSync(path.join(__dirname, "../src/main/main.js"), "utf8");
    const runHarness = async (lockGranted) => {
        const actions = [];
        const handlers = new Map();
        let resolveReady;
        const ready = new Promise(resolve => { resolveReady = resolve; });
        const window = {
            isDestroyed() { return false; },
            isMinimized() { return true; },
            restore() { actions.push("restore"); },
            show() { actions.push("show"); },
            focus() { actions.push("focus"); },
            webContents: { setWindowOpenHandler() {}, on() {} },
            once() {}, loadFile() {}
        };
        const app = {
            requestSingleInstanceLock() { actions.push("lock"); return lockGranted; },
            quit() { actions.push("quit"); },
            on(name, fn) { handlers.set(name, fn); },
            whenReady() { actions.push("whenReady"); return ready; },
            getName() { return "Image Workflow Studio"; },
            getVersion() { return "1.7.7"; }
        };
        function BrowserWindow() { actions.push("createWindow"); return window; }
        BrowserWindow.getAllWindows = () => actions.includes("createWindow") ? [window] : [];
        const electron = { app, BrowserWindow, ipcMain: { handle(channel) { actions.push(`ipc:${channel}`); } } };
        const localRequire = (name) => {
            if (name === "electron") return electron;
            if (name === "path") return path;
            if (name === "./sessionCache") return {
                configureSessionCache() { actions.push("configureCache"); }
            };
            if (name.startsWith("../modules/")) { actions.push(`register:${name}`); return {}; }
            throw new Error(`Unexpected require ${name}`);
        };
        vm.runInNewContext(source, {
            require: localRequire, __dirname: path.join(__dirname, "../src/main"),
            process: { platform: "win32" }, console
        });
        resolveReady();
        await Promise.resolve();
        await Promise.resolve();
        return { actions, handlers };
    };

    const first = await runHarness(true);
    assert(first.actions.includes("configureCache"), "Primary instance must configure cache");
    assert(first.actions.includes("createWindow"), "Primary instance should create main window");
    assert(first.actions.indexOf("lock") < first.actions.indexOf("configureCache"));
    assert(first.actions.indexOf("configureCache") < first.actions.findIndex(action => action.startsWith("register:")));
    assert(first.actions.indexOf("configureCache") < first.actions.indexOf("whenReady"));
    first.handlers.get("second-instance")();
    assert(first.actions.includes("restore"));
    assert(first.actions.includes("focus"));

    const second = await runHarness(false);
    assert.deepStrictEqual(second.actions, ["lock", "quit"], "Second instance must not register modules, initialize cache, or open a window");
}

(async () => {
    await testWritableCacheAndPersistentData();
    await testFallbackFromBlockedLocalAppData();
    await testFallbackWhenSetPathThrows();
    await testAllPathsBlockedNeverModifiesUserData();
    await testSingleInstanceStartup();
    console.log("PASS BrandForge Windows session cache and single-instance regression tests");
})().catch(error => { console.error(error); process.exitCode = 1; });
