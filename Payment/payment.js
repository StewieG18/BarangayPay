/* BarangayPay - PayMongo payment SIMULATION.
   No real payment is made and no real PayMongo API is called.
   The result depends only on the test card / test buttons used here. */
document.addEventListener("DOMContentLoaded", async () => {
    "use strict";

    const $ = (id) => document.getElementById(id);

    const SERVICE_NAMES = {
        "barangay-clearance": "Barangay Clearance",
        "certificate-residency": "Certificate of Residency",
        "certificate-indigency": "Certificate of Indigency",
        "business-clearance": "Barangay Business Clearance"
    };

    const METHODS = {
        gcash:   { label: "GCash",    chip: "G",  css: "pm-gcash", wallet: true },
        maya:    { label: "Maya",     chip: "M",  css: "pm-maya",  wallet: true },
        grabpay: { label: "GrabPay",  chip: "GP", css: "pm-grab",  wallet: true },
        card:    { label: "Credit / debit card", wallet: false }
    };

    // Only these card numbers are accepted by the simulation.
    const TEST_CARD_SUCCESS = ["4343434343434345"];
    const TEST_CARD_FAIL    = ["4571736000000003"];

    const PROCESSING_MS = 1800;
    const VIEWS = ["viewLoading", "viewCheckout", "viewWallet", "viewReceipt"];

    let user = null;
    let request = null;
    let walletMethod = null;

    /* ---------- helpers ---------- */

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const money = (value) =>
        new Intl.NumberFormat("en-PH", {
            style: "currency",
            currency: "PHP"
        }).format(Number(value) || 0);

    const shortId = (id) => String(id).slice(0, 8).toUpperCase();

    const makeReference = () =>
        "PMS-" +
        Array.from(crypto.getRandomValues(new Uint8Array(5)))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
            .toUpperCase();

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

    function show(viewId) {
        VIEWS.forEach((id) => { $(id).hidden = id !== viewId; });
        window.scrollTo({ top: 0 });
    }

    function showBanner(message) {
        const banner = $("pmBanner");
        banner.textContent = message;
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

    function setPayError(message) {
        const el = $("payError");
        el.textContent = message || "";
        el.hidden = !message;
    }

    const getMethod = () =>
        document.querySelector('input[name="method"]:checked').value;

    /* ---------- checkout view ---------- */

    function renderCheckout() {
        const name = [request.first_name, request.middle_name, request.last_name]
            .filter(Boolean)
            .join(" ");

        $("sumService").textContent =
            SERVICE_NAMES[request.service] || request.service;
        $("sumRef").textContent = shortId(request.id);
        $("sumName").textContent = name || "-";
        $("sumAmount").textContent = money(request.amount);
        $("payButton").textContent = `Pay ${money(request.amount)}`;

        updateMethodUI();
        show("viewCheckout");
    }

    function updateMethodUI() {
        const isCard = getMethod() === "card";

        $("cardForm").hidden = !isCard;
        $("walletNote").hidden = isCard;
        setPayError("");
    }

    document.querySelectorAll('input[name="method"]').forEach((radio) =>
        radio.addEventListener("change", updateMethodUI)
    );

    /* ---------- card input formatting ---------- */

    $("cardNumber").addEventListener("input", (e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 16);
        e.target.value = digits.replace(/(.{4})/g, "$1 ").trim();
    });

    $("cardExpiry").addEventListener("input", (e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
        e.target.value =
            digits.length >= 3 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    });

    $("cardCvc").addEventListener("input", (e) => {
        e.target.value = e.target.value.replace(/\D/g, "").slice(0, 3);
    });

    ["cardNumber", "cardExpiry", "cardCvc", "cardName"].forEach((id) =>
        $(id).addEventListener("input", () => {
            $(id).classList.remove("pm-invalid");
            setPayError("");
        })
    );

    function invalid(id, message) {
        $(id).classList.add("pm-invalid");
        $(id).focus();
        setPayError(message);
        return false;
    }

    function validateCard() {
        const digits = $("cardNumber").value.replace(/\D/g, "");

        if (digits.length !== 16) {
            return invalid("cardNumber", "Enter a 16-digit card number.");
        }

        if (![...TEST_CARD_SUCCESS, ...TEST_CARD_FAIL].includes(digits)) {
            return invalid(
                "cardNumber",
                "This simulation only accepts the test cards listed below."
            );
        }

        const match = /^(\d{2})\/(\d{2})$/.exec($("cardExpiry").value);
        if (!match) {
            return invalid("cardExpiry", "Enter the expiry date as MM/YY.");
        }

        const month = Number(match[1]);
        const year = 2000 + Number(match[2]);
        const now = new Date();

        if (month < 1 || month > 12) {
            return invalid("cardExpiry", "Enter a valid expiry month (01-12).");
        }

        if (
            year < now.getFullYear() ||
            (year === now.getFullYear() && month < now.getMonth() + 1)
        ) {
            return invalid("cardExpiry", "This card has expired. Use a future date.");
        }

        if (!/^\d{3}$/.test($("cardCvc").value)) {
            return invalid("cardCvc", "Enter the 3-digit CVC.");
        }

        if ($("cardName").value.trim().length < 2) {
            return invalid("cardName", "Enter the name on the card.");
        }

        return true;
    }

    /* ---------- payment actions ---------- */

    $("payButton").addEventListener("click", async () => {
        clearBanner();
        setPayError("");

        const method = getMethod();

        if (method === "card") {
            if (!validateCard()) return;

            const digits = $("cardNumber").value.replace(/\D/g, "");
            await runPayment(
                TEST_CARD_SUCCESS.includes(digits),
                "card",
                "Your card was declined. Try another payment method or card."
            );
            return;
        }

        openWallet(method);
    });

    function openWallet(method) {
        const info = METHODS[method];
        walletMethod = method;

        const chip = $("walletChip");
        chip.className = `pm-chip pm-chip-lg ${info.css}`;
        chip.textContent = info.chip;

        $("walletTitle").textContent = `Authorize ${info.label} payment`;
        $("walletText").textContent =
            `Test payment of ${money(request.amount)} to BarangayPay. ` +
            `No real ${info.label} account is charged.`;

        show("viewWallet");
    }

    $("walletAuthorize").addEventListener("click", () =>
        runPayment(true, walletMethod)
    );

    $("walletFail").addEventListener("click", () =>
        runPayment(
            false,
            walletMethod,
            `The ${METHODS[walletMethod].label} payment was not authorized. You can try again.`
        )
    );

    $("walletCancel").addEventListener("click", () => {
        clearBanner();
        show("viewCheckout");
    });

    async function runPayment(success, method, failMessage) {
        $("processing").hidden = false;

        try {
            await sleep(PROCESSING_MS);

            if (success) {
                await markPaid(method);
                clearBanner();
                renderReceipt();
            } else {
                await markFailed();
                show("viewCheckout");
                showBanner(failMessage || "The payment failed. Please try again.");
            }
        } catch (error) {
            console.error("Could not record the payment:", error);
            show("viewCheckout");
            showBanner(`Could not record your payment: ${error.message}`);
        } finally {
            $("processing").hidden = true;
        }
    }

    async function markPaid(method) {
        const { data, error } = await supabaseClient
            .from("service_requests")
            .update({
                payment_status: "paid",
                payment_method: METHODS[method].label,
                payment_reference: makeReference(),
                paid_at: new Date().toISOString()
            })
            .eq("id", request.id)
            .eq("resident_id", user.id)
            .select()
            .single();

        if (error) throw error;
        request = data;
    }

    async function markFailed() {
        // Best effort: a failed attempt should never block a retry.
        const { error } = await supabaseClient
            .from("service_requests")
            .update({ payment_status: "failed" })
            .eq("id", request.id)
            .eq("resident_id", user.id);

        if (error) console.warn("Could not record failed attempt:", error);
        request.payment_status = "failed";
    }

    /* ---------- receipt view ---------- */

    function renderReceipt() {
        const free = request.payment_status === "not_required";

        $("receiptTitle").textContent = free
            ? "Request submitted"
            : "Payment successful";

        $("receiptText").textContent = free
            ? "This service is free. Your request has been sent to the barangay."
            : "Your payment was received and your request has been sent to the barangay.";

        $("rcRef").textContent = request.payment_reference || "No payment needed";
        $("rcRequest").textContent = shortId(request.id);
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

        show("viewReceipt");
    }

    /* ---------- load request ---------- */

    try {
        if (typeof supabaseClient === "undefined") {
            throw new Error(
                "Supabase client is not initialized. Check ../js/supabase.js."
            );
        }

        const { data: sessionData, error: sessionError } =
            await supabaseClient.auth.getSession();

        if (sessionError) throw sessionError;

        if (!sessionData.session) {
            window.location.href = "../login/login.html";
            return;
        }

        user = sessionData.session.user;

        const requestId = new URLSearchParams(window.location.search).get("request");

        if (!requestId) {
            showFatal("No request was selected for payment.");
            return;
        }

        const { data, error } = await supabaseClient
            .from("service_requests")
            .select("*")
            .eq("id", requestId)
            .eq("resident_id", user.id)
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            showFatal("We could not find this request in your account.");
            return;
        }

        request = data;

        const settled = ["paid", "not_required"].includes(request.payment_status);

        if (settled) {
            renderReceipt();
        } else {
            renderCheckout();
        }
    } catch (error) {
        console.error("Payment page failed to load:", error);
        showFatal(`Could not load this payment page: ${error.message}`);
    }
});
