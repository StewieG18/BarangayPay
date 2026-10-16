/* Resident dashboard (index.html): summary cards and recent transactions. */
(() => {
    "use strict";

    const RECENT_LIMIT = 5;
    const KNOWN_STATUSES = [
        "pending", "processing", "ready", "completed", "approved", "rejected", "cancelled"
    ];

    const { escapeHTML, peso, formatDate, capitalize } = window.BP;

    const lower = (value) => String(value || "").toLowerCase();

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    function renderEmpty(container, title, text, withLink = false) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>${escapeHTML(title)}</h3>
                <p>${escapeHTML(text)}</p>
                ${withLink
                    ? '<a href="Services/services.html" class="secondary-button">Request a Service</a>'
                    : ""}
            </div>
        `;
    }

    function paymentBadge(item) {
        const payment = lower(item.payment_status);

        if (payment === "paid") {
            return '<span class="transaction-payment payment-paid">✓ Paid</span>';
        }
        if (payment === "not_required") {
            return '<span class="transaction-payment payment-paid">Free</span>';
        }

        const href = `Payment/payment.html?request=${encodeURIComponent(item.id)}`;
        return `<a class="transaction-payment payment-unpaid" href="${href}">Unpaid · Pay now</a>`;
    }

    function renderRecent(container, transactions) {
        container.innerHTML = `
            <div class="recent-transactions-list">
                ${transactions.slice(0, RECENT_LIMIT).map((item) => {
                    const status = lower(item.status) || "pending";
                    const statusClass = KNOWN_STATUSES.includes(status) ? status : "pending";

                    return `
                        <article class="recent-transaction">
                            <div class="transaction-service-icon"><span>▤</span></div>

                            <div class="recent-transaction-info">
                                <strong>${escapeHTML(item.service || "Barangay Service")}</strong>
                                <span class="transaction-reference">
                                    ${escapeHTML(item.request_code || `Request #${item.id}`)}
                                </span>
                                <span class="transaction-date">
                                    ${escapeHTML(formatDate(item.submitted_at))}
                                </span>
                            </div>

                            <div class="recent-transaction-right">
                                <span class="transaction-status status-${statusClass}">
                                    ${escapeHTML(capitalize(status))}
                                </span>
                                <strong class="transaction-amount">${escapeHTML(peso(item.amount))}</strong>
                                ${paymentBadge(item)}
                            </div>
                        </article>
                    `;
                }).join("")}
            </div>
        `;
    }

    async function loadDashboard() {
        const container = document.getElementById("recentTransactions");

        try {
            const auth = await window.BP.initPortal("resident");
            if (!auth) return;

            const { data, error } = await window.BP.getClient()
                .from("service_requests")
                .select("id, request_code, service, status, payment_status, amount, submitted_at")
                .eq("resident_id", auth.user.id)
                .order("submitted_at", { ascending: false });

            if (error) throw error;

            const transactions = data || [];
            const countStatus = (status) =>
                transactions.filter((item) => lower(item.status) === status).length;

            setText("pendingCount", countStatus("pending"));
            setText("processingCount", countStatus("processing"));
            setText("completedCount", countStatus("completed"));
            setText("paymentsCount", peso(
                transactions
                    .filter((item) => lower(item.payment_status) === "paid")
                    .reduce((total, item) => total + Number(item.amount || 0), 0)
            ));

            if (transactions.length === 0) {
                renderEmpty(
                    container,
                    "No transactions yet",
                    "Your submitted barangay service requests will appear here.",
                    true
                );
                return;
            }

            renderRecent(container, transactions);
        } catch (error) {
            console.error("Dashboard loading failed:", error);
            renderEmpty(
                container,
                "Unable to load transactions",
                "Please refresh the page or check your connection."
            );
        }
    }

    loadDashboard();
})();
