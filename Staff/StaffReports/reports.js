/* Staff reports: live figures for a date range, CSV export, and a
   per-browser history of generated reports. */
(() => {
    "use strict";

    const HISTORY_KEY = "bp_staff_report_history";
    const HISTORY_LIMIT = 10;
    const DEFAULT_RANGE_DAYS = 30;

    const REPORT_NAMES = {
        service: "Service Requests Report",
        payment: "Payment Summary Report",
        document: "Documents Report",
        resident: "Resident Activity Report"
    };

    const $ = (id) => document.getElementById(id);
    const { escapeHTML, peso, formatDate } = window.BP;

    let staffName = "Staff";
    let current = { requests: [], documents: [], from: "", to: "" };

    /* ---------- dates ---------- */

    function isoDate(date) {
        const local = new Date(date);
        local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
        return local.toISOString().slice(0, 10);
    }

    // [from 00:00, day after `to` 00:00) in local time, as ISO strings.
    function rangeBounds(from, to) {
        const start = new Date(`${from}T00:00:00`);
        const end = new Date(`${to}T00:00:00`);
        end.setDate(end.getDate() + 1);
        return { start: start.toISOString(), end: end.toISOString() };
    }

    function rangeLabel(from, to) {
        return `${formatDate(`${from}T00:00:00`)} – ${formatDate(`${to}T00:00:00`)}`;
    }

    /* ---------- page updates ---------- */

    // Sets the <strong> next to the <span> whose text is `label`, inside `scope`.
    function setLabeled(scope, label, value) {
        const root = typeof scope === "string" ? document.querySelector(scope) : scope;
        if (!root) return;

        [...root.querySelectorAll("span")]
            .filter((span) => span.textContent.trim() === label)
            .forEach((span) => {
                const strong = span.parentElement.querySelector("strong");
                if (strong) strong.textContent = value;
            });
    }

    const lower = (value) => String(value || "").toLowerCase();
    const isPaid = (request) => lower(request.payment_status) === "paid";

    function renderServiceBars(requests) {
        const rows = [...document.querySelectorAll(".service-bar-row")];
        const counts = rows.map((row) => {
            const name = row.querySelector("span")?.textContent.trim() || "";
            return requests.filter((request) => lower(request.service) === lower(name)).length;
        });
        const max = Math.max(1, ...counts);

        rows.forEach((row, index) => {
            const strong = row.querySelector("strong");
            const fill = row.querySelector(".bar-fill");
            if (strong) strong.textContent = counts[index];
            if (fill) fill.style.width = `${Math.round((counts[index] / max) * 100)}%`;
        });
    }

    function render() {
        const { requests, documents } = current;
        const paid = requests.filter(isPaid);
        const unpaid = requests.filter((request) =>
            ["unpaid", "failed"].includes(lower(request.payment_status)));
        const collected = paid.reduce((total, request) => total + Number(request.amount || 0), 0);
        const countStatus = (status) => requests.filter((r) => lower(r.status) === status).length;
        const countDocs = (status) => documents.filter((d) => d.status === status).length;

        setLabeled(".report-summary", "Total Requests", requests.length);
        setLabeled(".report-summary", "Total Payments", peso(collected));
        setLabeled(".report-summary", "Documents Issued", countDocs("released"));
        setLabeled(".report-summary", "Active Residents",
            new Set(requests.map((r) => r.resident_id).filter(Boolean)).size);

        renderServiceBars(requests);

        ["Pending", "Processing", "Completed", "Rejected"].forEach((label) =>
            setLabeled(".status-report", label, countStatus(label.toLowerCase())));

        setLabeled(".payment-summary", "Paid Transactions", paid.length);
        setLabeled(".payment-summary", "Unpaid Transactions", unpaid.length);
        setLabeled(".payment-summary", "Total Collected", peso(collected));
        setLabeled(".payment-summary", "Average Transaction",
            peso(paid.length ? collected / paid.length : 0));

        setLabeled(".document-report", "Generated",
            documents.filter((d) => d.generated_at).length);
        setLabeled(".document-report", "Ready for Release", countDocs("ready_for_release"));
        setLabeled(".document-report", "Released", countDocs("released"));
        setLabeled(".document-report", "Archived", countDocs("archived"));
    }

    /* ---------- data ---------- */

    async function fetchRange(from, to) {
        const client = BP.getClient();
        const { start, end } = rangeBounds(from, to);

        const [requestResult, documentResult] = await Promise.all([
            client
                .from("service_requests")
                .select("id, request_code, resident_id, service, first_name, middle_name, last_name, status, payment_status, payment_method, payment_reference, amount, submitted_at, paid_at")
                .gte("submitted_at", start)
                .lt("submitted_at", end)
                .order("submitted_at", { ascending: false }),
            client
                .from("documents")
                .select("id, document_code, request_id, document_type, status, generated_at, released_at, created_at")
                .gte("created_at", start)
                .lt("created_at", end)
                .order("created_at", { ascending: false })
        ]);

        if (requestResult.error) throw requestResult.error;

        // The documents table is optional; report on requests even without it.
        if (documentResult.error) {
            console.warn("Documents could not be loaded for the report:", documentResult.error);
        }

        return {
            requests: requestResult.data || [],
            documents: documentResult.error ? [] : documentResult.data || [],
            from,
            to
        };
    }

    /* ---------- CSV export ---------- */

    function csvCell(value) {
        const text = String(value ?? "");
        // Neutralise spreadsheet formulas and quote every cell.
        const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
        return `"${safe.replace(/"/g, '""')}"`;
    }

    function rowsFor(type, data) {
        if (type === "document") {
            return [
                ["Document Code", "Request ID", "Type", "Status", "Generated", "Released"],
                ...data.documents.map((d) => [
                    d.document_code, d.request_id, d.document_type, d.status,
                    d.generated_at || "", d.released_at || ""
                ])
            ];
        }

        if (type === "payment") {
            return [
                ["Request Code", "Resident", "Service", "Amount", "Payment Status", "Method", "Reference", "Paid At"],
                ...data.requests.map((r) => [
                    r.request_code, BP.fullName(r), r.service, Number(r.amount || 0).toFixed(2),
                    r.payment_status, r.payment_method || "", r.payment_reference || "", r.paid_at || ""
                ])
            ];
        }

        if (type === "resident") {
            const byResident = new Map();
            data.requests.forEach((r) => {
                const entry = byResident.get(r.resident_id) ||
                    { name: BP.fullName(r), requests: 0, paid: 0 };
                byResident.set(r.resident_id, {
                    ...entry,
                    requests: entry.requests + 1,
                    paid: entry.paid + (isPaid(r) ? Number(r.amount || 0) : 0)
                });
            });
            return [
                ["Resident", "Requests", "Total Paid"],
                ...[...byResident.values()].map((e) => [e.name, e.requests, e.paid.toFixed(2)])
            ];
        }

        return [
            ["Request Code", "Resident", "Service", "Status", "Payment", "Amount", "Submitted"],
            ...data.requests.map((r) => [
                r.request_code, BP.fullName(r), r.service, r.status, r.payment_status,
                Number(r.amount || 0).toFixed(2), r.submitted_at
            ])
        ];
    }

    function downloadCsv(type, data) {
        const csv = rowsFor(type, data).map((row) => row.map(csvCell).join(",")).join("\r\n");
        const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `barangaypay-${type}-${data.from}-to-${data.to}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 0);
    }

    /* ---------- report history (this browser only) ---------- */

    function readHistory() {
        try {
            const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return [];
        }
    }

    function addToHistory(entry) {
        const history = [entry, ...readHistory()].slice(0, HISTORY_LIMIT);
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        } catch (error) {
            console.warn("Could not save report history:", error);
        }
        renderHistory(history);
    }

    function renderHistory(history = readHistory()) {
        const body = document.querySelector(".recent-reports-table tbody");
        if (!body) return;

        if (!history.length) {
            body.innerHTML = '<tr><td colspan="5">No reports generated yet in this browser.</td></tr>';
            return;
        }

        body.innerHTML = history.map((entry, index) => `
            <tr>
                <td>${escapeHTML(REPORT_NAMES[entry.type] || "Report")}</td>
                <td>${escapeHTML(rangeLabel(entry.from, entry.to))}</td>
                <td>${escapeHTML(entry.by)}</td>
                <td>${escapeHTML(formatDate(entry.at))}</td>
                <td>
                    <button type="button" class="view-report-button" data-history="${index}">
                        Download
                    </button>
                </td>
            </tr>
        `).join("");
    }

    /* ---------- actions ---------- */

    async function generate({ record }) {
        const from = $("dateFrom").value;
        const to = $("dateTo").value;
        const button = $("generateReport");

        if (!from || !to) {
            alert("Please select a date range.");
            return;
        }
        if (from > to) {
            alert("The starting date cannot be later than the ending date.");
            return;
        }

        button.disabled = true;
        try {
            current = await fetchRange(from, to);
            render();

            if (record) {
                addToHistory({
                    type: $("reportType").value,
                    from,
                    to,
                    by: staffName,
                    at: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error("Report generation failed:", error);
            alert(`Could not generate the report: ${error.message}`);
        } finally {
            button.disabled = false;
        }
    }

    $("generateReport").addEventListener("click", () => generate({ record: true }));

    // Export buttons sit in the Service, Payment and Document panels, in that order.
    const EXPORT_TYPES = ["service", "payment", "document"];
    document.querySelectorAll(".export-button").forEach((button, index) => {
        button.addEventListener("click", () => {
            if (!current.from) {
                alert("Generate a report first.");
                return;
            }
            downloadCsv(EXPORT_TYPES[index] || "service", current);
        });
    });

    document.querySelector(".recent-reports-table")?.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-history]");
        if (!button) return;

        const entry = readHistory()[Number(button.dataset.history)];
        if (!entry) return;

        button.disabled = true;
        try {
            downloadCsv(entry.type, await fetchRange(entry.from, entry.to));
        } catch (error) {
            console.error("Report download failed:", error);
            alert(`Could not download the report: ${error.message}`);
        } finally {
            button.disabled = false;
        }
    });

    /* ---------- start ---------- */

    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - DEFAULT_RANGE_DAYS);
    $("dateFrom").value = isoDate(start);
    $("dateTo").value = isoDate(today);

    BP.initPortal("staff")
        .then((auth) => {
            if (!auth) return; // redirecting

            staffName = auth.profile.full_name || auth.profile.email || "Staff";
            renderHistory();
            generate({ record: false });
        })
        .catch((error) => {
            console.error("Reports page failed to start:", error);
            alert("Could not verify your staff account. Please sign in again.");
        });
})();
