"use strict";

function levelRequirement(level) {
    return 100 + Math.max(0, level - 1) * 50;
}

function rankForLevel(level) {
    if (level <= 5) return "Rookie Operator";
    if (level <= 10) return "Image Operator";
    if (level <= 20) return "Production Specialist";
    if (level <= 30) return "Senior Specialist";
    if (level <= 40) return "Workflow Expert";
    if (level <= 50) return "Production Master";
    return "Automation Legend";
}

function levelInfo(totalXp) {
    let level = 1;
    let remaining = Math.max(0, Math.floor(totalXp || 0));
    let needed = levelRequirement(level);

    while (remaining >= needed && level < 999) {
        remaining -= needed;
        level++;
        needed = levelRequirement(level);
    }

    return {
        level,
        xpIntoLevel: remaining,
        xpForNextLevel: needed,
        progress: needed > 0 ? Math.min(1, remaining / needed) : 1,
        rank: rankForLevel(level)
    };
}

module.exports = { levelRequirement, levelInfo, rankForLevel };
