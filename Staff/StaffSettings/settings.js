/* Staff settings: account details (profiles table), password change, and
   notification / system preferences (stored in the user's auth metadata). */
(() => {
    "use strict";

    const PHONE_RE = /^(09|\+639)\d{9}$/;
    const NAME_MIN_LENGTH = 2;

    const $ = (id) => document.getElementById(id);

    let currentProfile = null;

    /* ---------- section tabs ---------- */

    const navButtons = document.querySelectorAll(".settings-nav-button");
    const sections = document.querySelectorAll(".settings-section");

    navButtons.forEach((button) => {
        button.addEventListener("click", () => {
            navButtons.forEach((item) => item.classList.toggle("active", item === button));
            sections.forEach((section) =>
                section.classList.toggle("active", section.id === button.dataset.section));
        });
    });

    /* ---------- feedback ---------- */

    function notify(form, text, isError = false) {
        let box = form.querySelector(".bp-settings-message");

        if (!box) {
            box = document.createElement("p");
            box.className = "bp-settings-message";
            box.setAttribute("role", "status");
            box.style.cssText = "margin:12px 0 0;font-size:14px;";
            form.appendChild(box);
        }

        box.textContent = text;
        box.style.color = isError ? "#b42318" : "#176534";
    }

    async function withButton(button, task) {
        if (button) button.disabled = true;
        try {
            await task();
        } finally {
            if (button) button.disabled = false;
        }
    }

    /* ---------- account ---------- */

    function fillAccount(profile) {
        const parts = String(profile.full_name || "").trim().split(/\s+/).filter(Boolean);

        $("firstName").value = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] || "";
        $("lastName").value = parts.length > 1 ? parts[parts.length - 1] : "";
        $("email").value = profile.email || "";
        $("mobile").value = profile.phone || "";
        $("position").value = profile.role === "admin" ? "Administrator" : "Barangay Staff";
    }

    function readAccount() {
        const firstName = $("firstName").value.trim();
        const lastName = $("lastName").value.trim();
        const phone = $("mobile").value.trim().replace(/[\s-]/g, "");

        if (firstName.length < NAME_MIN_LENGTH) return { error: "Enter your first name." };
        if (lastName.length < NAME_MIN_LENGTH) return { error: "Enter your last name." };
        if (phone && !PHONE_RE.test(phone)) {
            return { error: "Enter a valid mobile number, e.g. 09171234567." };
        }

        return { updates: { full_name: `${firstName} ${lastName}`, phone: phone || null } };
    }

    $("accountForm")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const { updates, error } = readAccount();

        if (error) {
            notify(form, error, true);
            return;
        }

        withButton(form.querySelector('[type="submit"]'), async () => {
            const { data, error: saveError } = await BP.getClient()
                .from("profiles")
                .update(updates)
                .eq("id", currentProfile.id)
                .select()
                .single();

            if (saveError) {
                console.error("Saving account failed:", saveError);
                notify(form, `Could not save: ${saveError.message}`, true);
                return;
            }

            currentProfile = { ...currentProfile, ...data };
            fillAccount(currentProfile);
            document.querySelectorAll(".staff-user-info strong").forEach((el) => {
                el.textContent = currentProfile.full_name;
            });
            notify(form, "Account information saved.");
        });
    });

    /* ---------- password ---------- */

    $("passwordForm")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = event.currentTarget;

        withButton(form.querySelector('[type="submit"]'), async () => {
            try {
                await BPPassword.changePassword(
                    $("currentPassword").value,
                    $("newPassword").value,
                    $("confirmPassword").value
                );
                form.reset();
                notify(form, "Password updated successfully.");
            } catch (error) {
                notify(form, error.message, true);
            }
        });
    });

    // Two-factor sign-in is not set up for this project yet; say so plainly.
    const twoFactor = $("twoFactor");
    if (twoFactor) {
        twoFactor.checked = false;
        twoFactor.disabled = true;
        twoFactor.closest("label")?.setAttribute("title", "Two-factor authentication is not available yet.");
    }

    /* ---------- preferences ---------- */

    const notificationInputs = () =>
        [...document.querySelectorAll('#notifications input[type="checkbox"]')];
    const systemSelects = () => [...document.querySelectorAll("#system select")];

    function applyPreferences(preferences) {
        const notifications = preferences?.notifications || [];
        const system = preferences?.system || [];

        notificationInputs().forEach((input, index) => {
            if (typeof notifications[index] === "boolean") input.checked = notifications[index];
        });
        systemSelects().forEach((select, index) => {
            const value = system[index];
            if (Number.isInteger(value) && value >= 0 && value < select.options.length) {
                select.selectedIndex = value;
            }
        });
    }

    async function savePreferences(button) {
        const preferences = {
            notifications: notificationInputs().map((input) => input.checked),
            system: systemSelects().map((select) => select.selectedIndex)
        };
        const section = button.closest(".settings-section") || button.parentElement;

        await withButton(button, async () => {
            const { error } = await BP.getClient().auth.updateUser({
                data: { staff_preferences: preferences }
            });

            if (error) {
                console.error("Saving preferences failed:", error);
                notify(section, `Could not save: ${error.message}`, true);
                return;
            }
            notify(section, "Preferences saved.");
        });
    }

    $("saveNotifications")?.addEventListener("click", (event) => savePreferences(event.currentTarget));
    $("saveSystem")?.addEventListener("click", (event) => savePreferences(event.currentTarget));

    /* ---------- start ---------- */

    BP.initPortal("staff")
        .then((auth) => {
            if (!auth) return; // redirecting

            currentProfile = auth.profile;
            fillAccount(currentProfile);
            applyPreferences(auth.user.user_metadata?.staff_preferences);
        })
        .catch((error) => {
            console.error("Staff settings failed to load:", error);
            const form = $("accountForm");
            if (form) notify(form, "Could not load your account. Please sign in again.", true);
        });
})();
