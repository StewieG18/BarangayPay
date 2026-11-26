document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("loginForm");

    if (!form) {
        console.error("Login form not found. Check the form ID in login.html.");
        return;
    }

    const formAlert = document.getElementById("formAlert");
    const toast = document.getElementById("formToast");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const toggleBtn = document.getElementById("passwordToggle");
    const rememberBox = document.getElementById("remember");
    const button = form.querySelector('[type="submit"]');
    const buttonLabel = form.querySelector(".button-label");

    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
    const REMEMBER_KEY = "bp_remembered_email";
    const TOAST_DURATION = 4500;
    const REDIRECT_DELAY = 1000;

    const STATES = {
        error: { icon: "!", title: "Please check your details" },
        warning: { icon: "!", title: "Check your input" },
        success: { icon: "✓", title: "Success" }
    };

    let toastTimer;
    let toastHideTimer;
    let redirecting = false;

    /* ---------------------------------------------------------
       NOTIFICATION HELPERS  (custom UI only)
       --------------------------------------------------------- */

    function applyState(element, type, iconSelector, titleSelector) {
        element.classList.remove("error", "warning", "success");
        element.classList.add(type);

        const icon = element.querySelector(iconSelector);
        const title = element.querySelector(titleSelector);

        if (icon) icon.textContent = STATES[type].icon;
        if (title) title.textContent = STATES[type].title;
    }

    function hideToast() {
        if (!toast) return;

        clearTimeout(toastTimer);
        toast.classList.remove("show");

        clearTimeout(toastHideTimer);
        toastHideTimer = setTimeout(() => {
            toast.hidden = true;
        }, 240);
    }

    function showToast(message, type = "error") {
        if (!toast) return;

        const body = toast.querySelector(".toast-message");
        if (!body) return;

        applyState(toast, type, ".toast-icon", ".toast-title");
        body.textContent = message;

        clearTimeout(toastHideTimer);
        toast.hidden = false;

        // Restart the progress bar and the slide-in for repeated messages.
        const progress = toast.querySelector(".toast-progress");
        if (progress) {
            progress.style.animation = "none";
            void progress.offsetWidth;
            progress.style.animation = "";
        }

        void toast.offsetWidth;
        toast.classList.add("show");

        clearTimeout(toastTimer);
        toastTimer = setTimeout(hideToast, TOAST_DURATION);
    }

    function hideInlineAlert() {
        if (!formAlert) return;
        formAlert.hidden = true;
        formAlert.classList.remove("shake");
    }

    function showInlineAlert(message, type = "error", shake = false) {
        if (!formAlert) return;

        const body = formAlert.querySelector(".form-alert-message");
        if (!body) return;

        applyState(formAlert, type, ".form-alert-icon", ".form-alert-title");
        body.textContent = message;

        formAlert.hidden = false;
        formAlert.classList.remove("shake");

        if (shake) {
            void formAlert.offsetWidth;
            formAlert.classList.add("shake");
        }
    }

    document.addEventListener("click", (event) => {
        if (event.target.closest(".toast-close")) hideToast();
        if (event.target.closest("[data-dismiss-alert]")) hideInlineAlert();
    });

    /* ---------------------------------------------------------
       FIELD STATE HELPERS
       --------------------------------------------------------- */

    function clearFieldError(input) {
        if (!input) return;
        input.classList.remove("is-invalid");
        input.closest(".input-wrapper")?.classList.remove("is-shaking");
    }

    function clearAllFieldErrors() {
        clearFieldError(emailInput);
        clearFieldError(passwordInput);
    }

    function markInvalid(input) {
        if (!input) return;

        input.classList.add("is-invalid");

        const wrapper = input.closest(".input-wrapper");
        if (wrapper) {
            wrapper.classList.remove("is-shaking");
            void wrapper.offsetWidth;
            wrapper.classList.add("is-shaking");
        }
    }

    [emailInput, passwordInput].forEach((input) => {
        input?.addEventListener("input", () => {
            clearFieldError(input);

            if (formAlert && !formAlert.hidden && !formAlert.classList.contains("success")) {
                hideInlineAlert();
            }
        });
    });

    /* ---------------------------------------------------------
       PASSWORD TOGGLE / REMEMBER ME
       --------------------------------------------------------- */

    toggleBtn?.addEventListener("click", () => {
        const show = passwordInput.type === "password";
        passwordInput.type = show ? "text" : "password";
        toggleBtn.textContent = show ? "Hide" : "Show";
        toggleBtn.setAttribute("aria-pressed", String(show));
        toggleBtn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });

    try {
        const saved = localStorage.getItem(REMEMBER_KEY);
        if (saved && emailInput) {
            emailInput.value = saved;
            if (rememberBox) rememberBox.checked = true;
        }
    } catch (_) { /* storage blocked */ }

    /* ---------------------------------------------------------
       HELPERS
       --------------------------------------------------------- */

    function friendlyAuthError(error) {
        const msg = (error?.message || "").toLowerCase();
        if (msg.includes("invalid login credentials")) {
            return "Incorrect email or password. Please try again.";
        }
        if (msg.includes("email not confirmed")) {
            return "Please verify your email first. Check your inbox for the confirmation link.";
        }
        if (error?.status === 429 || msg.includes("rate limit")) {
            return "Too many attempts. Please wait a moment and try again.";
        }
        if (msg.includes("failed to fetch") || msg.includes("network")) {
            return "Network error. Check your connection and try again.";
        }
        return error?.message || "Sign in failed. Please try again.";
    }

    const HOME_BY_ROLE = {
        resident: "../index.html",
        staff: "../Staff/StaffPage/staff.html",
        admin: "../Admin/admin.html"
    };

    function setLoading(loading) {
        if (!button) return;

        button.disabled = loading;
        button.classList.toggle("is-loading", loading);
        button.setAttribute("aria-busy", String(loading));

        if (buttonLabel) {
            buttonLabel.textContent = loading ? "Signing in..." : "Sign In";
        }
    }

    /* ---------------------------------------------------------
       AUTH NOTICE FROM ANOTHER PAGE
       --------------------------------------------------------- */

    const notice = sessionStorage.getItem("bp_auth_notice");
    if (notice) {
        showToast(notice);
        sessionStorage.removeItem("bp_auth_notice");
    }

    /* ---------------------------------------------------------
       ALREADY SIGNED IN
       --------------------------------------------------------- */

    (async () => {
        try {
            const { data } = await supabaseClient.auth.getSession();
            const user = data?.session?.user;
            if (!user) return;

            const { data: profile } = await supabaseClient
                .from("profiles")
                .select("role, status")
                .eq("id", user.id)
                .maybeSingle();

            if (profile?.status === "active" && HOME_BY_ROLE[profile.role]) {
                window.location.replace(HOME_BY_ROLE[profile.role]);
            }
        } catch (sessionError) {
            console.warn("Could not check the existing session:", sessionError);
        }
    })();

    /* ---------------------------------------------------------
       SUBMIT
       --------------------------------------------------------- */

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (redirecting) return;

        hideInlineAlert();
        hideToast();
        clearAllFieldErrors();

        const email = emailInput?.value.trim().toLowerCase() || "";
        const password = passwordInput?.value || "";

        const missing = [];
        if (!email) missing.push("Email Address");
        if (!password) missing.push("Password");

        if (missing.length > 0) {
            const message = "Please fill in: " + missing.join(", ") + ".";
            showInlineAlert(message, "warning", true);
            showToast(message, "warning");
            if (!email) markInvalid(emailInput);
            if (!password) markInvalid(passwordInput);
            (!email ? emailInput : passwordInput)?.focus();
            return;
        }

        if (!EMAIL_REGEX.test(email)) {
            const message = "Enter a valid email address, e.g. name@example.com.";
            showInlineAlert(message, "warning", true);
            showToast(message, "warning");
            markInvalid(emailInput);
            emailInput?.focus();
            return;
        }

        setLoading(true);

        try {
            if (!window.supabase || typeof supabaseClient === "undefined") {
                throw new Error("Supabase is not loaded. Check your script paths.");
            }

            const { data, error } =
                await supabaseClient.auth.signInWithPassword({
                    email,
                    password
                });

            if (error) throw error;

            const user = data.user;

            const { data: profile, error: profileError } =
                await supabaseClient
                    .from("profiles")
                    .select("role, status")
                    .eq("id", user.id)
                    .maybeSingle();

            if (profileError) {
                await supabaseClient.auth.signOut();
                throw new Error("Could not load your profile. Please try again.");
            }

            if (!profile) {
                await supabaseClient.auth.signOut();
                throw new Error("Your profile was not found. Please contact the administrator.");
            }

            if (profile.status !== "active") {
                await supabaseClient.auth.signOut();
                throw new Error("Your account is inactive. Please contact the administrator.");
            }

            const home = HOME_BY_ROLE[profile.role];

            if (!home) {
                await supabaseClient.auth.signOut();
                throw new Error("Your account has an unrecognized role.");
            }

            try {
                if (rememberBox?.checked) localStorage.setItem(REMEMBER_KEY, email);
                else localStorage.removeItem(REMEMBER_KEY);
            } catch (_) {}

            const message = "Login successful! Redirecting...";
            showInlineAlert(message, "success");
            showToast(message, "success");

            redirecting = true;
            setTimeout(() => {
                window.location.href = home;
            }, REDIRECT_DELAY);
        } catch (error) {
            console.error("Login error:", error);

            const message = friendlyAuthError(error);
            showInlineAlert(message, "error", true);
            showToast(message, "error");
            markInvalid(emailInput);
            markInvalid(passwordInput);

            setLoading(false);
        }
    });
});
