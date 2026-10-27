const sharp = require("sharp");

const CANVAS_SIZE = 1001;
const MAIN_AREA = {
    x: 100,
    y: 100,
    width: 801,
    height: 801
};

const REST_AREA = {
    x: 40,
    y: 40,
    width: 921,
    height: 921
};

async function getRawInfo(buffer) {
    return sharp(buffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
}

async function getContentBounds(buffer) {
    const { data, info } = await getRawInfo(buffer);
    const { width, height, channels } = info;

    function pixelAt(x, y) {
        const i = (y * width + x) * channels;
        return {
            r: data[i],
            g: data[i + 1],
            b: data[i + 2],
            a: data[i + 3]
        };
    }

    let hasTransparency = false;
    for (let i = 3; i < data.length; i += channels) {
        if (data[i] < 250) {
            hasTransparency = true;
            break;
        }
    }

    let background = { r: 255, g: 255, b: 255 };

    if (!hasTransparency) {
        const corners = [
            pixelAt(0, 0),
            pixelAt(width - 1, 0),
            pixelAt(0, height - 1),
            pixelAt(width - 1, height - 1)
        ];

        background = corners.reduce(
            (acc, p) => ({
                r: acc.r + p.r / corners.length,
                g: acc.g + p.g / corners.length,
                b: acc.b + p.b / corners.length
            }),
            { r: 0, g: 0, b: 0 }
        );
    }

    function isContent(x, y) {
        const p = pixelAt(x, y);

        if (hasTransparency) {
            return p.a > 20;
        }

        const dr = p.r - background.r;
        const dg = p.g - background.g;
        const db = p.b - background.b;
        return Math.sqrt(dr * dr + dg * dg + db * db) > 30;
    }

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!isContent(x, y)) continue;

            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
    }

    if (maxX === -1 || maxY === -1) {
        return {
            left: 0,
            top: 0,
            width,
            height,
            empty: true
        };
    }

    return {
        left: minX,
        top: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        empty: false
    };
}

async function trimToContent(buffer) {
    const bounds = await getContentBounds(buffer);

    if (bounds.empty) {
        return {
            buffer,
            bounds: {
                left: 0,
                top: 0,
                width: (await sharp(buffer).metadata()).width || 1,
                height: (await sharp(buffer).metadata()).height || 1
            }
        };
    }

    const trimmed = await sharp(buffer)
        .extract({
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height
        })
        .png()
        .toBuffer();

    return {
        buffer: trimmed,
        bounds
    };
}

async function detectCutSides(buffer) {
    const { data, info } = await getRawInfo(buffer);
    const { width, height, channels } = info;

    function pixelAt(x, y) {
        const i = (y * width + x) * channels;
        return {
            r: data[i],
            g: data[i + 1],
            b: data[i + 2],
            a: data[i + 3]
        };
    }

    let hasTransparency = false;
    for (let i = 3; i < data.length; i += channels) {
        if (data[i] < 250) {
            hasTransparency = true;
            break;
        }
    }

    const corners = [
        pixelAt(0, 0),
        pixelAt(width - 1, 0),
        pixelAt(0, height - 1),
        pixelAt(width - 1, height - 1)
    ];

    const background = corners.reduce(
        (acc, p) => ({
            r: acc.r + p.r / corners.length,
            g: acc.g + p.g / corners.length,
            b: acc.b + p.b / corners.length
        }),
        { r: 0, g: 0, b: 0 }
    );

    function isContent(x, y) {
        const p = pixelAt(x, y);
        if (hasTransparency) return p.a > 20;

        const dr = p.r - background.r;
        const dg = p.g - background.g;
        const db = p.b - background.b;
        return Math.sqrt(dr * dr + dg * dg + db * db) > 30;
    }

    const strip = Math.max(
        2,
        Math.min(8, Math.round(Math.min(width, height) * 0.005))
    );

    function edgeHasContent(side) {
        let contentPixels = 0;
        let checkedPixels = 0;

        if (side === "left" || side === "right") {
            for (let y = 0; y < height; y++) {
                for (let s = 0; s < strip; s++) {
                    const x = side === "left" ? s : width - 1 - s;
                    checkedPixels++;
                    if (isContent(x, y)) contentPixels++;
                }
            }
        } else {
            for (let x = 0; x < width; x++) {
                for (let s = 0; s < strip; s++) {
                    const y = side === "top" ? s : height - 1 - s;
                    checkedPixels++;
                    if (isContent(x, y)) contentPixels++;
                }
            }
        }

        const minimum = Math.max(4, Math.round(checkedPixels * 0.0015));
        return contentPixels >= minimum;
    }

    return {
        left: edgeHasContent("left"),
        right: edgeHasContent("right"),
        top: edgeHasContent("top"),
        bottom: edgeHasContent("bottom")
    };
}


async function getOpaqueCornerAnchor(buffer, cut) {
    const { data, info } = await getRawInfo(buffer);
    const { width, height, channels } = info;

    const corners = [];
    if (cut.left && cut.top) corners.push({ name: "top-left", x: 0, y: 0 });
    if (cut.right && cut.top) corners.push({ name: "top-right", x: width - 1, y: 0 });
    if (cut.left && cut.bottom) corners.push({ name: "bottom-left", x: 0, y: height - 1 });
    if (cut.right && cut.bottom) corners.push({ name: "bottom-right", x: width - 1, y: height - 1 });

    if (!corners.length) return null;

    function alphaAt(x, y) {
        return data[(y * width + x) * channels + 3];
    }

    let best = null;

    for (const corner of corners) {
        let nearest = null;
        let nearestDistance = Infinity;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (alphaAt(x, y) <= 20) continue;
                const dx = x - corner.x;
                const dy = y - corner.y;
                const distance = dx * dx + dy * dy;
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearest = { x, y };
                    if (distance === 0) break;
                }
            }
            if (nearestDistance === 0) break;
        }

        if (!nearest) continue;

        const normalizedDistance = Math.sqrt(nearestDistance) / Math.max(1, Math.min(width, height));
        if (!best || normalizedDistance > best.normalizedDistance) {
            best = {
                corner: corner.name,
                x: nearest.x,
                y: nearest.y,
                normalizedDistance
            };
        }
    }

    return best;
}

function scaleNeededForCutCoverage(anchor, width, height, cut) {
    if (!anchor) return 0;

    const targetX = anchor.corner.indexOf("right") !== -1 ? CANVAS_SIZE : 0;
    const targetY = anchor.corner.indexOf("bottom") !== -1 ? CANVAS_SIZE : 0;

    let required = 0;

    if (cut.left && targetX !== 0 && anchor.x > 0) {
        required = Math.max(required, CANVAS_SIZE / anchor.x);
    }
    if (cut.right && targetX !== CANVAS_SIZE && (width - 1 - anchor.x) > 0) {
        required = Math.max(required, CANVAS_SIZE / (width - 1 - anchor.x));
    }
    if (cut.top && targetY !== 0 && anchor.y > 0) {
        required = Math.max(required, CANVAS_SIZE / anchor.y);
    }
    if (cut.bottom && targetY !== CANVAS_SIZE && (height - 1 - anchor.y) > 0) {
        required = Math.max(required, CANVAS_SIZE / (height - 1 - anchor.y));
    }

    return required;
}

async function trimFirstImage(buffer) {
    try {
        const result = await trimToContent(buffer);
        return result.buffer;
    } catch (error) {
        return buffer;
    }
}

async function cropToCanvas(buffer, width, height, left, top) {
    const sourceX = Math.max(0, -left);
    const sourceY = Math.max(0, -top);
    const destinationX = Math.max(0, left);
    const destinationY = Math.max(0, top);

    const visibleWidth = Math.min(
        width - sourceX,
        CANVAS_SIZE - destinationX
    );

    const visibleHeight = Math.min(
        height - sourceY,
        CANVAS_SIZE - destinationY
    );

    if (visibleWidth <= 0 || visibleHeight <= 0) {
        throw new Error("Image ended outside canvas.");
    }

    let visible = buffer;

    if (
        sourceX !== 0 ||
        sourceY !== 0 ||
        visibleWidth !== width ||
        visibleHeight !== height
    ) {
        visible = await sharp(buffer)
            .extract({
                left: sourceX,
                top: sourceY,
                width: visibleWidth,
                height: visibleHeight
            })
            .png()
            .toBuffer();
    }

    return {
        buffer: visible,
        left: destinationX,
        top: destinationY
    };
}

async function renderAmazonImage(sourceBuffer, outputPosition, cut) {
    const { buffer: trimmedBuffer } = await trimToContent(sourceBuffer);
    const metadata = await sharp(trimmedBuffer).metadata();
    const sourceWidth = metadata.width;
    const sourceHeight = metadata.height;

    if (!sourceWidth || !sourceHeight) {
        throw new Error("Invalid source image dimensions.");
    }

    const hasCut = !!(cut.left || cut.right || cut.top || cut.bottom);
    const horizontalPair = cut.left && cut.right;
    const verticalPair = cut.top && cut.bottom;
    const allSides = horizontalPair && verticalPair;

    const target = outputPosition === 1
        ? MAIN_AREA
        : REST_AREA;

    // Normal images retain the Amazon safe-area rules. Once a genuine cut is
    // detected, cut placement overrides safe-area centering and aligns the
    // actual product pixels to the relevant canvas edge/corner.
    let scale = Math.min(
        target.width / sourceWidth,
        target.height / sourceHeight
    );

    if (hasCut) {
        if (allSides) {
            scale = Math.max(
                CANVAS_SIZE / sourceWidth,
                CANVAS_SIZE / sourceHeight
            );
        } else {
            if (horizontalPair) {
                scale = Math.max(scale, CANVAS_SIZE / sourceWidth);
            }
            if (verticalPair) {
                scale = Math.max(scale, CANVAS_SIZE / sourceHeight);
            }
        }
    }

    // Adjacent cut sides can still leave a triangular transparent/white gap
    // at the requested corner even when the bounding box touches both edges.
    // Lock the nearest real item pixel to the worst affected cut corner and,
    // where necessary, increase scale just enough to preserve coverage of the
    // other cut sides.
    const cornerAnchor = hasCut
        ? await getOpaqueCornerAnchor(trimmedBuffer, cut)
        : null;

    if (cornerAnchor && cornerAnchor.normalizedDistance > 0.002) {
        scale = Math.max(
            scale,
            scaleNeededForCutCoverage(
                cornerAnchor,
                sourceWidth,
                sourceHeight,
                cut
            )
        );
    }

    const resizedWidth = Math.max(1, Math.round(sourceWidth * scale));
    const resizedHeight = Math.max(1, Math.round(sourceHeight * scale));

    let left = Math.round(target.x + (target.width - resizedWidth) / 2);
    let top = Math.round(target.y + (target.height - resizedHeight) / 2);

    if (hasCut) {
        if (horizontalPair) {
            left = Math.round((CANVAS_SIZE - resizedWidth) / 2);
        } else if (cut.left) {
            left = 0;
        } else if (cut.right) {
            left = CANVAS_SIZE - resizedWidth;
        }

        if (verticalPair) {
            top = Math.round((CANVAS_SIZE - resizedHeight) / 2);
        } else if (cut.top) {
            top = 0;
        } else if (cut.bottom) {
            top = CANVAS_SIZE - resizedHeight;
        }

        if (cornerAnchor && cornerAnchor.normalizedDistance > 0.002) {
            const scaledAnchorX = cornerAnchor.x * scale;
            const scaledAnchorY = cornerAnchor.y * scale;

            if (cornerAnchor.corner.indexOf("left") !== -1) {
                left = Math.round(-scaledAnchorX);
            } else {
                left = Math.round(CANVAS_SIZE - scaledAnchorX);
            }

            if (cornerAnchor.corner.indexOf("top") !== -1) {
                top = Math.round(-scaledAnchorY);
            } else {
                top = Math.round(CANVAS_SIZE - scaledAnchorY);
            }
        }
    }

    const resized = await sharp(trimmedBuffer)
        .resize({
            width: resizedWidth,
            height: resizedHeight,
            fit: "fill"
        })
        .png()
        .toBuffer();

    const visible = await cropToCanvas(
        resized,
        resizedWidth,
        resizedHeight,
        left,
        top
    );

    const pngBuffer = await sharp({
        create: {
            width: CANVAS_SIZE,
            height: CANVAS_SIZE,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 0 }
        }
    })
        .composite([{
            input: visible.buffer,
            left: visible.left,
            top: visible.top
        }])
        .png()
        .toBuffer();

    const jpgBuffer = await sharp(pngBuffer)
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
        .toBuffer();

    return { pngBuffer, jpgBuffer };
}

module.exports = {
    CANVAS_SIZE,
    MAIN_AREA,
    REST_AREA,
    detectCutSides,
    trimFirstImage,
    renderAmazonImage,
    getContentBounds,
    trimToContent,
    getOpaqueCornerAnchor
};
