const pageMeta = {
    dashboard: ["Dashboard", "Production progress and workflow shortcuts."],
    slider: ["Slider Maker", "Creative, Lineup, Detail, Cut Image, and Slider shadow."],
    amazon: ["Amazon Generator", "Amazon JPG, custom master PSD, Colorbox, and variant processing."],
    "remove-bg": ["Remove Background + Shadow", "Batch cutout PNG QC and editable Slider contact shadow PSDs."],
    "landing-page": ["Landing Page Generator", "Reconstruct 1000px-wide landing pages from Single images and ordered screenshots."],
    "lp-folder": ["LP Folder Generator", "Auto-compose editable long LP PSD/PSB + high-quality JPEG from a folder of images."],
    progress: ["Progress & History", "Levels, EXP, achievements, brands, and Monday–Friday history."],
    settings: ["Settings", "System readiness, local profile, shared workflow rules, and app data."]
};

const navItems = Array.from(document.querySelectorAll(".nav-item"));
const pages = Array.from(document.querySelectorAll(".page"));
const pageTitle = document.getElementById("pageTitle");
const pageSubtitle = document.getElementById("pageSubtitle");
const appVersion = document.getElementById("appVersion");
const mainContent = document.querySelector(".main-content");
const profileApi = window.profileApp;

let profileDashboard = null;
let authMode = "login";
let settingsInitialized = false;

function showPage(pageName) {
    const meta = pageMeta[pageName] || pageMeta.dashboard;

    navItems.forEach(item => {
        item.classList.toggle("active", item.dataset.page === pageName);
    });

    pages.forEach(page => {
        page.classList.toggle("active", page.id === `page-${pageName}`);
    });

    pageTitle.textContent = meta[0];
    pageSubtitle.textContent = meta[1];

    const fullModule = ["slider", "amazon", "remove-bg", "landing-page", "lp-folder"].includes(pageName);
    mainContent.classList.toggle("embedded-module-active", fullModule);

    if (pageName === "dashboard" || pageName === "progress") {
        refreshProfileDashboard();
    }
}

navItems.forEach(item => {
    item.addEventListener("click", () => showPage(item.dataset.page));
});

document.querySelectorAll("[data-open]").forEach(button => {
    button.addEventListener("click", () => showPage(button.dataset.open));
});

function initials(name) {
    const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function kindLabel(kind) {
    if (kind === "slider") return "Slider";
    if (kind === "amazon") return "Amazon";
    if (kind === "colorbox") return "Colorbox";
    return "Production";
}

function setProfileMini(profile) {
    const name = profile?.displayName || profile?.username || "Not signed in";
    document.getElementById("profileAvatar").textContent = initials(name);
    document.getElementById("profileMiniName").textContent = name;
    document.getElementById("profileMiniLevel").textContent = profile
        ? `LV. ${profile.level.level} · ${profile.level.rank}`
        : "—";
    document.getElementById("settingsProfileText").textContent = profile
        ? `${name} · LV. ${profile.level.level} ${profile.level.rank}. EXP and history are stored locally on this computer.`
        : "Sign in to save EXP, levels, achievements, brands, and history.";
}

function renderDashboard(data) {
    if (!data?.authenticated || !data.profile) return;
    profileDashboard = data;
    const p = data.profile;
    const stats = p.stats || {};
    const level = p.level || {};

    setProfileMini(p);
    document.getElementById("dashboardDisplayName").textContent = p.displayName || p.username;
    document.getElementById("dashboardLevel").textContent = `LV. ${level.level}`;
    document.getElementById("dashboardRank").textContent = level.rank;
    document.getElementById("dashboardXpText").textContent = `${level.xpIntoLevel} / ${level.xpForNextLevel} EXP`;
    document.getElementById("dashboardXpTotal").textContent = `${p.xp} total EXP`;
    document.getElementById("dashboardXpFill").style.width = `${Math.round((level.progress || 0) * 100)}%`;

    document.getElementById("weekJobsStat").textContent = data.weekly?.totalEntries || 0;
    document.getElementById("brandStat").textContent = stats.uniqueBrandCount || 0;
    document.getElementById("sliderStat").textContent = stats.sliderJobs || 0;
    document.getElementById("amazonStat").textContent = stats.amazonVariants || 0;
    document.getElementById("streakStat").textContent = stats.successStreak || 0;

    const weekMini = document.getElementById("weekMini");
    weekMini.innerHTML = "";
    for (const day of data.weekly?.days || []) {
        const item = document.createElement("div");
        item.className = "week-mini-day";
        const label = document.createElement("span");
        label.textContent = day.label.slice(0, 3);
        const value = document.createElement("strong");
        value.textContent = String(day.entries.length);
        const xp = document.createElement("small");
        xp.textContent = `+${day.xp} XP`;
        item.append(label, value, xp);
        weekMini.appendChild(item);
    }

    const achievementMini = document.getElementById("achievementMini");
    achievementMini.innerHTML = "";
    const unlocked = (p.achievements || []).slice().reverse().slice(0, 3);
    if (!unlocked.length) {
        const empty = document.createElement("div");
        empty.className = "empty-copy";
        empty.textContent = "Complete production jobs to unlock achievements.";
        achievementMini.appendChild(empty);
    } else {
        unlocked.forEach(item => {
            const row = document.createElement("div");
            row.className = "achievement-mini-row";
            const icon = document.createElement("div");
            icon.className = "achievement-icon";
            icon.textContent = "★";
            const copy = document.createElement("div");
            const title = document.createElement("strong");
            title.textContent = item.title;
            const desc = document.createElement("span");
            desc.textContent = item.description;
            copy.append(title, desc);
            row.append(icon, copy);
            achievementMini.appendChild(row);
        });
    }
}

function renderProgress(data) {
    if (!data?.authenticated || !data.profile) return;
    const p = data.profile;
    const stats = p.stats || {};
    const level = p.level || {};

    document.getElementById("progressName").textContent = p.displayName || p.username;
    document.getElementById("progressRank").textContent = level.rank;
    document.getElementById("progressLevel").textContent = `LV. ${level.level}`;
    document.getElementById("progressXpTotal").textContent = `${p.xp} EXP`;
    document.getElementById("progressNextLevel").textContent = `${level.xpForNextLevel - level.xpIntoLevel} EXP to next level`;

    document.getElementById("lifetimeJobs").textContent = stats.totalJobs || 0;
    document.getElementById("lifetimeBrands").textContent = stats.uniqueBrandCount || 0;
    document.getElementById("lifetimeSlider").textContent = stats.sliderJobs || 0;
    document.getElementById("lifetimeAmazonJobs").textContent = stats.amazonJobs || 0;
    document.getElementById("lifetimeVariants").textContent = stats.amazonVariants || 0;
    document.getElementById("lifetimeColorboxes").textContent = stats.colorboxes || 0;
    document.getElementById("lifetimeOutputs").textContent = stats.outputFiles || 0;
    document.getElementById("lifetimeBestStreak").textContent = stats.bestStreak || 0;

    const weekly = data.weekly || { days: [], totalEntries: 0, totalXp: 0 };
    document.getElementById("weekSummary").textContent = `${weekly.totalEntries} entries · +${weekly.totalXp} EXP`;
    const board = document.getElementById("weekBoard");
    board.innerHTML = "";

    for (const day of weekly.days || []) {
        const column = document.createElement("section");
        column.className = "week-column";
        const head = document.createElement("div");
        head.className = "week-column-head";
        const h = document.createElement("strong");
        h.textContent = day.label;
        const meta = document.createElement("span");
        meta.textContent = `${day.entries.length} · +${day.xp} XP`;
        head.append(h, meta);
        column.appendChild(head);

        if (!day.entries.length) {
            const empty = document.createElement("div");
            empty.className = "history-empty";
            empty.textContent = "No production yet.";
            column.appendChild(empty);
        } else {
            day.entries.forEach(entry => {
                const card = document.createElement("div");
                card.className = `history-card ${entry.status === "partial" ? "partial" : ""}`;
                const row = document.createElement("div");
                row.className = "history-card-top";
                const kind = document.createElement("span");
                kind.className = `history-kind kind-${entry.kind}`;
                kind.textContent = kindLabel(entry.kind);
                const time = document.createElement("span");
                time.textContent = formatTime(entry.timestamp);
                row.append(kind, time);
                const title = document.createElement("strong");
                title.textContent = entry.label || "Completed job";
                const subtitle = document.createElement("span");
                subtitle.className = "history-subtitle";
                subtitle.textContent = entry.subtitle || `${entry.itemCount || 0} item(s)`;
                const xp = document.createElement("b");
                xp.className = "history-xp";
                xp.textContent = `+${entry.xp || 0} EXP`;
                card.append(row, title, subtitle, xp);
                column.appendChild(card);
            });
        }
        board.appendChild(column);
    }

    const achievementGrid = document.getElementById("achievementGrid");
    achievementGrid.innerHTML = "";
    for (const item of data.achievementCatalog || []) {
        const card = document.createElement("div");
        card.className = `achievement-card ${item.unlocked ? "unlocked" : "locked"}`;
        const icon = document.createElement("div");
        icon.className = "achievement-large-icon";
        icon.textContent = item.unlocked ? "★" : "☆";
        const copy = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = item.title;
        const desc = document.createElement("span");
        desc.textContent = item.description;
        copy.append(title, desc);
        card.append(icon, copy);
        achievementGrid.appendChild(card);
    }

    const collection = document.getElementById("brandCollection");
    collection.innerHTML = "";
    const brands = (stats.uniqueBrands || []).slice().sort((a, b) => a.localeCompare(b));
    if (!brands.length) {
        const empty = document.createElement("div");
        empty.className = "empty-copy";
        empty.textContent = "Brands will appear here after successful Amazon jobs or Slider jobs with a Brand entered.";
        collection.appendChild(empty);
    } else {
        brands.forEach(brand => {
            const chip = document.createElement("span");
            chip.className = "brand-chip";
            chip.textContent = brand;
            collection.appendChild(chip);
        });
    }
}

async function refreshProfileDashboard() {
    if (!profileApi) return;
    try {
        const data = await profileApi.getDashboard();
        if (!data?.authenticated) {
            await requireAuthentication();
            return;
        }
        renderDashboard(data);
        renderProgress(data);
    } catch (error) {
        console.error("Could not refresh profile dashboard", error);
    }
}

function setAuthMode(mode) {
    authMode = mode === "create" ? "create" : "login";
    document.getElementById("signInTab").classList.toggle("active", authMode === "login");
    document.getElementById("createTab").classList.toggle("active", authMode === "create");
    document.getElementById("displayNameField").hidden = authMode !== "create";
    document.getElementById("authSubmit").textContent = authMode === "create" ? "Create Profile" : "Sign In";
    document.getElementById("authPassword").autocomplete = authMode === "create" ? "new-password" : "current-password";
    document.getElementById("authError").textContent = "";
}

async function requireAuthentication() {
    if (!profileApi) return;
    const session = await profileApi.getSession();
    if (session.authenticated) {
        document.getElementById("authOverlay").hidden = true;
        setProfileMini(session.profile);
        return true;
    }
    setAuthMode(session.hasAccounts ? "login" : "create");
    document.getElementById("authOverlay").hidden = false;
    return false;
}

async function doLogout() {
    if (!profileApi) return;
    await profileApi.logout();
    profileDashboard = null;
    setProfileMini(null);
    document.getElementById("authForm").reset();
    await requireAuthentication();
}

document.getElementById("signInTab").addEventListener("click", () => setAuthMode("login"));
document.getElementById("createTab").addEventListener("click", () => setAuthMode("create"));
document.getElementById("logoutBtn").addEventListener("click", doLogout);
document.getElementById("settingsLogoutBtn").addEventListener("click", doLogout);

document.getElementById("authForm").addEventListener("submit", async event => {
    event.preventDefault();
    const submit = document.getElementById("authSubmit");
    const errorBox = document.getElementById("authError");
    submit.disabled = true;
    errorBox.textContent = "";

    try {
        const payload = {
            username: document.getElementById("authUsername").value,
            password: document.getElementById("authPassword").value,
            displayName: document.getElementById("authDisplayName").value
        };
        const result = authMode === "create"
            ? await profileApi.createAccount(payload)
            : await profileApi.login(payload);
        if (!result?.ok) throw new Error(result?.error || "Authentication failed.");

        document.getElementById("authOverlay").hidden = true;
        document.getElementById("authForm").reset();
        setProfileMini(result.profile);
        await refreshProfileDashboard();
    } catch (error) {
        errorBox.textContent = error?.message || String(error);
    } finally {
        submit.disabled = false;
    }
});

async function initSettings() {
    if (settingsInitialized) return;
    settingsInitialized = true;
    const api = window.settingsApp;
    if (!api) return;

    const testBtn = document.getElementById("testPhotoshopBtn");
    const psStatus = document.getElementById("photoshopStatus");
    const openDataBtn = document.getElementById("openUserDataBtn");
    const resetBtn = document.getElementById("resetFoldersBtn");
    const userDataPath = document.getElementById("userDataPath");

    try {
        const settings = await api.get();
        userDataPath.textContent = settings.userDataPath || "—";

        const shadow = settings.sharedRules?.sliderShadow;
        const slider = settings.sharedRules?.slider;
        const amazon = settings.sharedRules?.amazon;

        if (shadow) {
            document.getElementById("settingsShadowRule").textContent =
                `Lower ${Math.round(shadow.lowerRatio * 100)}% · ${shadow.opacity}% · Blur ${shadow.blurPx}px · X ${shadow.offsetX} · Y ${shadow.offsetY >= 0 ? "+" : ""}${shadow.offsetY}`;
        }
        if (slider) {
            document.getElementById("settingsSliderCutRule").textContent =
                `${slider.canvas} × ${slider.detailCutVisibleHeight} + ${slider.detailBottomWhite}px white`;
        }
        if (amazon) {
            document.getElementById("settingsAmazonFirst").textContent = `${amazon.firstArea} × ${amazon.firstArea}`;
            document.getElementById("settingsAmazonRest").textContent = `${amazon.restArea} × ${amazon.restArea}`;
        }
    } catch (error) {
        userDataPath.textContent = "Could not load settings.";
    }

    testBtn?.addEventListener("click", async () => {
        testBtn.disabled = true;
        psStatus.className = "settings-status";
        psStatus.textContent = "Testing Photoshop automation...";
        try {
            const result = await api.testPhotoshop();
            if (result?.ok) {
                psStatus.className = "settings-status ok";
                psStatus.textContent = `Photoshop detected · version ${result.version}`;
            } else {
                psStatus.className = "settings-status error";
                psStatus.textContent = result?.error || "Photoshop could not be detected.";
            }
        } catch (error) {
            psStatus.className = "settings-status error";
            psStatus.textContent = error?.message || String(error);
        } finally {
            testBtn.disabled = false;
        }
    });

    openDataBtn?.addEventListener("click", async () => {
        const result = await api.openUserData();
        if (!result?.ok) alert(result?.error || "Could not open the app data folder.");
    });

    resetBtn?.addEventListener("click", async () => {
        if (!confirm("Reset remembered source/output folders for Slider and Amazon? Profile progress will not be deleted.")) return;
        resetBtn.disabled = true;
        try {
            const result = await api.resetRecentFolders();
            if (!result?.ok) throw new Error(result?.error || "Reset failed.");
            alert("Remembered folders were reset. Profile progress was kept.");
        } catch (error) {
            alert(`Could not reset remembered folders:\n\n${error?.message || error}`);
        } finally {
            resetBtn.disabled = false;
        }
    });
}

(async () => {
    try {
        const info = await window.workflowApp.getAppInfo();
        appVersion.textContent = `${info.name} v${info.version}`;
    } catch (error) {
        appVersion.textContent = "Image Workflow Studio";
    }

    await initSettings();
    const authenticated = await requireAuthentication();
    if (authenticated) await refreshProfileDashboard();
})();
