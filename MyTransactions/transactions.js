document.addEventListener("DOMContentLoaded", async () => {
    const tableBody = document.getElementById("transactionTableBody");
    const emptyState = document.getElementById("transactionEmptyState");
    const searchInput = document.getElementById("transactionSearch");
    const statusFilter = document.getElementById("statusFilter");


    let transactions = [];

    function showMessage(message, isError = false) {
        if (!emptyState) return;

        emptyState.style.display = "block";
        emptyState.querySelector("h3").textContent =
            isError ? "Unable to load transactions" : "No transactions found";

        emptyState.querySelector("p").textContent = message;

        const requestButton = emptyState.querySelector("a");
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

    // The amount saved on the request is what the resident pays;
    // the catalogue fee is only a fallback for old rows.
    function getAmount(transaction) {
        if (transaction.amount !== null && transaction.amount !== undefined) {
            return Number(transaction.amount);
        }
        const fee = getServiceRecord(transaction)?.fee;
        return fee === null || fee === undefined ? null : Number(fee);
    }

    function getStatusLabel(transaction) {
        const status = normalize(transaction.status);
        const payment = normalize(transaction.payment_status);

        if (status === "rejected") return "Rejected";
        if (status === "cancelled") return "Cancelled";
        if (status === "completed") return "Completed";
        if (status === "ready") return "Ready for Release";
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
                return status === "ready" ||
                    status === "ready for release";

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
        return PAYMENT_LABELS[payment] || BP.capitalize(payment) || "Unknown";
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
                feeText.textContent = new Intl.NumberFormat("en-PH", {
                    style: "currency",
                    currency: "PHP"
                }).format(fee);

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
                "transaction-status status-" +
                normalize(transaction.status).replace(/\s+/g, "-");

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
            viewButton.className = "primary-button";
            viewButton.textContent = "View";

            viewButton.addEventListener("click", () => {
                const feeText = fee === null
                    ? "Not available"
                    : new Intl.NumberFormat("en-PH", {
                        style: "currency",
                        currency: "PHP"
                    }).format(fee);

                window.alert(
                    `Transaction Details\n\n` +
                    `Request Code: ${transaction.request_code || "—"}\n` +
                    `Service: ${getServiceName(transaction)}\n` +
                    `Service Fee: ${feeText}\n` +
                    `Date Submitted: ${formatDate(transaction.submitted_at)}\n` +
                    `Status: ${statusLabel}\n` +
                    `Payment: ${paymentLabel(transaction)}\n` +
                    `Remarks: ${transaction.remarks || "None"}`
                );
            });

            actionCell.appendChild(viewButton);

            if (needsPayment(transaction)) {
                const payLink = document.createElement("a");
                payLink.className = "primary-button";
                payLink.href = paymentUrl(transaction);
                payLink.textContent = "Pay";
                payLink.style.marginLeft = "6px";
                actionCell.appendChild(payLink);
            }
            row.appendChild(actionCell);

            tableBody.appendChild(row);
        });
    }

    async function loadTransactions() {
        try {
            const auth = await BP.initPortal("resident");
            if (!auth) return; // redirecting

            const currentUser = auth.user;

            // Load only the current resident's requests.
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