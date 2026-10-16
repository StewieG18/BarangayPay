/* BarangayPay admin portal
   1. Only an active admin can use this page.
   2. The Staff Management section shows real staff accounts and creates /
      edits them through the manage-staff Edge Function.
   Load this file AFTER the inline <script> in admin.html. */
(() => {
    "use strict";

    const PHONE_RE = /^(09|\+639)\d{9}$/;
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const state = {
        staff: [],
        mode: "add",       // "add" or "edit"
        editingId: null,
        saving: false
    };

    const $ = (id) => document.getElementById(id);

    /* ---------- small styles for the pieces added by this file ---------- */

    const style = document.createElement("style");
    style.textContent = `
        .sm-message {
            margin: 0 0 14px;
            padding: 10px 14px;
            border: 1px solid #bfe0c9;
            border-radius: 8px;
            background: #e8f5ec;
            color: #1e6b36;
            font-size: 13px;
        }
        .sm-message.sm-error {
            border-color: #f5c2be;
            background: #fdecea;
            color: #a3271f;
        }
        .sm-form-error {
            margin: 0 0 12px;
            color: #c62828;
            font-size: 13px;
            font-weight: 500;
        }
        .sm-hint {
            margin-top: 6px;
            color: #64748b;
            font-size: 12px;
        }
        .sm-empty {
            padding: 28px 16px;
            text-align: center;
            color: #64748b;
        }
        #staffSaveButton:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
    `;
    document.head.appendChild(style);

    /* ---------- helpers ---------- */

    function showPage() {
        document.documentElement.classList.remove("checking");
    }

    function initials(name) {
        return (name || "")
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0].toUpperCase())
            .join("");
    }

    async function readError(error) {
        try {
            const body = await error.context.json();
            if (body && body.error) return body.error;
        } catch (_) {
            /* fall through to the default message */
        }
        return error.message || "Something went wrong.";
    }

    let messageTimer = null;

    function setMessage(text, isError = false) {
        const box = $("staffMessage");
        if (!box) return;

        box.textContent = text;
        box.className = isError ? "sm-message sm-error" : "sm-message";
        box.hidden = false;

        clearTimeout(messageTimer);
        messageTimer = setTimeout(() => { box.hidden = true; }, 7000);
    }

    function showFormError(text) {
        const box = $("staffFormError");
        box.textContent = text;
        box.hidden = !text;
    }

    /* ---------- admin check ---------- */

    async function requireAdmin() {
        if (typeof supabaseClient === "undefined") {
            throw new Error(
                "Supabase is not initialized. Check the script tags and ../js/supabase.js."
            );
        }

        const { data: sessionData, error: sessionError } =
            await supabaseClient.auth.getSession();

        if (sessionError) throw sessionError;

        const session = sessionData.session;

        if (!session) {
            window.location.href = "../login/login.html";
            return null;
        }

        const { data: me, error: meError } = await supabaseClient
            .from("profiles")
            .select("id, full_name, email, phone, role, status")
            .eq("id", session.user.id)
            .maybeSingle();

        if (meError) throw meError;

        if (!me || me.role !== "admin" || me.status !== "active") {
            window.location.href = "../index.html";
            return null;
        }

        return me;
    }

    function applyAdminHeader(me) {
        const nameEl = document.querySelector(".user-info strong");
        if (nameEl && me.full_name) nameEl.textContent = me.full_name;

        const avatar = document.querySelector(".user-avatar");
        if (avatar) avatar.textContent = initials(me.full_name) || "AD";
    }

    function wireSignOut() {
        document
            .querySelectorAll('a[href$="login/login.html"]')
            .forEach((link) => {
                link.addEventListener("click", async (event) => {
                    event.preventDefault();

                    try {
                        await supabaseClient.auth.signOut();
                    } catch (error) {
                        console.error("Sign out failed:", error);
                    }

                    window.location.href = link.getAttribute("href");
                });
            });
    }

    /* ---------- staff interface ---------- */

    function buildStaffUi() {
        // Message line above the staff table
        const message = document.createElement("p");
        message.id = "staffMessage";
        message.className = "sm-message";
        message.hidden = true;
        message.setAttribute("role", "status");

        const card = document.querySelector("#staff .content-card");
        if (card) card.before(message);

        // "+ Add Staff" button
        const addButton = document.querySelector(
            "#staff .section-heading .primary-button"
        );
        if (addButton) {
            addButton.removeAttribute("onclick");
            addButton.addEventListener("click", openAddStaff);
        }

        // Replace the old static modal with a working one
        const oldModal = $("staffModal");
        if (oldModal) oldModal.remove();

        const modal = document.createElement("div");
        modal.className = "modal-overlay";
        modal.id = "staffModal";
        modal.innerHTML = `
            <div class="modal">

                <div class="modal-header">
                    <div>
                        <p class="eyebrow">STAFF MANAGEMENT</p>
                        <h2 id="staffModalTitle">Add Staff</h2>
                    </div>
                    <button type="button" class="modal-close"
                            id="staffModalClose" aria-label="Close">×</button>
                </div>

                <div class="modal-body">

                    <p class="sm-form-error" id="staffFormError"
                       role="alert" hidden></p>

                    <div class="form-row">
                        <div class="form-group">
                            <label for="staffFirstName">First Name</label>
                            <input type="text" id="staffFirstName" maxlength="50"
                                   placeholder="First name" autocomplete="off">
                        </div>

                        <div class="form-group">
                            <label for="staffLastName">Last Name</label>
                            <input type="text" id="staffLastName" maxlength="50"
                                   placeholder="Last name" autocomplete="off">
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="staffEmail">Email Address</label>
                        <input type="email" id="staffEmail"
                               placeholder="staff@barangaypay.gov.ph"
                               autocomplete="off">
                    </div>

                    <div class="form-group">
                        <label for="staffPhone">Mobile Number</label>
                        <input type="text" id="staffPhone" maxlength="16"
                               placeholder="09XX XXX XXXX" autocomplete="off">
                    </div>

                    <div class="form-group">
                        <label for="staffPassword" id="staffPasswordLabel">
                            Temporary Password
                        </label>
                        <input type="password" id="staffPassword"
                               placeholder="At least 8 characters"
                               autocomplete="new-password">
                        <p class="sm-hint" id="staffPasswordHint"></p>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label for="staffRole">Role</label>
                            <select id="staffRole" disabled>
                                <option>Staff</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="staffStatus">Account Status</label>
                            <select id="staffStatus">
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                            </select>
                        </div>
                    </div>

                </div>

                <div class="modal-footer">
                    <button type="button" class="secondary-button"
                            id="staffCancel">Cancel</button>
                    <button type="button" class="primary-button"
                            id="staffSaveButton">Add Staff</button>
                </div>

            </div>
        `;
        document.body.appendChild(modal);

        $("staffModalClose").addEventListener("click", () => closeModal("staffModal"));
        $("staffCancel").addEventListener("click", () => closeModal("staffModal"));
        $("staffSaveButton").addEventListener("click", saveStaff);

        modal.addEventListener("click", (event) => {
            if (event.target === modal && !state.saving) closeModal("staffModal");
        });
    }

    function resetForm() {
        ["staffFirstName", "staffLastName", "staffEmail", "staffPhone", "staffPassword"]
            .forEach((id) => { $(id).value = ""; });

        $("staffStatus").value = "active";
        showFormError("");
    }

    function openAddStaff() {
        state.mode = "add";
        state.editingId = null;
        resetForm();

        $("staffModalTitle").textContent = "Add Staff";
        $("staffSaveButton").textContent = "Add Staff";
        $("staffEmail").disabled = false;
        $("staffPasswordLabel").textContent = "Temporary Password";
        $("staffPasswordHint").textContent =
            "Share this with the staff member. They should change it after logging in.";

        openModal("staffModal");
        $("staffFirstName").focus();
    }

    function openEditStaff(id) {
        const member = state.staff.find((s) => s.id === id);
        if (!member) return;

        state.mode = "edit";
        state.editingId = id;
        resetForm();

        const parts = (member.full_name || "").trim().split(/\s+/).filter(Boolean);
        const lastName = parts.length > 1 ? parts[parts.length - 1] : "";
        const firstName = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] || "";

        $("staffFirstName").value = firstName;
        $("staffLastName").value = lastName;
        $("staffEmail").value = member.email || "";
        $("staffEmail").disabled = true;
        $("staffPhone").value = member.phone || "";
        $("staffStatus").value = member.status === "inactive" ? "inactive" : "active";

        $("staffModalTitle").textContent = "Edit Staff";
        $("staffSaveButton").textContent = "Save Changes";
        $("staffPasswordLabel").textContent = "New Password";
        $("staffPasswordHint").textContent =
            "Leave blank to keep the current password.";

        openModal("staffModal");
        $("staffFirstName").focus();
    }

    /* ---------- staff table ---------- */

    function cell(row, content, strong = false) {
        const td = document.createElement("td");

        if (strong) {
            const el = document.createElement("strong");
            el.textContent = content;
            td.appendChild(el);
        } else {
            td.textContent = content;
        }

        row.appendChild(td);
        return td;
    }

    function renderStaff() {
        const body = document.querySelector("#staff tbody");
        if (!body) return;

        body.replaceChildren();

        if (!state.staff.length) {
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = 5;
            td.className = "sm-empty";
            td.textContent = "No staff accounts yet. Use Add Staff to create one.";
            tr.appendChild(td);
            body.appendChild(tr);
        }

        state.staff.forEach((member) => {
            const tr = document.createElement("tr");

            cell(tr, member.full_name || "(no name)", true);
            cell(tr, member.email || "");
            cell(tr, "Staff");

            const statusCell = document.createElement("td");
            const badge = document.createElement("span");
            const isActive = member.status === "active";
            badge.className = `status ${isActive ? "active" : "inactive"}`;
            badge.textContent = isActive ? "Active" : "Inactive";
            statusCell.appendChild(badge);
            tr.appendChild(statusCell);

            const actionCell = document.createElement("td");
            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "table-button";
            edit.textContent = "Edit";
            edit.addEventListener("click", () => openEditStaff(member.id));
            actionCell.appendChild(edit);
            tr.appendChild(actionCell);

            body.appendChild(tr);
        });

        updateActiveStaffCount();
    }

    function updateActiveStaffCount() {
        const active = state.staff.filter((s) => s.status === "active").length;

        document.querySelectorAll(".summary-card").forEach((card) => {
            const label = card.querySelector("span");
            const value = card.querySelector("strong");

            if (label && value && label.textContent.trim() === "Active Staff") {
                value.textContent = String(active);
            }
        });
    }

    async function loadStaff() {
        const { data, error } = await supabaseClient
            .from("profiles")
            .select("id, full_name, email, phone, status")
            .eq("role", "staff")
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Could not load staff:", error);
            setMessage(`Could not load staff accounts: ${error.message}`, true);
            return;
        }

        state.staff = data || [];
        renderStaff();
    }

    /* ---------- save (create / update) ---------- */

    async function saveStaff() {
        if (state.saving) return;

        showFormError("");

        const firstName = $("staffFirstName").value.trim();
        const lastName = $("staffLastName").value.trim();
        const email = $("staffEmail").value.trim().toLowerCase();
        const phone = $("staffPhone").value.trim().replace(/[\s-]/g, "");
        const password = $("staffPassword").value;
        const status = $("staffStatus").value;
        const adding = state.mode === "add";

        if (firstName.length < 2) return showFormError("Enter the first name.");
        if (lastName.length < 2) return showFormError("Enter the last name.");

        if (adding && !EMAIL_RE.test(email)) {
            return showFormError("Enter a valid email address.");
        }

        if (phone && !PHONE_RE.test(phone)) {
            return showFormError("Enter a valid mobile number, e.g. 09171234567.");
        }

        if (adding && password.length < 8) {
            return showFormError("The temporary password must be at least 8 characters.");
        }

        if (!adding && password && password.length < 8) {
            return showFormError("The new password must be at least 8 characters.");
        }

        state.saving = true;
        const button = $("staffSaveButton");
        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = "Saving...";

        try {
            const body = adding
                ? { action: "create", firstName, lastName, email, phone, password, status }
                : {
                    action: "update",
                    userId: state.editingId,
                    firstName,
                    lastName,
                    phone,
                    newPassword: password,
                    status
                };

            const { error } = await supabaseClient.functions.invoke("manage-staff", { body });

            if (error) throw new Error(await readError(error));

            closeModal("staffModal");
            await loadStaff();
            setMessage(adding ? "Staff account created." : "Staff account updated.");
        } catch (error) {
            console.error("Saving staff failed:", error);
            showFormError(error.message);
        } finally {
            state.saving = false;
            button.disabled = false;
            button.textContent = originalText;
        }
    }

    /* ---------- start ---------- */

    async function init() {
        try {
            const me = await requireAdmin();
            if (!me) return; // redirecting

            applyAdminHeader(me);
            buildStaffUi();
            wireSignOut();
            showPage();

            // admin-data.js fills the other sections once the admin is confirmed.
            document.dispatchEvent(new CustomEvent("bp:admin-ready", { detail: me }));

            await loadStaff();
        } catch (error) {
            console.error("Admin page failed to start:", error);
            showPage();
            window.alert(`Could not load the admin page: ${error.message}`);
        }
    }

    init();
})();
