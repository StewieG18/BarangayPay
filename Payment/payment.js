/* BarangayPay - PayMongo payment (test mode).
   The browser never decides that a payment succeeded.
   PayMongo calls the paymongo-webhook function, which marks the request as
   paid in the database. This page only starts the checkout and then waits
   for the database to show the result. */
document.addEventListener("DOMContentLoaded", async () => {
    "use strict";

    const $ = (id) => document.getElementById(id);

    const SERVICE_NAMES = {
        "barangay-clearance": "Barangay Clearance",
        "certificate-residency": "Certificate of Residency",
        "certificate-indigency": "Certificate of Indigency",
        "business-clearance": "Barangay Business Clearance"
    };

    const POLL_INTERVAL_MS = 2000;
    const POLL_MAX_TRIES = 15; // about 30 seconds

    const VIEWS = ["viewLoading", "viewCheckout", "viewConfirming", "viewReceipt"];

    let user = null;
    let request = null;

    /* ---------- helpers ---------- */

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const money = (value) =>
        new Intl.NumberFormat("en-PH", {
            style: "currency",
            currency: "PHP"
        }).format(Number(value) || 0);

    const shortId = (id) => String(id).slice(0, 8).toUpperCase();

    const formatDateTime = (iso) => {
        const d = new Date(iso);
        return Number.isNaN(d.getTime())
            ? "-"
            : d.toLocaleString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit"
            });
    };

    const statusLabel = (status) => {
        if (!status || status === "pending") return "Pending review";
        return status.charAt(0).toUpperCase() + status.slice(1);
    };

    const isSettled = (r) =>
        ["paid", "not_required"].includes(r.payment_status);

    function show(viewId) {
        VIEWS.forEach((id) => { $(id).hidden = id !== viewId; });
        window.scrollTo({ top: 0 });
    }

    function showBanner(message, type = "error") {
        const banner = $("pmBanner");
        banner.textContent = message;
        banner.className = type === "info" ? "pm-banner pm-banner-info" : "pm-banner";
        banner.hidden = false;
    }

    function clearBanner() {
        $("pmBanner").hidden = true;
        $("pmBanner").textContent = "";
    }

    function showFatal(message) {
        const box = $("viewLoading");
        box.querySelector(".pm-spinner").hidden = true;
        box.querySelector("p").textContent = message;

        const link = document.createElement("a");
        link.href = "../index.html";
        link.className = "pm-link";
        link.textContent = "Return to dashboard";
        box.appendChild(link);

        show("viewLoading");
    }

    async function fetchRequest(id) {
        const { data, error } = await supabaseClient
            .from("service_requests")
            .select("*")
            .eq("id", id)
            .eq("resident_id", user.id)
            .maybeSingle();

        if (error) throw error;
        return data;
    }

    /* ---------- checkout view ---------- */

    function renderCheckout() {
        const name = [request.first_name, request.middle_name, request.last_name]
            .filter(Boolean)
            .join(" ");

        $("sumService").textContent =
            SERVICE_NAMES[request.service] || request.service;
        $("sumRef").textContent = request.request_code || shortId(request.id);
        $("sumName").textContent = name || "-";
        $("sumAmount").textContent = money(request.amount);
        $("payButton").textContent = `Pay ${money(request.amount)}`;

        show("viewCheckout");
    }

    // Ask the create-checkout function for a PayMongo checkout link, then go there.
    $("payButton").addEventListener("click", async () => {
        clearBanner();
        $("payButton").disabled = true;
        $("processing").hidden = false;

        try {
            const { data, error } = await supabaseClient.functions.invoke(
                "create-checkout",
                {
                    body: {
                        requestId: request.id,
                        origin: window.location.origin
                    }
                }
            );

            if (error) {
                let message = error.message;

                try {
                    const body = await error.context.json();
                    if (body && body.error) message = body.error;
                } catch (_) {
                    /* keep the default message */
                }

                throw new Error(message);
            }

            if (!data || !data.checkout_url) {
                throw new Error("PayMongo did not return a checkout link.");
            }

            window.location.href = data.checkout_url;
        } catch (error) {
            console.error("Could not start the payment:", error);
            $("processing").hidden = true;
            $("payButton").disabled = false;
            showBanner(`Could not start the payment: ${error.message}`);
        }
    });

    // If the user presses Back from PayMongo, reset the button.
    window.addEventListener("pageshow", (event) => {
        if (event.persisted) {
            $("processing").hidden = true;
            $("payButton").disabled = false;
        }
    });

    /* ---------- confirming view ---------- */

    async function confirmPayment() {
        $("confirmTitle").textContent = "Confirming your payment";
        $("confirmText").textContent =
            "Please wait while PayMongo confirms your payment. Do not close this page.";
        $("confirmSpinner").hidden = false;
        $("confirmActions").hidden = true;
        show("viewConfirming");

        for (let i = 0; i < POLL_MAX_TRIES; i++) {
            try {
                const latest = await fetchRequest(request.id);
                if (latest) request = latest;

                if (isSettled(request)) {
                    renderReceipt();
                    return;
                }
            } catch (error) {
                console.warn("Payment status check failed:", error);
            }

            await sleep(POLL_INTERVAL_MS);
        }

        $("confirmTitle").textContent = "Still waiting for confirmation";
        $("confirmText").textContent =
            "We have not received the confirmation yet. This can take a minute. " +
            "Your request is saved, so you will not lose it.";
        $("confirmSpinner").hidden = true;
        $("confirmActions").hidden = false;
    }

    $("confirmRetry").addEventListener("click", confirmPayment);

    /* ---------- receipt view ---------- */

    function renderReceipt() {
        const free = request.payment_status === "not_required";

        $("receiptTitle").textContent = free
            ? "Request submitted"
            : "Payment successful";

        $("receiptText").textContent = free
            ? "This service is free. Your request has been sent to the barangay."
            : "Your payment was confirmed and your request has been sent to the barangay.";

        $("rcRef").textContent = request.payment_reference || "No payment needed";
        $("rcRequest").textContent = request.request_code || shortId(request.id);
        $("rcService").textContent =
            SERVICE_NAMES[request.service] || request.service;
        $("rcAmount").textContent = free ? "Free" : money(request.amount);
        $("rcMethod").textContent = free
            ? "Not applicable"
            : request.payment_method || "-";
        $("rcDate").textContent = formatDateTime(
            request.paid_at || request.submitted_at || request.created_at
        );
        $("rcStatus").textContent = statusLabel(request.status);

        // Drop "?status=success" so a refresh does not re-run the confirmation.
        history.replaceState(
            null,
            "",
            `${window.location.pathname}?request=${encodeURIComponent(request.id)}`
        );

        clearBanner();
        show("viewReceipt");
    }

    /* ---------- load request ---------- */

    try {
        const auth = await BP.initPortal("resident");
        if (!auth) return; // redirecting

        user = auth.user;

        const params = new URLSearchParams(window.location.search);
        const requestId = params.get("request");
        const returnStatus = params.get("status");

        if (!requestId) {
            showFatal("No request was selected for payment.");
            return;
        }

        request = await fetchRequest(requestId);

        if (!request) {
            showFatal("We could not find this request in your account.");
            return;
        }

        if (isSettled(request)) {
            renderReceipt();
        } else if (returnStatus === "success") {
            await confirmPayment();
        } else {
            renderCheckout();

            if (returnStatus === "cancelled") {
                showBanner(
                    "The payment was cancelled. You can try again whenever you are ready.",
                    "info"
                );
            }
        }
    } catch (error) {
        console.error("Payment page failed to load:", error);
        showFatal(`Could not load this payment page: ${error.message}`);
    }
});
