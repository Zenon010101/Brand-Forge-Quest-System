"use strict";

// Combine JPEG visual export: a separate legacy-style 600px render document.
// The published HTML stays in its original 780px 2-column / 3-column layout.
// No intermediate image assets, Photoshop, or JSX are used.
const sharp = require("sharp");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {WIDTH} = require("./iframeJpegLayout");

const MAX_HEIGHT = 52000; // JPEG and Chromium safety bound (tall pages use tiles).
const IMAGE_WAIT_MS = 35000;
const PAINT_WAIT_MS = 110;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Functions are deliberately independent so they can be tested without Electron.
function validateImageState(state, expectedImages) {
    if (!state || !Number.isInteger(state.total) || !Number.isInteger(state.loaded) ||
        !Number.isInteger(state.failed)) throw new Error("JPEG renderer returned invalid image diagnostics.");
    if (expectedImages !== undefined && state.total !== expectedImages)
        throw new Error(`JPEG: expected ${expectedImages} image(s), found ${state.total} in generated HTML.`);
    if (state.failed > 0 || state.loaded !== state.total) {
        const first = Array.isArray(state.failedUrls) ? state.failedUrls.slice(0, 3).join(" | ") : "";
        throw new Error(`JPEG: ${state.failed || state.total - state.loaded} image(s) did not load. ${first}`.trim());
    }
}
function validatePageHeight(height) {
    if (!Number.isFinite(height) || height < 1 || height > MAX_HEIGHT)
        throw new Error(`JPEG page height ${height} exceeds the supported ${MAX_HEIGHT}px limit or is invalid.`);
    return Math.ceil(height);
}

class ElectronJpegRenderer {
    constructor({ BrowserWindow = null, paintWaitMs = PAINT_WAIT_MS, imageWaitMs = IMAGE_WAIT_MS } = {}) {
        this.BrowserWindow = BrowserWindow;
        this.paintWaitMs = paintWaitMs;
        this.imageWaitMs = imageWaitMs;
        this.window = null;
    }
    ensureWindow() {
        if (this.window && !this.window.isDestroyed()) return this.window;
        if (!this.BrowserWindow) {
            const electron = require("electron");
            if (!electron || typeof electron.BrowserWindow !== "function")
                throw new Error("Full-page JPEG rendering must run in the Electron main process.");
            this.BrowserWindow = electron.BrowserWindow;
        }
        this.window = new this.BrowserWindow({
            width: WIDTH, height: 1000, useContentSize: true, show: false,
            backgroundColor: "#ffffff", paintWhenInitiallyHidden: true,
            webPreferences: {
                offscreen: true, sandbox: true, contextIsolation: true,
                nodeIntegration: false, webSecurity: true,
                backgroundThrottling: false
            }
        });
        const wc = this.window.webContents;
        wc.setWindowOpenHandler(() => ({ action: "deny" }));
        wc.on("will-navigate", (event) => event.preventDefault());
        return this.window;
    }
    async waitForImages(webContents, expected) {
        // This runs inside the inert HTML output document; it does not execute
        // scripts from the original Rakuten iframe page.
        const script = `new Promise(resolve => {
            const images = Array.from(document.querySelectorAll('img'));
            let pending = images.length;
            let finished = false;
            const settle = () => {
                if (finished || pending > 0) return;
                finished = true;
                clearTimeout(timer);
                const failedUrls = images.filter(x => !x.complete || x.naturalWidth < 1)
                    .map(x => x.currentSrc || x.src);
                resolve({total:images.length,loaded:images.length-failedUrls.length,
                    failed:failedUrls.length,failedUrls});
            };
            const timer = setTimeout(() => {
                pending = 0;
                settle();
            }, ${Number(this.imageWaitMs)});
            for (const img of images) {
                if (img.complete) { pending--; continue; }
                const ready = () => { pending--; settle(); };
                img.addEventListener('load', ready, {once:true});
                img.addEventListener('error', ready, {once:true});
            }
            settle();
        })`;
        const state = await webContents.executeJavaScript(script, true);
        validateImageState(state, expected);
        return state;
    }
    async measure(webContents) {
        const d = await webContents.executeJavaScript(`({
            width:Math.ceil(Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)),
            height:Math.ceil(Math.max(document.body.scrollHeight,document.documentElement.scrollHeight))
        })`, true);
        if (d.width > WIDTH + 4)
            throw new Error(`JPEG document width is ${d.width}px (expected ${WIDTH}px). Review layout before screenshot.`);
        return { width: WIDTH, height: validatePageHeight(d.height) };
    }
    async captureImage(webContents) {
        await sleep(this.paintWaitMs);
        const image = await webContents.capturePage();
        if (!image || image.isEmpty()) throw new Error("Electron returned an empty page capture.");
        // Normalize DPI/Windows display scaling to exactly 600 output pixels.
        return sharp(image.toPNG()).resize({width:WIDTH}).png().toBuffer();
    }
    async capture(htmlFile, outputJpeg, {expectedImages,renderHtml}={}) {
        let tempDir = null;
        try {
        let sourcePath = htmlFile;
        if (renderHtml != null) {
            if (typeof renderHtml !== "string" || renderHtml.length > 2500000 ||
                !renderHtml.includes("<main class=\"bf-page\">"))
                throw new Error("JPEG render document is invalid.");
            tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bf-combine-jpeg-"));
            sourcePath = path.join(tempDir, "legacy-combine.html");
            await fs.promises.writeFile(sourcePath, renderHtml, {encoding:"utf8",flag:"wx"});
        }
        const window = this.ensureWindow();
        const wc = window.webContents;
        await wc.loadFile(sourcePath);
        await this.waitForImages(wc, expectedImages);
        const {height} = await this.measure(wc);
        let data;
        if (height <= 4500) {
            window.setContentSize(WIDTH, height);
            await wc.executeJavaScript("window.scrollTo(0,0)", true);
            const screenshot = await this.captureImage(wc);
            const screenshotHeight=(await sharp(screenshot).metadata()).height;
            if (screenshotHeight < height)
                throw new Error(`JPEG capture is too short (${screenshotHeight}px vs expected ${height}px).`);
            data = await sharp(screenshot).extract({left:0,top:0,width:WIDTH,height}).flatten({background:"#ffffff"}).jpeg({quality:91,mozjpeg:true}).toBuffer();
        } else {
            const viewportHeight = 1350;
            window.setContentSize(WIDTH, viewportHeight);
            const chunks=[];
            for(let y=0; y<height; y+=viewportHeight) {
                const scrollY=Math.max(0,Math.min(y,height-viewportHeight));
                await wc.executeJavaScript(`window.scrollTo(0,${scrollY})`, true);
                const screenshot=await this.captureImage(wc);
                const {height: screenshotHeight} = await sharp(screenshot).metadata();
                const top=y-scrollY;
                const take=Math.min(height-y,viewportHeight);
                if (screenshotHeight < top+take)
                    throw new Error(`JPEG tile capture is incomplete at y=${y}.`);
                const tile=await sharp(screenshot).extract({left:0,top,width:WIDTH,height:take}).png().toBuffer();
                chunks.push({input:tile,left:0,top:y});
            }
            data=await sharp({create:{width:WIDTH,height,channels:3,background:"#ffffff"}})
                .composite(chunks).jpeg({quality:91,mozjpeg:true}).toBuffer();
        }
        // Do not publish half-written JPEGs.
        const partial=outputJpeg+".partial";
        try {
            await fs.promises.writeFile(partial,data,{flag:"wx"});
            const metadata=await sharp(partial).metadata();
            if(metadata.format!=="jpeg"||metadata.width!==WIDTH||metadata.height!==height)
                throw new Error("JPEG verification failed after writing.");
            await fs.promises.rename(partial,outputJpeg);
            return {width:WIDTH,height,bytes:data.length};
        } catch(e) {
            await fs.promises.rm(partial,{force:true}).catch(()=>{});
            throw e;
        }
        } finally {
            if (tempDir) await fs.promises.rm(tempDir,{recursive:true,force:true}).catch(()=>{});
        }
    }
    async close() {
        const w=this.window;this.window=null;
        if(w && !w.isDestroyed()) w.destroy();
    }
}
module.exports={ElectronJpegRenderer, validateImageState, validatePageHeight, WIDTH, MAX_HEIGHT};
