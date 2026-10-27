const fs = require("fs");
const path = require("path");
const os = require("os");
const sharp = require("sharp");

const {
    detectCutSides,
    trimFirstImage,
    renderAmazonImage
} = require("./amazonRules");

const {
    extractPsdNoShadowToPng,
    convertFileToPng
} = require("./photoshopBridge");

function isPSD(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ext === ".psd" || ext === ".psb";
}

function safeFileName(value) {
    return (
        String(value)
            .trim()
            .replace(/[<>:"/\\|?*]+/g, "_")
            .replace(/[. ]+$/g, "") ||
        "UNTITLED"
    );
}

function safeWorkName(value) {
    return String(value).replace(/[^a-z0-9_-]+/gi, "_");
}

function uniqueTempName(prefix, ext = ".png") {
    return `${prefix}_${Date.now()}_${Math.round(Math.random() * 1000000000)}${ext}`;
}

function getOutputBaseName(variantId, outputPosition) {
    const safeVariantId = safeFileName(variantId);
    return outputPosition === 1
        ? safeVariantId
        : `${safeVariantId}_${outputPosition}`;
}

async function readNormalizedPng(filePath) {
    return sharp(filePath, { failOn: "none" })
        .rotate()
        .ensureAlpha()
        .png()
        .toBuffer();
}

async function loadSource(filePath, workFolder, progressCallback) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Source file no longer exists: ${filePath}`);
    }

    let normalizedBuffer;
    let normalizedPath = null;

    if (isPSD(filePath)) {
        progressCallback?.({ status: "extracting-psd-no-shadow" });

        normalizedPath = path.join(
            workFolder,
            uniqueTempName("psd_no_shadow")
        );

        // Production rule: hide the SECOND TOP-LEVEL layer, export PNG, and
        // close the PSD without saving. This is the Amazon no-shadow source.
        await extractPsdNoShadowToPng(filePath, normalizedPath);
        normalizedBuffer = await readNormalizedPng(normalizedPath);
    } else {
        try {
            normalizedBuffer = await sharp(filePath, { failOn: "none" })
                .rotate()
                .ensureAlpha()
                .png()
                .toBuffer();
        } catch (error) {
            progressCallback?.({ status: "photoshop-fallback" });

            normalizedPath = path.join(
                workFolder,
                uniqueTempName("fallback")
            );

            await convertFileToPng(filePath, normalizedPath);
            normalizedBuffer = await readNormalizedPng(normalizedPath);
        }
    }

    // Preserve the extracted/normalized source. Do not remove its background.
    return normalizedBuffer;
}

async function clearVariantJpgs(jpgFolder, variantId) {
    for (let position = 1; position <= 8; position++) {
        const baseName = getOutputBaseName(variantId, position);
        const filePath = path.join(jpgFolder, `${baseName}.jpg`);

        try {
            await fs.promises.unlink(filePath);
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
    }
}

async function processVariant(
    variant,
    jpgFolder,
    batchWorkFolder,
    progressCallback
) {
    const files = Array.isArray(variant.files) ? variant.files : [];

    if (files.length === 0) {
        throw new Error(`${variant.id} has no selected images.`);
    }

    if (files.length > 8) {
        throw new Error(`${variant.id} has more than 8 selected images.`);
    }

    await fs.promises.mkdir(jpgFolder, { recursive: true });

    const variantWorkFolder = path.join(
        batchWorkFolder,
        safeWorkName(variant.id)
    );

    await fs.promises.mkdir(variantWorkFolder, { recursive: true });
    await clearVariantJpgs(jpgFolder, variant.id);

    const jpgs = [];
    const layers = [];

    try {
        for (let index = 0; index < files.length; index++) {
            const source = files[index];
            const outputPosition = index + 1;

            const emit = extra => progressCallback?.({
                variantId: variant.id,
                sourceIndex: index,
                outputPosition,
                file: source.name,
                ...extra
            });

            emit({ status: "loading" });

            let sourceBuffer = await loadSource(
                source.path,
                variantWorkFolder,
                extra => emit(extra)
            );

            // Cut detection happens on the unchanged normalized source BEFORE trimming,
            // so a product genuinely touching a source edge remains detectable.
            emit({ status: "cut-detection" });
            const cut = await detectCutSides(sourceBuffer);

            if (outputPosition === 1) {
                emit({ status: "trimming-first" });
                sourceBuffer = await trimFirstImage(sourceBuffer);
            }

            // renderAmazonImage trims to ACTUAL visible pixels and centers every
            // non-cut item in the 801/921 target area. Cut sides remain edge-aware.
            emit({ status: "rendering", cut });

            const rendered = await renderAmazonImage(
                sourceBuffer,
                outputPosition,
                cut
            );

            const baseName = getOutputBaseName(
                variant.id,
                outputPosition
            );

            const jpgPath = path.join(jpgFolder, `${baseName}.jpg`);
            const pngPath = path.join(variantWorkFolder, `${baseName}.png`);

            await fs.promises.writeFile(jpgPath, rendered.jpgBuffer);
            await fs.promises.writeFile(pngPath, rendered.pngBuffer);

            jpgs.push(jpgPath);
            layers.push({
                pngPath,
                layerName: baseName
            });

            emit({
                status: "complete",
                output: `${baseName}.jpg`,
                cut
            });
        }

        return {
            variantId: variant.id,
            jpgs,
            layers
        };
    } catch (error) {
        await clearVariantJpgs(jpgFolder, variant.id).catch(() => {});
        throw error;
    }
}

async function createPreviewDataUrl(filePath) {
    const workFolder = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "amazon-preview-")
    );

    try {
        const sourceBuffer = await loadSource(filePath, workFolder);
        const metadata = await sharp(sourceBuffer).metadata();

        const previewBuffer = await sharp(sourceBuffer)
            .resize({
                width: 1000,
                height: 1000,
                fit: "inside",
                withoutEnlargement: true
            })
            .png()
            .toBuffer();

        return {
            dataUrl: `data:image/png;base64,${previewBuffer.toString("base64")}`,
            width: metadata.width || null,
            height: metadata.height || null,
            format: isPSD(filePath)
                ? "PSD/PSB · second top-level layer hidden"
                : "Original image (background preserved)"
        };
    } finally {
        await fs.promises.rm(workFolder, { recursive: true, force: true })
            .catch(() => {});
    }
}

module.exports = {
    processVariant,
    clearVariantJpgs,
    createPreviewDataUrl,
    getOutputBaseName,
    safeFileName
};
