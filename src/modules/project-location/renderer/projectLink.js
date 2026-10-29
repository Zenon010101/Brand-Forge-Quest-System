/* Shared BrandForge G: project locator. PSD files are location markers ONLY. */
(() => {
    "use strict";
    const api = window.brandProjectApp || (() => {
        try { return window.parent && window.parent.brandProjectApp; } catch (error) { return null; }
    })();
    if (!api) return;
    function node(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }
    function mount(container) {
        if (!container) return;
        let scanned = null;
        let last = null;
        let linked = null;
        let inProduction = false;
        // Linking must never depend on the count of imported images or IDs.
        // Each module requires its own output marker, while other roles are optional.
        const requiredRole = container.id === "sliderBrandProject" ? "slider" : "amazon";
        const heading = node("div", "projectlink-heading");
        heading.append(node("strong", "", "Google Drive Brand Project"), node("span", "", "PSD files = save-location markers only"));
        const controls = node("div", "projectlink-controls");
        const pathInput = node("input", "projectlink-input");
        pathInput.type = "text";
        pathInput.placeholder = "G:\\Shared drives\\...\\Brand #Project";
        pathInput.autocomplete = "off";
        pathInput.spellcheck = false;
        pathInput.setAttribute("aria-label", "Google Drive brand project folder path");
        const browse = node("button", "secondary", "Browse G: Project");
        browse.type = "button";
        const scanBtn = node("button", "secondary", "Detect Folders");
        scanBtn.type = "button";
        const lastBtn = node("button", "secondary", "Use Last Linked");
        lastBtn.type = "button";
        lastBtn.disabled = true;
        controls.append(pathInput, browse, scanBtn, lastBtn);
        const choices = node("div", "projectlink-choices");
        const notice = node("div", "projectlink-notice", "Link one G: brand/project per production batch. Raw images stay on D:. For mixed brands, run separate batches or use manual output selection." );
        notice.setAttribute("aria-live", "polite");
        const save = node("button", "primary projectlink-apply", "Use Detected Paths");
        save.type = "button";
        save.disabled = true;
        container.append(heading, controls, choices, notice, save);
        const selectors = {};
        function canApply() {
            return Boolean(!inProduction && scanned && selectors[requiredRole]?.value);
        }
        function updateApplyState() {
            save.disabled = !canApply();
        }
        document.addEventListener("brandforge:project-busy", event => {
            inProduction = Boolean(event.detail?.busy);
            for (const control of [pathInput, browse, scanBtn, save, ...Object.values(selectors)]) {
                control.disabled = inProduction || (control === save && !canApply()) ||
                    (control.tagName === "SELECT" && !control.options.length);
            }
            lastBtn.disabled = inProduction || !last;
            updateApplyState();
        });
        document.addEventListener("brandforge:project-manual", () => {
            linked = null;
            say("Manual output folder selected. Click Use Detected Paths again to restore automatic G: destinations.");
        });
        function say(message, warn = false) {
            notice.textContent = message;
            notice.classList.toggle("projectlink-warning", warn);
        }
        function informLinked(project) {
            linked = project;
            document.dispatchEvent(new CustomEvent("brandforge:project-linked", { detail: { project } }));
            const used = Object.entries(project.roles).filter(([, info]) => info).map(([role]) => role.toUpperCase());
            const output = project.roles?.[requiredRole]?.folderPath || "";
            say(`Linked ${project.name}: ${used.join(" + ")}. ${requiredRole.toUpperCase()} output: ${output}. PSD markers stay untouched.`);
        }
        function unlinked() {
            if (!linked) return;
            linked = null;
            document.dispatchEvent(new CustomEvent("brandforge:project-unlinked"));
        }
        pathInput.addEventListener("input", () => {
            scanned = null;
            choices.replaceChildren();
            updateApplyState();
            unlinked();
            say("Project path changed. Click Detect Folders, review PSD markers, then Use Detected Paths.");
        });
        browse.onclick = async () => {
            try {
                const result = await api.chooseRoot();
                if (!result?.root) return;
                pathInput.value = result.root;
                unlinked();
                await scan();
            } catch (error) { say(error.message || String(error), true); }
        };
        async function scan() {
            const root = pathInput.value.trim();
            scanned = null;
            updateApplyState();
            choices.replaceChildren();
            if (inProduction) return;
            if (!root) { say("Select or paste the main Google Drive brand folder.", true); return; }
            say("Checking PSD markers and module folders...");
            const result = await api.scan(root);
            if (!result?.ok) { say(result?.error || "Project scan failed.", true); return; }
            scanned = result.project;
            pathInput.value = scanned.root;
            for (const role of ["amazon", "slider", "colorbox"]) {
                const spec = scanned.roles[role];
                const group = node("div", "projectlink-role");
                const label = node("label", "", role.toUpperCase());
                const select = node("select", "projectlink-select");
                select.setAttribute("aria-label", `${role} PSD location marker`);
                const empty = node("option", "", spec.choices.length ? "Choose PSD marker / output folder" : "No PSD marker found — choose output manually");
                empty.value = "";
                select.append(empty);
                for (const file of spec.choices) {
                    const option = node("option", "", file.label);
                    option.value = file.markerPath;
                    select.append(option);
                }
                if (spec.selectedMarker) select.value = spec.selectedMarker;
                select.disabled = !spec.choices.length;
                selectors[role] = select;
                group.append(label, select);
                const hint = node("small", "");
                function showDestination() {
                    const matched = spec.choices.find(x => x.markerPath === select.value);
                    hint.textContent = matched
                        ? `Output folder: ${matched.folderPath} (PSD marker is read-only)`
                        : (spec.choices.length
                            ? "Several markers possible. Select the PSD in the actual output folder."
                            : "No verified destination. Manual Choose Folder remains available.");
                }
                select.addEventListener("change", () => {
                    showDestination();
                    updateApplyState();
                });
                showDestination();
                group.append(hint);
                choices.append(group);
            }
            updateApplyState();
            const required = scanned.roles[requiredRole];
            if (canApply()) {
                say(`${scanned.name}: ${requiredRole.toUpperCase()} destination detected. Confirm the selected PSD marker and click Use Detected Paths. The original PSD is protected.`);
            } else {
                say(`${scanned.name}: ${requiredRole.toUpperCase()} PSD location is ${required?.status || "missing"}. Select a valid marker above or use the manual Choose Folder option.`, true);
            }
        }
        scanBtn.onclick = () => scan().catch(error => say(error.message || String(error), true));
        save.onclick = async () => {
            if (!canApply()) {
                say(`Choose a valid ${requiredRole.toUpperCase()} PSD marker before applying the detected paths.`, true);
                return;
            }
            const selection = Object.fromEntries(["amazon", "slider", "colorbox"].map(role => [role, selectors[role]?.value || ""]));
            const result = await api.link(scanned.root, selection);
            if (!result?.ok) { say(result?.error || "Could not link this brand project.", true); return; }
            last = result.project;
            lastBtn.disabled = false;
            informLinked(result.project);
        };
        lastBtn.onclick = async () => {
            const response = await api.last();
            if (!response?.project) { say(response?.warning || "Saved project needs rescanning.", true); return; }
            const project = response.project;
            if (!project.roles?.[requiredRole]?.markerPath) {
                say(`Saved brand has no ${requiredRole.toUpperCase()} output marker. Detect Folders or choose the output manually.`, true);
                return;
            }
            pathInput.value = project.root;
            await scan();
            if (!scanned) return;
            for (const role of ["amazon", "slider", "colorbox"]) {
                const marker = project.roles?.[role]?.markerPath || "";
                if (selectors[role]) {
                    selectors[role].value = marker;
                    selectors[role].dispatchEvent(new Event("change"));
                }
            }
            updateApplyState();
            informLinked(project);
        };
        api.last().then(response => {
            if (response?.lastRoot && !pathInput.value) pathInput.value = response.lastRoot;
            if (response?.project) { last = response.project; lastBtn.disabled = false; say(`Last linked: ${response.project.name}. Click Use Last Linked to apply, or select another brand.`); }
        }).catch(() => {});
    }
    window.BrandForgeProjectLink = { mount };
})();
