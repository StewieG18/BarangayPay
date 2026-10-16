/* BarangayPay shared helpers.
   Load after the supabase-js CDN script and js/supabase.js.
   Provides window.BP with formatting helpers, a role guard, and the
   sidebar / header / sign-out wiring every portal page needs. */
(() => {
    "use strict";

    // Site root, worked out from this script's own address (<root>/js/app.js),
    // so links work no matter how deep the page is or where the site is served.
    const ROOT = new URL("../", document.currentScript.src);

    const HOME_BY_ROLE = {
        resident: "index.html",
        staff: "Staff/StaffPage/staff.html",
        admin: "Admin/admin.html"
    };

    const url = (path) => new URL(path, ROOT).href;

    const escapeHTML = (value) =>
        String(value ?? "").replace(/[&<>"']/g, (character) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]);

    const peso = (amount) =>
        new Intl.NumberFormat("en-PH", {
            style: "currency",
            currency: "PHP"
        }).format(Number(amount) || 0);

    function formatDate(value) {
        if (!value) return "—";

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "—";

        return date.toLocaleDateString("en-PH", {
            year: "numeric",
            month: "short",
            day: "numeric"
        });
    }

    const initials = (name) =>
        String(name || "")
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0].toUpperCase())
            .join("");

    const fullName = (row) =>
        [row?.first_name, row?.middle_name, row?.last_name]
            .filter((part) => part && String(part).trim())
            .join(" ");

    const capitalize = (text) => {
        const value = String(text || "").replace(/_/g, " ");
        return value.charAt(0).toUpperCase() + value.slice(1);
    };

    // Reads the JSON error body an Edge Function returned, if any.
    async function functionError(error) {
        try {
            const body = await error.context.json();
            if (body && body.error) return body.error;
        } catch (_) {
            /* fall back to the generic message */
        }
        return error.message || "Something went wrong.";
    }

    function getClient() {
        if (!window.supabaseClient) {
            throw new Error(
                "Supabase is not initialized. Check the script tags and js/supabase.js."
            );
        }
        return window.supabaseClient;
    }

    /* Makes sure an active user with one of `roles` is signed in.
       Anyone else is sent to the login page or their own portal.
       Resolves to { user, profile }, or null while redirecting. */
    async function requireRole(roles) {
        const client = getClient();

        const { data, error } = await client.auth.getSession();
        if (error) throw error;

        const session = data.session;
        if (!session) {
            window.location.replace(url("login/login.html"));
            return null;
        }

        const { data: profile, error: profileError } = await client
            .from("profiles")
            .select("*")
            .eq("id", session.user.id)
            .maybeSingle();

        if (profileError) throw profileError;

        if (!profile || profile.status !== "active") {
            await client.auth.signOut();
            window.location.replace(url("login/login.html"));
            return null;
        }

        if (!roles.includes(profile.role)) {
            window.location.replace(url(HOME_BY_ROLE[profile.role] || "login/login.html"));
            return null;
        }

        return {
            user: session.user,
            profile: { ...profile, email: profile.email || session.user.email }
        };
    }

    const DOCUMENTS_BUCKET = "request-documents";
    const SIGNED_URL_SECONDS = 60;

    // document_paths may arrive as an array, a JSON string, or a single path.
    function parsePaths(paths) {
        let files = paths;

        if (typeof files === "string") {
            try {
                files = JSON.parse(files);
            } catch (_) {
                files = files ? [files] : [];
            }
        }

        if (!Array.isArray(files)) files = files ? [files] : [];

        return files
            .map((file) => (typeof file === "string" ? file : file?.path || file?.url || ""))
            .filter(Boolean);
    }

    // Opens an uploaded requirement in a new tab through a short-lived signed URL.
    async function openStoredFile(path) {
        // Open the tab now so pop-up blockers allow it, then point it at the file.
        const tab = window.open("", "_blank");

        try {
            let target = path;

            if (!/^https?:\/\//i.test(path)) {
                const { data, error } = await getClient().storage
                    .from(DOCUMENTS_BUCKET)
                    .createSignedUrl(path, SIGNED_URL_SECONDS);

                if (error || !data?.signedUrl) throw error || new Error("No signed URL returned.");
                target = data.signedUrl;
            }

            if (tab) {
                tab.opener = null;
                tab.location.href = target;
            } else {
                window.open(target, "_blank", "noopener,noreferrer");
            }
        } catch (error) {
            tab?.close();
            console.error("Could not open the file:", error);
            window.alert("Unable to open this file. It may have been removed or you may not have access.");
        }
    }

    async function signOut() {
        try {
            await getClient().auth.signOut();
        } catch (error) {
            console.error("Sign out failed:", error);
        }
        window.location.href = url("login/login.html");
    }

    // Every link that points at the login page becomes a real sign-out.
    function wireSignOut() {
        document.querySelectorAll('a[href$="login/login.html"]').forEach((link) => {
            link.addEventListener("click", (event) => {
                event.preventDefault();
                signOut();
            });
        });
    }

    function wireToggle(buttonId, targetId, className) {
        const button = document.getElementById(buttonId);
        const target = document.getElementById(targetId);
        if (!button || !target) return;

        button.addEventListener("click", (event) => {
            event.stopPropagation();
            target.classList.toggle(className);
        });
    }

    // Staff pages use either #staffUserDropdown (.show) or #staffUserMenu (.open).
    function wireStaffDropdown() {
        const button = document.getElementById("staffUserButton");
        const dropdown = document.getElementById("staffUserDropdown");
        const menu = document.getElementById("staffUserMenu");
        if (!button) return;

        button.addEventListener("click", (event) => {
            event.stopPropagation();
            if (dropdown) dropdown.classList.toggle("show");
            else if (menu) menu.classList.toggle("open");
        });

        document.addEventListener("click", () => {
            dropdown?.classList.remove("show");
            menu?.classList.remove("open");
        });
    }

    function fillHeader(profile, selectors) {
        const name = profile.full_name || profile.email || "";

        document.querySelectorAll(selectors.name).forEach((el) => {
            if (name) el.textContent = name;
        });
        document.querySelectorAll(selectors.avatar).forEach((el) => {
            el.textContent = initials(name) || "?";
        });
    }

    /* One call per page: guard, header, sidebar toggle, sign-out.
       portal: "resident" | "staff" | "admin". */
    async function initPortal(portal) {
        const roles = portal === "staff" ? ["staff", "admin"] : [portal];

        wireSignOut();

        if (portal === "staff") {
            wireToggle("staffMenuToggle", "staffSidebar", "open");
            wireStaffDropdown();
        } else if (portal === "resident") {
            wireToggle("menuToggle", "sidebar", "open");
        }

        const auth = await requireRole(roles);
        if (!auth) return null;

        if (portal === "staff") {
            fillHeader(auth.profile, {
                name: ".staff-user-info strong, .staff-user-information strong",
                avatar: ".staff-avatar"
            });
        } else if (portal === "resident") {
            fillHeader(auth.profile, {
                name: ".user-information strong",
                avatar: ".user-menu .user-avatar"
            });
        }

        return auth;
    }

    window.BP = Object.freeze({
        url,
        escapeHTML,
        peso,
        formatDate,
        initials,
        fullName,
        capitalize,
        functionError,
        getClient,
        requireRole,
        initPortal,
        parsePaths,
        openStoredFile,
        signOut
    });
})();
