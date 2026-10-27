"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

function execute(command, args, timeoutMs = 85000) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const child = spawn(command, args, { windowsHide: true, shell: false });
        const stdout = [], stderr = [];
        let bytes = 0;
        const timer = setTimeout(() => {
            child.kill();
            done(new Error(`OCR timed out after ${Math.round(timeoutMs / 1000)}s.`));
        }, timeoutMs);
        function done(error, result) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) reject(error); else resolve(result);
        }
        child.on("error", done);
        child.stdout.on("data", chunk => {
            bytes += chunk.length;
            if (bytes > 16 * 1024 * 1024) { child.kill(); done(new Error("OCR response too large.")); }
            else stdout.push(chunk);
        });
        child.stderr.on("data", chunk => stderr.push(chunk));
        child.on("close", code => {
            const response = { code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
            if (code) done(new Error(`OCR exit code ${code}: ${response.stderr.slice(-500)}`));
            else done(null, response);
        });
    });
}

function tesseractCandidates(configuredPath) {
    const candidates = [];
    if (typeof configuredPath === "string" && configuredPath.trim()) candidates.push(configuredPath.trim());
    candidates.push("tesseract");
    if (process.platform === "win32") {
        for (const root of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA]) {
            if (root) candidates.push(path.join(root, "Tesseract-OCR", "tesseract.exe"), path.join(root, "Programs", "Tesseract-OCR", "tesseract.exe"));
        }
    }
    return [...new Set(candidates)];
}

function parseTsv(tsv) {
    const groups = new Map();
    const lines = tsv.replace(/^\uFEFF/, "").split(/\r?\n/);
    for (const row of lines.slice(1)) {
        const cells = row.split("\t");
        if (cells.length < 12 || cells[0] !== "5") continue;
        const word = cells.slice(11).join("\t").trim();
        const conf = Number(cells[10]);
        if (!word || !Number.isFinite(conf) || conf < 0) continue;
        const [x, y, w, h] = cells.slice(6, 10).map(Number);
        if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
        const key = cells.slice(1, 5).join(":");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ word, x, y, w, h, confidence: conf });
    }
    return [...groups.values()].map(words => {
        words.sort((a, b) => a.x - b.x);
        const x = Math.min(...words.map(w => w.x));
        const y = Math.min(...words.map(w => w.y));
        const right = Math.max(...words.map(w => w.x + w.w));
        const bottom = Math.max(...words.map(w => w.y + w.h));
        // Whitespace between Japanese glyphs is often an OCR artifact; keep spaces
        // for Latin words and avoid adding whitespace between adjacent CJK tokens.
        let text = "";
        for (const w of words) {
            const cjk = /[\u3000-\u9fff\uf900-\ufaff]/;
            if (text && !(cjk.test(text.slice(-1)) || cjk.test(w.word[0]))) text += " ";
            text += w.word;
        }
        const confidence = words.reduce((sum, w) => sum + w.confidence, 0) / words.length;
        return { text, x, y, width: right - x, height: bottom - y, confidence: Math.round(confidence), engine: "Tesseract" };
    }).filter(block => block.text.trim());
}

async function runTesseract(imagePath, preferredPath) {
    let lastError;
    for (const command of tesseractCandidates(preferredPath)) {
        try {
            const version = await execute(command, ["--version"], 5000);
            if (!/tesseract/i.test(version.stdout + version.stderr)) continue;
            try {
                const output = await execute(command, [imagePath, "stdout", "-l", "eng+jpn", "tsv"], 85000);
                return { blocks: parseTsv(output.stdout), engine: "Tesseract (English + Japanese)" };
            } catch (multiError) {
                const output = await execute(command, [imagePath, "stdout", "-l", "eng", "tsv"], 85000);
                return { blocks: parseTsv(output.stdout), engine: "Tesseract (English)", warning: "Japanese OCR data unavailable; used English. Install jpn.traineddata for Japanese recognition." };
            }
        } catch (error) { lastError = error; }
    }
    throw lastError || new Error("Tesseract executable not installed.");
}

// Uses the Windows-provided OCR engine and its installed languages, without
// network downloads or Python. Windows native OCR does not expose word confidence.
// Thus its results are always marked conservative in the editable restoration step.
const WINDOWS_OCR_SCRIPT = String.raw`
param([Parameter(Mandatory=$true)][string]$ImagePath, [Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.FileAccessMode,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
$method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
function AwaitWinRT($operation, $resultType) {
    $methodForType = $method.MakeGenericMethod($resultType)
    $task = $methodForType.Invoke($null, @($operation))
    $task.Wait()
    return $task.Result
}
$file = AwaitWinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
$stream = AwaitWinRT ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
try {
    $decoder = AwaitWinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = AwaitWinRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    try {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
        if ($null -eq $engine) { throw 'No Windows OCR language installed.' }
        $result = AwaitWinRT ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        $blocks = @()
        foreach ($line in $result.Lines) {
            $words = @($line.Words)
            if ($words.Count -eq 0) { continue }
            $x = ($words | ForEach-Object { $_.BoundingRect.X } | Measure-Object -Minimum).Minimum
            $y = ($words | ForEach-Object { $_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
            $r = ($words | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width } | Measure-Object -Maximum).Maximum
            $b = ($words | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height } | Measure-Object -Maximum).Maximum
            $blocks += @{ text = [string]$line.Text; x = [double]$x; y = [double]$y; width = [double]($r - $x); height = [double]($b - $y); confidence = $null; engine = 'Windows OCR' }
        }
        [System.IO.File]::WriteAllText($OutputPath, (ConvertTo-Json -InputObject @{ blocks = @($blocks); engine = 'Windows OCR' } -Depth 6 -Compress), (New-Object System.Text.UTF8Encoding($false)))
    } finally { if ($null -ne $bitmap) { $bitmap.Dispose() } }
} finally { if ($null -ne $stream) { $stream.Dispose() } }
`;

async function runWindowsOcr(imagePath, workDir) {
    if (process.platform !== "win32") throw new Error("Windows OCR only available on Windows.");
    const ps = path.join(workDir, "win-ocr.ps1");
    const resultFile = path.join(workDir, `ocr-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    await fs.promises.writeFile(ps, WINDOWS_OCR_SCRIPT, "utf8");
    await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps, "-ImagePath", imagePath, "-OutputPath", resultFile], 85000);
    const result = JSON.parse(await fs.promises.readFile(resultFile, "utf8"));
    return { engine: "Windows OCR", blocks: Array.isArray(result.blocks) ? result.blocks : [] };
}

async function recognize(imagePath, options = {}) {
    let tesseractError;
    try { return await runTesseract(imagePath, options.tesseractPath); }
    catch (error) { tesseractError = error; }
    if (process.platform === "win32") {
        try { return await runWindowsOcr(imagePath, options.workDir || os.tmpdir()); }
        catch (error) {
            return { engine: "Unavailable", blocks: [], warning: `OCR unavailable (Tesseract: ${tesseractError.message}; Windows OCR: ${error.message}). This screenshot will remain visually complete as raster fallback.` };
        }
    }
    return { engine: "Unavailable", blocks: [], warning: `OCR unavailable (${tesseractError.message}); screenshot preserved as raster.` };
}

module.exports = { parseTsv, recognize, runTesseract, runWindowsOcr };
