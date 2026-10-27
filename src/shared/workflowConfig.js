const WORKFLOW_RULES = Object.freeze({
    slider: {
        canvasSize: 600,
        cutVisibleHeight: 550,
        cutBottomWhite: 50,
        paVertical: {
            item: { x: 15, y: 20, width: 571, height: 280 },
            detail: { x: 15, y: 300, width: 571, height: 250 },
            colorName: { x: 15, y: 550, width: 571, height: 50 }
        },
        shadow: {
            lowerRatio: 0.5,
            opacity: 18,
            blur: 5,
            offsetX: 0,
            offsetY: 4
        }
    },
    amazon: {
        canvasSize: 1001,
        firstImageArea: {
            x: 100,
            y: 100,
            width: 801,
            height: 801
        },
        restImageArea: {
            x: 40,
            y: 40,
            width: 921,
            height: 921
        },
        maxImagesPerVariant: 8,
        psdSourceRule: "hide-second-top-level-layer-then-export-png"
    }
});

module.exports = { WORKFLOW_RULES };
