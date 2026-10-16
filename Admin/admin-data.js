/* BarangayPay admin portal: live dashboard, requests, payments, services
   and the admin's own account. Starts when admin-staff.js has confirmed an
   active admin (the "bp:admin-ready" event). */
(() => {
    "use strict";

    const RECENT_LIMIT = 5;
    const PAYMENTS_LIMIT = 20;
    const KNOWN_STATUSES = ["pending", "processing", "completed", "rejected", "cancelled"];
    const PHONE_RE = /^(09|\+639)\d{9}$/;
    const MAX_FEE = 100000;

    const { escapeHTML, peso, formatDate, capitalize, fullName } = window.BP;
    const $ = (id) => document.getElementById(id);
    const lower = (value) => String(value || "").toLowerCase();

    const state = {
        me: null,
        requests: [],
        services: []
    };

    /* ---------- shared bits ---------- */

    function setLabeled(scopeSelector, label, value) {
        document.querySelectorAll(`${scopeSelector} span`).forEach((span) => {
            if (span.textContent.trim() !== label) return;
            const strong = span.parentElement.querySelector("strong");
            if (strong) strong.textContent = value;
        });
    }

    function tableBody(sectionId) {
        return document.querySelector(`#${sectionId} tbody`);
    }

    function messageRow(body, columns, text) {
        if (body) body.innerHTML = `<tr><td colspan="${columns}" class="sm-empty">${escapeHTML(text)}</td></tr>`;
    }

    const statusClass = (status) =>
        KNOWN_STATUSES.includes(lower(status)) ? lower(status) : "pending";

    const statusBadge = (status) =>
        `<span class="status ${statusClass(status)}">${escapeHTML(capitalize(status || "pending"))}</span>`;

    function paymentBadge(request) {
        const payment = lower(request.payment_status);
        const labels = { paid: "Paid", unpaid: "Unpaid", failed: "Failed", not_required: "Free" };
        const css = payment === "paid" || payment === "not_required" ? "paid" : "unpaid";
        return `<span class="payment ${css}">${escapeHTML(labels[payment] || capitalize(payment) || "Unknown")}</span>`;
    }

    const serviceName = (request) => request.service || `Service #${request.service_id ?? "?"}`;
    const residentName = (request) => fullName(request) || "Resident";

    /* ---------- data ---------- */

    async function loadRequests() {
        const { data, error } = await BP.getClient()
            .from("service_requests")
            .select("id, request_code, resident_id, service, service_id, first_name, middle_name, last_name, contact_number, address, purpose, preferred_date, notes, remarks, document_paths, amount, status, payment_status, payment_method, payment_reference, paid_at, submitted_at")
            .order("submitted_at", { ascending: false });

        if (error) throw error;
        state.requests = data || [];
    }

    async function loadServices() {
        const { data, error } = await BP.getClient()
            .from("services")
            .select("*")
            .order("id", { ascending: true });

        if (error) throw error;
        state.services = data || [];
    }

    /* ---------- dashboard ---------- */

    function renderDashboard() {
        const requests = state.requests;
        const collected = requests
            .filter((r) => lower(r.payment_status) === "paid")
            .reduce((total, r) => total + Number(r.amount || 0), 0);
        const activeServices = state.services.filter((s) => s.is_active !== false).length;

        setLabeled("#dashboard", "Total Service Requests", requests.length);
        setLabeled("#dashboard", "Pending Requests",
            requests.filter((r) => lower(r.status) === "pending").length);
        setLabeled("#dashboard", "Total Payments", peso(collected));
        setLabeled("#dashboard", "Available Services", activeServices);

        const body = tableBody("dashboard");
        if (!requests.length) {
            messageRow(body, 6, "No service requests yet.");
            return;
        }

        body.innerHTML = requests.slice(0, RECENT_LIMIT).map((r) => `
            <tr>
                <td><strong>${escapeHTML(r.request_code || r.id)}</strong></td>
                <td>${escapeHTML(residentName(r))}</td>
                <td>${escapeHTML(serviceName(r))}</td>
                <td>${escapeHTML(formatDate(r.submitted_at))}</td>
                <td>${statusBadge(r.status)}</td>
                <td><button type="button" class="table-button" data-request="${escapeHTML(r.id)}">View</button></td>
            </tr>
        `).join("");
    }

    /* ---------- requests ---------- */

    const requestFilters = () => {
        const bar = document.querySelector("#requests .filter-bar");
        const [serviceSelect, statusSelect] = bar ? bar.querySelectorAll("select") : [];
        return { search: bar?.querySelector("input"), serviceSelect, statusSelect };
    };

    function renderRequests() {
        const requests = state.requests;
        const count = (status) => requests.filter((r) => lower(r.status) === status).length;

        setLabeled("#requests .mini-summary-grid", "All Requests", requests.length);
        ["Pending", "Processing", "Completed", "Rejected"].forEach((label) =>
            setLabeled("#requests .mini-summary-grid", label, count(label.toLowerCase())));

        const { search, serviceSelect, statusSelect } = requestFilters();
        const term = lower(search?.value).trim();
        const service = serviceSelect && serviceSelect.selectedIndex > 0 ? lower(serviceSelect.value) : "";
        const status = statusSelect && statusSelect.selectedIndex > 0 ? lower(statusSelect.value) : "";

        const filtered = requests.filter((r) =>
            (!term || [r.request_code, residentName(r), serviceName(r), r.contact_number]
                .some((value) => lower(value).includes(term))) &&
            (!service || lower(serviceName(r)) === service) &&
            (!status || lower(r.status) === status));

        const body = tableBody("requests");
        if (!filtered.length) {
            messageRow(body, 7, requests.length ? "No requests match your filters." : "No service requests yet.");
            return;
        }

        body.innerHTML = filtered.map((r) => `
            <tr>
                <td><strong>${escapeHTML(r.request_code || r.id)}</strong></td>
                <td>${escapeHTML(residentName(r))}</td>
                <td>${escapeHTML(serviceName(r))}</td>
                <td>${escapeHTML(formatDate(r.submitted_at))}</td>
                <td>${paymentBadge(r)}</td>
                <td>${statusBadge(r.status)}</td>
                <td><button type="button" class="table-button" data-request="${escapeHTML(r.id)}">View</button></td>
            </tr>
        `).join("");
    }

    function detail(label, value, fullWidth = false) {
        return `
            <div class="detail-item${fullWidth ? " full-width" : ""}">
                <span>${escapeHTML(label)}</span>
                <strong>${escapeHTML(value || "—")}</strong>
            </div>
        `;
    }

    function openRequest(id) {
        const r = state.requests.find((item) => String(item.id) === String(id));
        if (!r) return;

        $("modalRequestId").textContent = r.request_code || r.id;

        const files = BP.parsePaths(r.document_paths);
        const body = $("requestModalBody");

        body.innerHTML = `
            <div class="modal-request-heading">
                <div>
                    <h3>${escapeHTML(serviceName(r))}</h3>
                    <p>${escapeHTML(residentName(r))}</p>
                </div>
                ${statusBadge(r.status)}
            </div>

            <div class="modal-section">
                <h3>Request Details</h3>
                <div class="details-grid">
                    ${detail("Request ID", r.request_code || r.id)}
                    ${detail("Date Submitted", formatDate(r.submitted_at))}
                    ${detail("Purpose", r.purpose)}
                    ${detail("Preferred Date", r.preferred_date ? formatDate(`${r.preferred_date}T00:00:00`) : "")}
                    ${detail("Service Fee", Number(r.amount) > 0 ? peso(r.amount) : "Free")}
                    ${detail("Payment", capitalize(r.payment_status))}
                    ${detail("Payment Method", r.payment_method)}
                    ${detail("Payment Reference", r.payment_reference)}
                    ${detail("Resident Notes", r.notes, true)}
                    ${detail("Staff Remarks", r.remarks, true)}
                </div>
            </div>

            <div class="modal-section">
                <h3>Resident Information</h3>
                <div class="details-grid">
                    ${detail("Full Name", residentName(r))}
                    ${detail("Mobile Number", r.contact_number)}
                    ${detail("Address", r.address, true)}
                </div>
            </div>

            <div class="modal-section">
                <h3>Supporting Documents</h3>
                <div class="document-list">
                    ${files.length ? files.map((path, index) => `
                        <div class="document-item">
                            <div class="document-info">
                                <div class="document-icon">${escapeHTML(path.split(".").pop().slice(0, 4).toUpperCase())}</div>
                                <div><strong>${escapeHTML(path.split("/").pop())}</strong></div>
                            </div>
                            <button type="button" class="document-button" data-file="${index}">View</button>
                        </div>
                    `).join("") : "<p>No uploaded files recorded for this request.</p>"}
                </div>
            </div>
        `;

        body.querySelectorAll("[data-file]").forEach((button) => {
            button.addEventListener("click", () => BP.openStoredFile(files[Number(button.dataset.file)]));
        });

        openModal("requestModal");
    }

    /* ---------- payments ---------- */

    function renderPayments() {
        const paid = state.requests.filter((r) => lower(r.payment_status) === "paid");
        const unpaid = state.requests.filter((r) => ["unpaid", "failed"].includes(lower(r.payment_status)));
        const collected = paid.reduce((total, r) => total + Number(r.amount || 0), 0);

        setLabeled("#payments", "Total Collected", peso(collected));
        setLabeled("#payments", "Paid Transactions", paid.length);
        setLabeled("#payments", "Unpaid Transactions", unpaid.length);
        setLabeled("#payments", "Average Payment", peso(paid.length ? collected / paid.length : 0));

        const body = tableBody("payments");
        if (!paid.length) {
            messageRow(body, 6, "No payments recorded yet.");
            return;
        }

        const byPaidDate = [...paid].sort((a, b) =>
            String(b.paid_at || b.submitted_at).localeCompare(String(a.paid_at || a.submitted_at)));

        body.innerHTML = byPaidDate.slice(0, PAYMENTS_LIMIT).map((r) => `
            <tr>
                <td><strong>${escapeHTML(r.payment_reference || r.request_code || r.id)}</strong></td>
                <td>${escapeHTML(residentName(r))}</td>
                <td>${escapeHTML(serviceName(r))}</td>
                <td>${escapeHTML(peso(r.amount))}</td>
                <td>${escapeHTML(formatDate(r.paid_at || r.submitted_at))}</td>
                <td><span class="payment paid">${escapeHTML(r.payment_method || "Paid")}</span></td>
            </tr>
        `).join("");
    }

    /* ---------- services ---------- */

    function renderServices() {
        const body = tableBody("services");
        if (!state.services.length) {
            messageRow(body, 5, "No services found in the services table.");
            return;
        }

        body.innerHTML = state.services.map((service) => {
            const active = service.is_active !== false && lower(service.status) !== "inactive";
            return `
                <tr>
                    <td><strong>${escapeHTML(service.name)}</strong></td>
                    <td>${escapeHTML(Number(service.fee) > 0 ? peso(service.fee) : "Free")}</td>
                    <td>${escapeHTML(service.processing_time || "—")}</td>
                    <td><span class="status ${active ? "active" : "inactive"}">${active ? "Active" : "Inactive"}</span></td>
                    <td><button type="button" class="table-button" data-service="${escapeHTML(service.id)}">Edit Fee</button></td>
                </tr>
            `;
        }).join("");
    }

    let editingServiceId = null;

    function buildServiceModal() {
        const modal = document.createElement("div");
        modal.className = "modal-overlay";
        modal.id = "serviceModal";
        modal.innerHTML = `
            <form class="modal" novalidate>
                <div class="modal-header">
                    <div>
                        <p class="eyebrow">SERVICE MANAGEMENT</p>
                        <h2>Edit Service Fee</h2>
                    </div>
                    <button type="button" class="modal-close" data-close aria-label="Close">×</button>
                </div>
                <div class="modal-body">
                    <p class="sm-form-error" id="serviceFormError" role="alert" hidden></p>
                    <div class="form-group">
                        <label for="serviceName">Service Name</label>
                        <input type="text" id="serviceName" disabled>
                    </div>
                    <div class="form-group">
                        <label for="serviceFee">Service Fee (₱)</label>
                        <input type="number" id="serviceFee" min="0" max="${MAX_FEE}" step="0.01" required>
                        <p class="sm-hint">New requests are charged this amount. Set 0 for a free service.</p>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="secondary-button" data-close>Cancel</button>
                    <button type="submit" class="primary-button" id="serviceSaveButton">Save Changes</button>
                </div>
            </form>
        `;
        document.body.appendChild(modal);

        modal.querySelectorAll("[data-close]").forEach((button) =>
            button.addEventListener("click", () => closeModal("serviceModal")));
        modal.addEventListener("click", (event) => {
            if (event.target === modal) closeModal("serviceModal");
        });
        modal.querySelector("form").addEventListener("submit", saveService);
    }

    function openService(id) {
        const service = state.services.find((item) => String(item.id) === String(id));
        if (!service) return;

        editingServiceId = service.id;
        $("serviceName").value = service.name || "";
        $("serviceFee").value = Number(service.fee || 0).toFixed(2);
        $("serviceFormError").hidden = true;
        openModal("serviceModal");
        $("serviceFee").focus();
    }

    async function saveService(event) {
        event.preventDefault();

        const errorBox = $("serviceFormError");
        const fee = Number($("serviceFee").value);

        if (!Number.isFinite(fee) || fee < 0 || fee > MAX_FEE) {
            errorBox.textContent = `Enter a fee between ₱0 and ${peso(MAX_FEE)}.`;
            errorBox.hidden = false;
            return;
        }

        const button = $("serviceSaveButton");
        button.disabled = true;

        try {
            const { error } = await BP.getClient()
                .from("services")
                .update({ fee: Math.round(fee * 100) / 100 })
                .eq("id", editingServiceId);

            if (error) throw error;

            closeModal("serviceModal");
            await loadServices();
            renderServices();
            renderDashboard();
        } catch (error) {
            console.error("Saving the service failed:", error);
            errorBox.textContent = `Could not save: ${error.message}`;
            errorBox.hidden = false;
        } finally {
            button.disabled = false;
        }
    }

    /* ---------- admin account ---------- */

    function buildAccountModal() {
        const modal = document.createElement("div");
        modal.className = "modal-overlay";
        modal.id = "accountModal";
        modal.innerHTML = `
            <form class="modal" novalidate>
                <div class="modal-header">
                    <div>
                        <p class="eyebrow">ADMIN ACCOUNT</p>
                        <h2>Account Settings</h2>
                    </div>
                    <button type="button" class="modal-close" data-close aria-label="Close">×</button>
                </div>
                <div class="modal-body">
                    <p class="sm-form-error" id="accountFormError" role="alert" hidden></p>
                    <div class="form-group">
                        <label for="accountName">Full Name</label>
                        <input type="text" id="accountName" maxlength="100" required>
                    </div>
                    <div class="form-group">
                        <label for="accountEmail">Email Address</label>
                        <input type="email" id="accountEmail" disabled>
                    </div>
                    <div class="form-group">
                        <label for="accountPhone">Mobile Number</label>
                        <input type="text" id="accountPhone" maxlength="16" placeholder="09XX XXX XXXX">
                    </div>
                    <button type="button" class="secondary-button" id="accountPasswordButton">Change Password</button>
                </div>
                <div class="modal-footer">
                    <button type="button" class="secondary-button" data-close>Cancel</button>
                    <button type="submit" class="primary-button" id="accountSaveButton">Save Changes</button>
                </div>
            </form>
        `;
        document.body.appendChild(modal);

        modal.querySelectorAll("[data-close]").forEach((button) =>
            button.addEventListener("click", () => closeModal("accountModal")));
        modal.addEventListener("click", (event) => {
            if (event.target === modal) closeModal("accountModal");
        });
        $("accountPasswordButton").addEventListener("click", () => {
            closeModal("accountModal");
            BPPassword.openDialog(() => window.alert("Your password has been updated."));
        });
        modal.querySelector("form").addEventListener("submit", saveAccount);
    }

    function openAccount() {
        $("accountName").value = state.me.full_name || "";
        $("accountEmail").value = state.me.email || "";
        $("accountPhone").value = state.me.phone || "";
        $("accountFormError").hidden = true;
        openModal("accountModal");
    }

    async function saveAccount(event) {
        event.preventDefault();

        const errorBox = $("accountFormError");
        const name = $("accountName").value.trim();
        const phone = $("accountPhone").value.trim().replace(/[\s-]/g, "");
        const fail = (text) => {
            errorBox.textContent = text;
            errorBox.hidden = false;
        };

        if (name.length < 2) return fail("Enter your full name.");
        if (phone && !PHONE_RE.test(phone)) return fail("Enter a valid mobile number, e.g. 09171234567.");

        const button = $("accountSaveButton");
        button.disabled = true;

        try {
            const { data, error } = await BP.getClient()
                .from("profiles")
                .update({ full_name: name, phone: phone || null })
                .eq("id", state.me.id)
                .select("id, full_name, email, phone, role, status")
                .single();

            if (error) throw error;

            state.me = { ...state.me, ...data };
            document.querySelectorAll(".user-info strong").forEach((el) => { el.textContent = name; });
            document.querySelectorAll(".user-avatar").forEach((el) => {
                el.textContent = BP.initials(name) || "AD";
            });
            closeModal("accountModal");
        } catch (error) {
            console.error("Saving the account failed:", error);
            fail(`Could not save: ${error.message}`);
        } finally {
            button.disabled = false;
        }
    }

    /* ---------- wiring ---------- */

    function wireEvents() {
        document.addEventListener("click", (event) => {
            const requestButton = event.target.closest("[data-request]");
            if (requestButton) {
                openRequest(requestButton.dataset.request);
                return;
            }

            const serviceButton = event.target.closest("[data-service]");
            if (serviceButton) {
                openService(serviceButton.dataset.service);
                return;
            }

            const accountLink = event.target.closest("[data-open-account]");
            if (accountLink) {
                event.preventDefault();
                openAccount();
            }
        });

        const { search, serviceSelect, statusSelect } = requestFilters();
        search?.addEventListener("input", renderRequests);
        serviceSelect?.addEventListener("change", renderRequests);
        statusSelect?.addEventListener("change", renderRequests);
    }

    async function refresh() {
        const results = await Promise.allSettled([loadRequests(), loadServices()]);
        const [requestResult, serviceResult] = results;

        if (requestResult.status === "rejected") {
            console.error("Could not load requests:", requestResult.reason);
            messageRow(tableBody("dashboard"), 6, "Could not load requests. Check the admin read policy.");
            messageRow(tableBody("requests"), 7, "Could not load requests. Check the admin read policy.");
            messageRow(tableBody("payments"), 6, "Could not load payments.");
        } else {
            renderRequests();
            renderPayments();
        }

        if (serviceResult.status === "rejected") {
            console.error("Could not load services:", serviceResult.reason);
            messageRow(tableBody("services"), 5, "Could not load services.");
        } else {
            renderServices();
        }

        if (requestResult.status === "fulfilled") renderDashboard();
    }

    document.addEventListener("bp:admin-ready", (event) => {
        state.me = event.detail;
        buildServiceModal();
        buildAccountModal();
        wireEvents();
        refresh();
    });
})();
