
document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("loginForm");
    const errorMessage = document.getElementById("errorMessage");

    if (!form) {
        console.error("Login form not found. Check the form ID in login.html.");
        return;
    }

    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
    let toastTimer;

    function showToast(message, type = "error") {
        const toast = document.getElementById("formToast");
        if (!toast) return alert(message);

        const isSuccess = type === "success";
        const icon = toast.querySelector(".toast-icon");
        const title = toast.querySelector(".toast-title");
        const body = toast.querySelector(".toast-message");

        toast.classList.toggle("success", isSuccess);
        if (icon) icon.textContent = isSuccess ? "✓" : "!";
        if (title) title.textContent = isSuccess ? "Success" : "Please check your details";
        if (body) body.textContent = message;
        else toast.textContent = message;

        toast.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove("show"), 4500);
    }

    document.addEventListener("click", (event) => {
        if (event.target.closest(".toast-close")) {
            document.getElementById("formToast")?.classList.remove("show");
        }
    });

    const notice = sessionStorage.getItem("bp_auth_notice");
    if (notice) {
        showToast(notice);
        sessionStorage.removeItem("bp_auth_notice");
    }

    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const toggleBtn = document.getElementById("passwordToggle");
    const rememberBox = document.getElementById("remember");
    const REMEMBER_KEY = "bp_remembered_email";

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

    function friendlyAuthError(error) {
        const msg = (error?.message || "").toLowerCase();
        if (msg.includes("invalid login credentials")) return "Incorrect email or password.";
        if (msg.includes("email not confirmed")) return "Please verify your email first. Check your inbox for the confirmation link.";
        if (error?.status === 429 || msg.includes("rate limit")) return "Too many attempts. Please wait a moment and try again.";
        if (msg.includes("failed to fetch") || msg.includes("network")) return "Network error. Check your connection and try again.";
        return error?.message || "Sign in failed. Please try again.";
    }

    const HOME_BY_ROLE = {
        resident: "../index.html",
        staff: "../Staff/StaffPage/staff.html",
        admin: "../Admin/admin.html"
    };

    // Already signed in with an active account: go straight to that portal.
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

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const email = document.getElementById("email")?.value.trim().toLowerCase();
        const password = document.getElementById("password")?.value;

        const missing = [];
        if (!email) missing.push("Email Address");
        if (!password) missing.push("Password");

        if (missing.length > 0) {
            showToast("Please fill in: " + missing.join(", "));
            (!email ? emailInput : passwordInput)?.focus();
            return;
        }

        if (!EMAIL_REGEX.test(email)) {
            showToast("Enter a valid email address, e.g. name@example.com.");
            emailInput?.focus();
            return;
        }

        let redirecting = false;
        const button = form.querySelector('[type="submit"]');
        if (button) button.disabled = true;

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

            showToast("Signed in successfully. Redirecting...", "success");
            redirecting = true;
            window.location.href = home;
        } catch (error) {
            console.error("Login error:", error);

            showToast(friendlyAuthError(error));
        } finally {
            if (button && !redirecting) button.disabled = false;
        }
    });
});
