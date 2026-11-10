
document.addEventListener("DOMContentLoaded", async () => {
    const tableBody = document.getElementById("transactionTableBody");
    const emptyState = document.getElementById("transactionEmptyState");
    const searchInput = document.getElementById("transactionSearch");
    const statusFilter = document.getElementById("statusFilter");

    // Transaction details modal elements
    const modal = document.getElementById("transactionModal");
    const modalClose = document.getElementById("transactionModalClose");
    const modalCloseButton = document.getElementById("transactionModalCloseButton");
    const modalPayButton = document.getElementById("transactionModalPayButton");

    let transactions = [];

    function showMessage(message, isError = false) {
        if (!emptyState) return;

        emptyState.style.display = "block";

        const heading = emptyState.querySelector("h3");
        const description = emptyState.querySelector("p");
        const requestButton = emptyState.querySelector("a");

        if (heading) {
            heading.textContent = isError
                ? "Unable to load transactions"
                : "No transactions found";
        }

        if (description) description.textContent = message;

        if (requestButton) {
            requestButton.style.display = isError ? "none" : "";
        }
    }

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

    function formatCurrency(value) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) {
            return "Not available";
        }

        return new Intl.NumberFormat("en-PH", {
            style: "currency",
            currency: "PHP"
        }).format(Number(value));
    }

    function normalize(value) {
        return String(value || "").toLowerCase().trim();
    }

    function getServiceRecord(transaction) {
        const service = transaction.service_info;
        return Array.isArray(service) ? service[0] : service;
    }

    function getServiceName(transaction) {
        return getServiceRecord(transaction)?.name ||
            transaction.service_name ||
            "Unknown service";
    }

    function getAmount(transaction) {
        if (transaction.amount !== null && transaction.amount !== undefined) {
            return Number(transaction.amount);
        }

        const fee = getServiceRecord(transaction)?.fee;

        return fee === null || fee === undefined
            ? null
            : Number(fee);
    }

    function getStatusLabel(transaction) {
        const status = normalize(transaction.status);
        const payment = normalize(transaction.payment_status);

        if (status === "rejected") return "Rejected";
        if (status === "cancelled") return "Cancelled";
        if (status === "completed") return "Completed";
        if (status === "ready" || status === "ready for release") {
            return "Ready for Release";
        }
        if (status === "processing") return "Processing";
        if (status === "pending" && payment === "unpaid") {
            return "Pending Review";
        }
        if (status === "pending" && payment === "paid") {
            return "Pending Review";
        }

        return status
            ? status.charAt(0).toUpperCase() + status.slice(1)
            : "Unknown";
    }

    function getStatusClass(transaction) {
        const status = normalize(transaction.status);

        const classes = {
            pending: "pending",
            rejected: "rejected",
            cancelled: "cancelled",
            completed: "completed",
            ready: "ready",
            "ready for release": "ready",
            processing: "processing"
        };

        return classes[status] || "pending";
    }

    function matchesFilter(transaction, filter) {
        const status = normalize(transaction.status);
        const payment = normalize(transaction.payment_status);

        switch (filter) {
            case "pending":
                return status === "pending";
            case "rejected":
                return status === "rejected";
            case "payment":
                return payment === "unpaid" || payment === "failed";
            case "paid":
                return payment === "paid";
            case "processing":
                return status === "processing";
            case "ready":
                return status === "ready" || status === "ready for release";
            case "completed":
                return status === "completed";
            case "cancelled":
                return status === "cancelled";
            case "all":
            default:
                return true;
        }
    }

    const PAYMENT_LABELS = {
        paid: "Paid",
        unpaid: "Unpaid",
        failed: "Failed",
        not_required: "Not required"
    };

    function paymentLabel(transaction) {
        const payment = normalize(transaction.payment_status);

        return PAYMENT_LABELS[payment] ||
            (payment ? payment.charAt(0).toUpperCase() + payment.slice(1) : "Unknown");
    }

    function getPaymentClass(transaction) {
        const payment = normalize(transaction.payment_status);

        if (payment === "paid") return "paid";
        if (payment === "unpaid" || payment === "failed") return "unpaid";

        return "not-required";
    }

    function needsPayment(transaction) {
        const payment = normalize(transaction.payment_status);
        const status = normalize(transaction.status);

        return (payment === "unpaid" || payment === "failed") &&
            !["rejected", "cancelled"].includes(status);
    }

    function paymentUrl(transaction) {
        return `../Payment/payment.html?request=${encodeURIComponent(transaction.id)}`;
    }

    function createCell(text) {
        const cell = document.createElement("td");
        cell.textContent = text;
        return cell;
    }

    // =========================================
    // TRANSACTION DETAILS MODAL
    // =========================================

    function setModalText(id, value) {
        const element = document.getElementById(id);

        if (element) {
            element.textContent = value || "—";
        }
    }

    function openTransactionModal(transaction) {
        if (!modal) return;

        const amount = getAmount(transaction);
        const statusLabel = getStatusLabel(transaction);
        const paymentStatus = paymentLabel(transaction);

        setModalText("transactionModalService", getServiceName(transaction));
        setModalText("transactionModalCode", transaction.request_code || "—");
        setModalText("transactionModalId", String(transaction.id ?? "—"));
        setModalText("transactionModalAmount", formatCurrency(amount));
        setModalText("transactionModalDate", formatDate(transaction.submitted_at));
        setModalText("transactionModalUpdated", formatDate(transaction.updated_at));
        setModalText("transactionModalPayment", paymentStatus);
        setModalText("transactionModalRemarks", transaction.remarks || "No remarks provided.");

        const statusBadge = document.getElementById("transactionModalStatus");

        if (statusBadge) {
            statusBadge.textContent = statusLabel;
            statusBadge.className =
                `modal-status-badge ${getStatusClass(transaction)}`;
        }

        const paymentBadge = document.getElementById("transactionModalPayment");

        if (paymentBadge) {
            paymentBadge.className =
                `detail-value payment-value ${getPaymentClass(transaction)}`;
        }

        if (modalPayButton) {
            if (needsPayment(transaction)) {
                modalPayButton.href = paymentUrl(transaction);
                modalPayButton.style.display = "inline-flex";
            } else {
                modalPayButton.removeAttribute("href");
                modalPayButton.style.display = "none";
            }
        }

        modal.classList.add("show");
        document.body.classList.add("transaction-modal-open");

        if (modalClose) modalClose.focus();
    }

    function closeTransactionModal() {
        if (!modal) return;

        modal.classList.remove("show");
        document.body.classList.remove("transaction-modal-open");
    }

    modalClose?.addEventListener("click", closeTransactionModal);
    modalCloseButton?.addEventListener("click", closeTransactionModal);

    modal?.addEventListener("click", event => {
        if (event.target === modal) {
            closeTransactionModal();
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && modal?.classList.contains("show")) {
            closeTransactionModal();
        }
    });

    // =========================================
    // RENDER TRANSACTIONS
    // =========================================

    function renderTransactions() {
        if (!tableBody || !emptyState) return;

        tableBody.replaceChildren();

        const searchTerm = normalize(searchInput?.value);
        const selectedStatus = statusFilter?.value || "all";

        const filteredTransactions = transactions.filter(transaction => {
            const serviceName = getServiceName(transaction);

            const matchesSearch =
                normalize(transaction.request_code).includes(searchTerm) ||
                normalize(serviceName).includes(searchTerm);

            return matchesSearch &&
                matchesFilter(transaction, selectedStatus);
        });

        if (filteredTransactions.length === 0) {
            emptyState.style.display = "block";

            const heading = emptyState.querySelector("h3");
            const description = emptyState.querySelector("p");

            if (heading) heading.textContent = "No transactions found";

            if (description) {
                description.textContent = transactions.length === 0
                    ? "Your submitted service requests will appear here once you make a request."
                    : "No transactions match your current search or status filter.";
            }

            const requestButton = emptyState.querySelector("a");

            if (requestButton) {
                requestButton.style.display =
                    transactions.length === 0 ? "" : "none";
            }

            return;
        }

        emptyState.style.display = "none";

        filteredTransactions.forEach(transaction => {
            const row = document.createElement("tr");

            row.appendChild(
                createCell(transaction.request_code || "—")
            );

            const serviceCell = document.createElement("td");
            const serviceName = document.createElement("strong");

            serviceName.textContent = getServiceName(transaction);
            serviceCell.appendChild(serviceName);

            const fee = getAmount(transaction);

            if (fee !== null) {
                const feeText = document.createElement("div");
                feeText.textContent = formatCurrency(fee);
                feeText.style.fontSize = "0.85em";
                feeText.style.opacity = "0.8";

                serviceCell.appendChild(feeText);
            }

            row.appendChild(serviceCell);

            row.appendChild(
                createCell(formatDate(transaction.submitted_at))
            );

            const statusCell = document.createElement("td");
            const statusBadge = document.createElement("span");
            const statusLabel = getStatusLabel(transaction);

            statusBadge.textContent = statusLabel;
            statusBadge.className =
                "transaction-status status-" + getStatusClass(transaction);

            statusCell.appendChild(statusBadge);

            const paymentText = document.createElement("div");
            paymentText.textContent = "Payment: " + paymentLabel(transaction);
            paymentText.style.fontSize = "0.8em";
            paymentText.style.marginTop = "5px";

            statusCell.appendChild(paymentText);
            row.appendChild(statusCell);

            const actionCell = document.createElement("td");
            const viewButton = document.createElement("button");

            viewButton.type = "button";
            viewButton.className = "transaction-action";
            viewButton.textContent = "View";

            viewButton.addEventListener("click", () => {
                openTransactionModal(transaction);
            });

            actionCell.appendChild(viewButton);

            if (needsPayment(transaction)) {
                const payLink = document.createElement("a");

                payLink.className = "transaction-action";
                payLink.href = paymentUrl(transaction);
                payLink.textContent = "Pay";
                payLink.style.marginLeft = "6px";

                actionCell.appendChild(payLink);
            }

            row.appendChild(actionCell);
            tableBody.appendChild(row);
        });
    }

    // =========================================
    // LOAD RESIDENT TRANSACTIONS
    // =========================================

    async function loadTransactions() {
        try {
            const auth = await BP.initPortal("resident");

            if (!auth) return;

            const currentUser = auth.user;

            const { data, error } = await BP.getClient()
                .from("service_requests")
                .select(`
                    id,
                    request_code,
                    resident_id,
                    service_id,
                    service_name:service,
                    amount,
                    status,
                    payment_status,
                    remarks,
                    submitted_at,
                    updated_at,
                    service_info:services (
                        name,
                        fee
                    )
                `)
                .eq("resident_id", currentUser.id)
                .order("submitted_at", { ascending: false });

            if (error) {
                console.error("Transaction loading failed:", error);

                showMessage(
                    "Could not retrieve your transactions. Check the database relationship and Supabase permissions.",
                    true
                );

                return;
            }

            transactions = data || [];
            renderTransactions();

        } catch (error) {
            console.error("Unexpected transaction error:", error);

            showMessage(
                "An unexpected error occurred while loading transactions.",
                true
            );
        }
    }

    searchInput?.addEventListener("input", renderTransactions);
    statusFilter?.addEventListener("change", renderTransactions);

    await loadTransactions();
});
