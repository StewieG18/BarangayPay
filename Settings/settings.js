/* Resident settings: notification preferences (stored in the user's
   Supabase auth metadata) and password change. */
(() => {
    "use strict";

    const PREFERENCE_IDS = {
        transactions: "transactionNotifications",
        payments: "paymentNotifications",
        documents: "documentNotifications",
        general: "generalNotifications",
        email: "emailNotifications"
    };

    const DEFAULT_PREFERENCES = Object.freeze({
        transactions: true,
        payments: true,
        documents: true,
        general: true,
        email: true
    });

    let savedPreferences = DEFAULT_PREFERENCES;

    const saveButton = document.getElementById("saveSettings");
    const resetButton = document.getElementById("resetSettings");

    let messageBox = null;

    function showMessage(text, isError = false) {
        if (!messageBox) {
            messageBox = document.createElement("p");
            messageBox.setAttribute("role", "status");
            messageBox.style.cssText = "margin:12px 0 0;font-size:14px;";
            document.querySelector(".settings-actions")?.after(messageBox);
        }
        messageBox.textContent = text;
        messageBox.style.color = isError ? "#b42318" : "#176534";
    }

    function applyToForm(preferences) {
        Object.entries(PREFERENCE_IDS).forEach(([key, id]) => {
            const input = document.getElementById(id);
            if (input) input.checked = preferences[key] !== false;
        });
    }

    function readForm() {
        return Object.fromEntries(
            Object.entries(PREFERENCE_IDS).map(([key, id]) => [
                key,
                Boolean(document.getElementById(id)?.checked)
            ])
        );
    }

    async function save() {
        const preferences = readForm();
        saveButton.disabled = true;

        try {
            const { error } = await window.BP.getClient().auth.updateUser({
                data: { notification_preferences: preferences }
            });
            if (error) throw error;

            savedPreferences = preferences;
            showMessage("Your settings have been saved.");
        } catch (error) {
            console.error("Saving settings failed:", error);
            showMessage(`Could not save your settings: ${error.message}`, true);
        } finally {
            saveButton.disabled = false;
        }
    }

    async function init() {
        try {
            const auth = await window.BP.initPortal("resident");
            if (!auth) return;

            savedPreferences = {
                ...DEFAULT_PREFERENCES,
                ...(auth.user.user_metadata?.notification_preferences || {})
            };
            applyToForm(savedPreferences);
        } catch (error) {
            console.error("Settings failed to load:", error);
            showMessage("Unable to load your settings. Please refresh the page.", true);
            return;
        }

        saveButton?.addEventListener("click", save);
        resetButton?.addEventListener("click", () => {
            applyToForm(savedPreferences);
            showMessage("Changes discarded.");
        });

        document.getElementById("changePasswordLink")?.addEventListener("click", (event) => {
            event.preventDefault();
            window.BPPassword.openDialog(() => showMessage("Your password has been updated."));
        });
    }

    init();
})();
