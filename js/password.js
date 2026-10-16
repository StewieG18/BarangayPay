/* BarangayPay password helpers: strength rule shared with sign-up, and a
   change-password dialog (asks for the current password before changing it).
   Load after js/app.js. */
(() => {
    "use strict";

    const MIN_LENGTH = 8;
    const RULE_TEXT =
        "At least 8 characters with an uppercase letter, a lowercase letter, a number, and a symbol.";

    const isStrong = (password) =>
        typeof password === "string" &&
        password.length >= MIN_LENGTH &&
        /[A-Z]/.test(password) &&
        /[a-z]/.test(password) &&
        /[0-9]/.test(password) &&
        /[^A-Za-z0-9]/.test(password);

    /* Checks the current password, then sets the new one.
       Throws an Error with a user-facing message on failure. */
    async function changePassword(currentPassword, newPassword, confirmPassword) {
        if (!currentPassword) throw new Error("Enter your current password.");
        if (!isStrong(newPassword)) throw new Error(`New password: ${RULE_TEXT}`);
        if (newPassword !== confirmPassword) throw new Error("The new passwords do not match.");
        if (newPassword === currentPassword) {
            throw new Error("The new password must be different from the current one.");
        }

        const client = window.BP.getClient();
        const { data } = await client.auth.getUser();
        const email = data?.user?.email;
        if (!email) throw new Error("Your session has expired. Please sign in again.");

        const { error: verifyError } = await client.auth.signInWithPassword({
            email,
            password: currentPassword
        });
        if (verifyError) throw new Error("Your current password is incorrect.");

        const { error } = await client.auth.updateUser({ password: newPassword });
        if (error) throw new Error(error.message);
    }

    const STYLE = `
        .bp-pw-overlay { position: fixed; inset: 0; z-index: 99999; display: flex;
            align-items: center; justify-content: center; padding: 16px;
            background: rgba(0, 0, 0, 0.55); }
        .bp-pw-overlay[hidden] { display: none !important; }
        .bp-pw-dialog { width: 100%; max-width: 420px; padding: 24px; border-radius: 14px;
            background: #fff; color: #1f2937; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25); }
        .bp-pw-dialog h2 { margin: 0 0 6px; font-size: 20px; }
        .bp-pw-dialog p { margin: 0 0 14px; font-size: 13px; color: #64748b; }
        .bp-pw-dialog label { display: block; margin: 12px 0 4px; font-size: 13px; font-weight: 600; }
        .bp-pw-dialog input { width: 100%; box-sizing: border-box; padding: 10px 12px;
            border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
        .bp-pw-error { min-height: 18px; margin-top: 12px; color: #b42318; font-size: 13px; }
        .bp-pw-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
        .bp-pw-actions button { border: 0; border-radius: 8px; padding: 10px 16px;
            font: inherit; cursor: pointer; }
        .bp-pw-actions button:disabled { opacity: 0.6; cursor: not-allowed; }
        .bp-pw-cancel { background: #e5e7eb; color: #111827; }
        .bp-pw-save { background: #176b45; color: #fff; }
    `;

    let dialog = null;

    function buildDialog() {
        const style = document.createElement("style");
        style.textContent = STYLE;
        document.head.appendChild(style);

        const overlay = document.createElement("div");
        overlay.className = "bp-pw-overlay";
        overlay.hidden = true;
        overlay.innerHTML = `
            <form class="bp-pw-dialog" role="dialog" aria-modal="true"
                  aria-labelledby="bpPwTitle" novalidate>
                <h2 id="bpPwTitle">Change Password</h2>
                <p>${RULE_TEXT}</p>
                <label for="bpPwCurrent">Current password</label>
                <input type="password" id="bpPwCurrent" autocomplete="current-password" required>
                <label for="bpPwNew">New password</label>
                <input type="password" id="bpPwNew" autocomplete="new-password" required>
                <label for="bpPwConfirm">Confirm new password</label>
                <input type="password" id="bpPwConfirm" autocomplete="new-password" required>
                <div class="bp-pw-error" role="alert"></div>
                <div class="bp-pw-actions">
                    <button type="button" class="bp-pw-cancel">Cancel</button>
                    <button type="submit" class="bp-pw-save">Update Password</button>
                </div>
            </form>
        `;
        document.body.appendChild(overlay);

        const form = overlay.querySelector("form");
        const errorBox = overlay.querySelector(".bp-pw-error");
        const saveButton = overlay.querySelector(".bp-pw-save");
        let saving = false;
        let onDone = null;

        const close = () => {
            if (saving) return;
            overlay.hidden = true;
            form.reset();
            errorBox.textContent = "";
        };

        overlay.querySelector(".bp-pw-cancel").addEventListener("click", close);
        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) close();
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && !overlay.hidden) close();
        });

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (saving) return;

            errorBox.textContent = "";
            saving = true;
            saveButton.disabled = true;
            saveButton.textContent = "Updating...";

            try {
                await changePassword(
                    form.querySelector("#bpPwCurrent").value,
                    form.querySelector("#bpPwNew").value,
                    form.querySelector("#bpPwConfirm").value
                );
                saving = false;
                close();
                if (onDone) onDone();
            } catch (error) {
                errorBox.textContent = error.message;
            } finally {
                saving = false;
                saveButton.disabled = false;
                saveButton.textContent = "Update Password";
            }
        });

        return {
            open(callback) {
                onDone = callback;
                overlay.hidden = false;
                form.querySelector("#bpPwCurrent").focus();
            }
        };
    }

    // Opens the dialog; `onSuccess` runs after the password has changed.
    function openDialog(onSuccess) {
        if (!dialog) dialog = buildDialog();
        dialog.open(onSuccess);
    }

    window.BPPassword = Object.freeze({ isStrong, changePassword, openDialog, RULE_TEXT });
})();
