/* Staff reports: live Supabase data, accurate period statistics, detailed
   generated reports, CSV/PDF export, print, and browser-local history. */
(() => {
    "use strict";

    const HISTORY_KEY = "bp_staff_report_history";
    const HISTORY_LIMIT = 10;
    const PAGE_SIZE = 1000;
    const DEFAULT_RANGE_DAYS = 30;

    const REPORT_NAMES = {
        service: "Service Requests Report",
        payment: "Payment Summary Report",
        document: "Documents Report",
        resident: "Resident Activity Report"
    };

    // The live schema uses `ready`; older data can still contain `approved`.
    const REQUEST_STATUS_ORDER = [
        "pending", "processing", "ready", "approved",
        "completed", "rejected", "cancelled"
    ];

    const REQUEST_STATUS_LABELS = {
        pending: "Pending",
        processing: "Processing",
        ready: "Approved / Ready",
        approved: "Approved / Ready",
        completed: "Completed",
        rejected: "Rejected",
        cancelled: "Cancelled"
    };

    const PAYMENT_STATUS_ORDER = ["paid", "unpaid", "failed", "not_required"];
    const PAYMENT_STATUS_LABELS = {
        paid: "Successful (Paid)",
        unpaid: "Pending (Unpaid)",
        failed: "Failed",
        not_required: "Free / Not Required"
    };

    const DOCUMENT_STATUS_ORDER = [
        "pending_generation", "ready_for_release", "released", "archived"
    ];

    const DOCUMENT_STATUS_LABELS = {
        pending_generation: "Pending Generation",
        ready_for_release: "Ready for Release",
        released: "Released",
        archived: "Archived"
    };

    const $ = (id) => document.getElementById(id);
    const { escapeHTML, peso, formatDate, fullName, capitalize } = window.BP;

    let staffName = "Staff";
    let current = null; // { data, report }

    /* ---------- small helpers ---------- */

    const lower = (value) => String(value ?? "").toLowerCase();
    const amount = (value) => Number(value) || 0;
    const isPaid = (request) => lower(request?.payment_status) === "paid";
    const isPaymentRecord = (request) =>
        ["paid", "unpaid", "failed"].includes(lower(request?.payment_status));

    function labelFor(value, labels) {
        const key = lower(value);
        return labels[key] || (value ? capitalize(value) : "Not specified");
    }

    function formatDateTime(value) {
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return "—";
        return date.toLocaleString("en-PH", {
            dateStyle: "medium",
            timeStyle: "short"
        });
    }

    function inRange(value, start, end) {
        const time = Date.parse(value);
        return Number.isFinite(time) && time >= Date.parse(start) && time < Date.parse(end);
    }

    function sumAmounts(rows) {
        return rows.reduce((total, row) => total + amount(row.amount), 0);
    }

    function countBy(rows, getKey) {
        const counts = new Map();

        rows.forEach((row) => {
            const key = String(getKey(row) ?? "").trim() || "Not specified";
            counts.set(key, (counts.get(key) || 0) + 1);
        });

        return [...counts.entries()].sort((a, b) =>
            b[1] - a[1] || a[0].localeCompare(b[0]));
    }

    function statusCounts(rows, field = "status") {
        const counts = {};

        rows.forEach((row) => {
            const key = lower(row[field]) || "unknown";
            counts[key] = (counts[key] || 0) + 1;
        });

        return counts;
    }

    function statusRows(counts, order, labels) {
        const keys = [...new Set([...order, ...Object.keys(counts)])];
        const merged = new Map();

        keys.forEach((key) => {
            const label = labels[key] || capitalize(key);
            merged.set(label, (merged.get(label) || 0) + (counts[key] || 0));
        });

        return [...merged.entries()].map(([label, count]) => [label, String(count)]);
    }

    function displayName(row, profile) {
        return fullName(row) || profile?.full_name || profile?.email ||
            row?.email || row?.resident_id || "Resident";
    }

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

    /* ---------- inline status (replaces native alerts) ---------- */

    function setStatus(message, type = "info") {
        const element = $("reportStatus");
        if (!element) return;

        element.textContent = message || "";
        element.className = `report-status ${type}`;
        element.hidden = !message;
    }

    /* ---------- data ---------- */

    // Supabase caps a single response at 1000 rows; page through everything.
    async function fetchAll(table, columns, applyFilters) {
        const rows = [];

        for (let offset = 0; offset < 50000; offset += PAGE_SIZE) {
            let query = BP.getClient().from(table).select(columns);
            if (applyFilters) query = applyFilters(query);

            const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
            if (error) throw error;

            const batch = data || [];
            rows.push(...batch);
            if (batch.length < PAGE_SIZE) break;
        }

        return rows;
    }

    async function fetchRange(from, to) {
        const { start, end } = rangeBounds(from, to);

        const requestsPromise = fetchAll(
            "service_requests",
            "id, request_code, resident_id, service, service_id, first_name, middle_name, last_name, contact_number, address, purpose, preferred_date, notes, remarks, amount, status, payment_status, payment_method, payment_reference, paid_at, submitted_at",
            (query) => query
                .gte("submitted_at", start)
                .lt("submitted_at", end)
                .order("submitted_at", { ascending: false })
        );

        const documentsPromise = fetchAll(
            "documents",
            "id, document_code, request_id, document_type, status, generated_at, released_at, created_at, file_path",
            (query) => query
                .gte("created_at", start)
                .lt("created_at", end)
                .order("created_at", { ascending: false })
        );

        const profilesPromise = fetchAll(
            "profiles",
            "id, full_name, email, role, status, created_at",
            (query) => query
                .eq("role", "resident")
                .order("created_at", { ascending: false })
        );

        const [requestResult, documentResult, profileResult] =
            await Promise.allSettled([requestsPromise, documentsPromise, profilesPromise]);

        if (requestResult.status === "rejected") throw requestResult.reason;
        if (profileResult.status === "rejected") throw profileResult.reason;

        const warnings = [];
        let documents = [];

        if (documentResult.status === "rejected") {
            warnings.push("Documents could not be loaded: " +
                (documentResult.reason?.message || "unknown error"));
            console.warn("Documents could not be loaded for the report:", documentResult.reason);
        } else {
            documents = documentResult.value;
        }

        return {
            requests: requestResult.value,
            documents,
            profiles: profileResult.value,
            warnings,
            from,
            to,
            start,
            end
        };
    }

    /* ---------- report model (shared by HTML, CSV and PDF) ---------- */

    function buildReport(type, data) {
        const { requests, documents, profiles, from, to, start, end } = data;
        const generatedAt = new Date();
        const paid = requests.filter(isPaid);
        const payments = requests.filter(isPaymentRecord);
        const revenue = sumAmounts(paid);

        const report = {
            type,
            title: REPORT_NAMES[type] || "Report",
            from,
            to,
            range: rangeLabel(from, to),
            generatedAt: formatDateTime(generatedAt),
            generatedBy: staffName,
            stats: [],
            sections: []
        };

        if (type === "payment") {
            const statusCountsForPayments = statusCounts(payments, "payment_status");
            const methodMap = new Map();

            payments.forEach((request) => {
                const method = String(request.payment_method || "").trim() || "Not specified";
                const entry = methodMap.get(method) || { count: 0, paidCount: 0, revenue: 0 };
                entry.count += 1;
                if (isPaid(request)) {
                    entry.paidCount += 1;
                    entry.revenue += amount(request.amount);
                }
                methodMap.set(method, entry);
            });

            report.stats = [
                { label: "Total Payments", value: payments.length },
                { label: "Successful", value: statusCountsForPayments.paid || 0 },
                { label: "Pending", value: statusCountsForPayments.unpaid || 0 },
                { label: "Failed", value: statusCountsForPayments.failed || 0 },
                { label: "Total Revenue Collected", value: peso(revenue) },
                {
                    label: "Average Paid Transaction",
                    value: peso(paid.length ? revenue / paid.length : 0)
                }
            ];

            report.sections = [
                {
                    title: "Payment Status Breakdown",
                    columns: ["Status", "Transactions"],
                    rows: statusRows(statusCountsForPayments, PAYMENT_STATUS_ORDER, PAYMENT_STATUS_LABELS)
                },
                {
                    title: "Payment Method Breakdown",
                    columns: ["Method", "Transactions", "Successful", "Revenue"],
                    rows: [...methodMap.entries()]
                        .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
                        .map(([method, entry]) => [
                            method,
                            String(entry.count),
                            String(entry.paidCount),
                            peso(entry.revenue)
                        ])
                },
                {
                    title: "Payment Details",
                    columns: ["Request Code", "Resident", "Service", "Amount", "Status", "Method", "Reference", "Paid At"],
                    rows: payments.map((request) => [
                        request.request_code || request.id || "—",
                        fullName(request) || "Resident",
                        request.service || `Service #${request.service_id ?? "?"}`,
                        peso(request.amount),
                        labelFor(request.payment_status, PAYMENT_STATUS_LABELS),
                        request.payment_method || "Not specified",
                        request.payment_reference || "—",
                        formatDate(request.paid_at)
                    ])
                }
            ];

            return report;
        }

        if (type === "document") {
            const documentCounts = statusCounts(documents);
            const generated = documents.filter((document) => document.generated_at).length;
            const released = documents.filter((document) => document.released_at).length;
            const requestCodes = new Map(
                requests.map((request) => [request.id, request.request_code || request.id || "—"])
            );

            report.stats = [
                { label: "Total Documents", value: documents.length },
                { label: "Pending Generation", value: documentCounts.pending_generation || 0 },
                { label: "Ready for Release", value: documentCounts.ready_for_release || 0 },
                { label: "Released", value: documentCounts.released || 0 },
                { label: "Archived", value: documentCounts.archived || 0 },
                { label: "Generated", value: generated },
                { label: "Release Dates Recorded", value: released }
            ];

            report.sections = [
                {
                    title: "Document Status Breakdown",
                    columns: ["Status", "Documents"],
                    rows: statusRows(documentCounts, DOCUMENT_STATUS_ORDER, DOCUMENT_STATUS_LABELS)
                },
                {
                    title: "Document Type Breakdown",
                    columns: ["Document Type", "Documents"],
                    rows: countBy(documents, (document) => document.document_type)
                },
                {
                    title: "Document Details",
                    columns: ["Document Code", "Request", "Type", "Status", "Generated", "Released", "Created"],
                    rows: documents.map((document) => [
                        document.document_code || document.id || "—",
                        requestCodes.get(document.request_id) || document.request_id || "—",
                        document.document_type || "Not specified",
                        labelFor(document.status, DOCUMENT_STATUS_LABELS),
                        formatDate(document.generated_at),
                        formatDate(document.released_at),
                        formatDate(document.created_at)
                    ])
                }
            ];

            return report;
        }

        if (type === "resident") {
            const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
            const newProfiles = profiles.filter((profile) =>
                inRange(profile.created_at, start, end));
            const activity = new Map();

            requests.forEach((request) => {
                const key = request.resident_id || fullName(request) || "unknown";
                const profile = profileById.get(request.resident_id);
                const entry = activity.get(key) || {
                    name: displayName(request, profile),
                    requests: 0,
                    completed: 0,
                    paid: 0,
                    last: ""
                };

                entry.requests += 1;
                if (lower(request.status) === "completed") entry.completed += 1;
                if (isPaid(request)) entry.paid += amount(request.amount);

                const submitted = String(request.submitted_at || "");
                if (submitted > entry.last) entry.last = submitted;

                activity.set(key, entry);
            });

            const activeResidents = new Set(
                requests.map((request) => request.resident_id).filter(Boolean)
            ).size;

            report.stats = [
                { label: "Total Registered Residents", value: profiles.length },
                { label: "New Registrations This Period", value: newProfiles.length },
                { label: "Active Residents (with requests)", value: activeResidents },
                { label: "Requests Submitted", value: requests.length },
                {
                    label: "Completed Requests",
                    value: requests.filter((request) => lower(request.status) === "completed").length
                },
                { label: "Total Paid by Residents", value: peso(revenue) }
            ];

            report.sections = [
                {
                    title: "Resident Activity Summary",
                    columns: ["Resident", "Requests", "Completed", "Total Paid", "Last Activity"],
                    rows: [...activity.values()]
                        .sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name))
                        .map((entry) => [
                            entry.name,
                            String(entry.requests),
                            String(entry.completed),
                            peso(entry.paid),
                            formatDate(entry.last)
                        ])
                },
                {
                    title: "New Registrations",
                    columns: ["Resident", "Email", "Status", "Registered"],
                    rows: newProfiles.map((profile) => [
                        profile.full_name || "Resident",
                        profile.email || "—",
                        capitalize(profile.status || "active"),
                        formatDate(profile.created_at)
                    ])
                },
                {
                    title: "Resident Request Details",
                    columns: ["Request Code", "Resident", "Service", "Status", "Payment", "Amount", "Submitted"],
                    rows: requests.map((request) => [
                        request.request_code || request.id || "—",
                        fullName(request) ||
                            profileById.get(request.resident_id)?.full_name ||
                            profileById.get(request.resident_id)?.email ||
                            "Resident",
                        request.service || `Service #${request.service_id ?? "?"}`,
                        labelFor(request.status, REQUEST_STATUS_LABELS),
                        labelFor(request.payment_status, PAYMENT_STATUS_LABELS),
                        peso(request.amount),
                        formatDate(request.submitted_at)
                    ])
                }
            ];

            return report;
        }

        // Default: service requests.
        const requestCounts = statusCounts(requests);
        const serviceMap = new Map();

        requests.forEach((request) => {
            const service = String(request.service || "").trim() ||
                `Service #${request.service_id ?? "?"}`;
            const entry = serviceMap.get(service) || { count: 0, revenue: 0 };
            entry.count += 1;
            if (isPaid(request)) entry.revenue += amount(request.amount);
            serviceMap.set(service, entry);
        });

        report.stats = [
            { label: "Total Requests", value: requests.length },
            { label: "Pending", value: requestCounts.pending || 0 },
            {
                label: "Approved",
                value: (requestCounts.ready || 0) + (requestCounts.approved || 0)
            },
            { label: "Rejected", value: requestCounts.rejected || 0 },
            { label: "Completed", value: requestCounts.completed || 0 },
            { label: "Processing", value: requestCounts.processing || 0 },
            { label: "Cancelled", value: requestCounts.cancelled || 0 },
            { label: "Revenue Collected", value: peso(revenue) }
        ];

        report.sections = [
            {
                title: "Request Status Breakdown",
                columns: ["Status", "Requests"],
                rows: statusRows(requestCounts, REQUEST_STATUS_ORDER, REQUEST_STATUS_LABELS)
            },
            {
                title: "Service Type Breakdown",
                columns: ["Service Type", "Requests", "Paid Amount"],
                rows: [...serviceMap.entries()]
                    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
                    .map(([service, entry]) => [
                        service,
                        String(entry.count),
                        peso(entry.revenue)
                    ])
            },
            {
                title: "Request Details",
                columns: ["Request Code", "Resident", "Service", "Status", "Payment", "Amount", "Submitted"],
                rows: requests.map((request) => [
                    request.request_code || request.id || "—",
                    fullName(request) || "Resident",
                    request.service || `Service #${request.service_id ?? "?"}`,
                    labelFor(request.status, REQUEST_STATUS_LABELS),
                    labelFor(request.payment_status, PAYMENT_STATUS_LABELS),
                    peso(request.amount),
                    formatDate(request.submitted_at)
                ])
            }
        ];

        return report;
    }

    /* ---------- page updates ---------- */

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

    function renderServiceBars(requests) {
        const container = $("serviceBars");
        if (!container) return;

        const counts = countBy(requests, (request) =>
            request.service || `Service #${request.service_id ?? "?"}`);

        if (!counts.length) {
            container.innerHTML = '<p class="service-empty">No requests in this period.</p>';
            return;
        }

        const max = Math.max(...counts.map((entry) => entry[1]));

        container.innerHTML = counts.map(([name, count]) => `
            <div class="service-bar-row">
                <div class="bar-label">
                    <span>${escapeHTML(name)}</span>
                    <strong>${count}</strong>
                </div>
                <div class="bar-track">
                    <div class="bar-fill" style="width: ${Math.round((count / max) * 100)}%;"></div>
                </div>
            </div>
        `).join("");
    }

    function render(data) {
        const { requests, documents } = data;
        const paid = requests.filter(isPaid);
        const unpaid = requests.filter((request) =>
            ["unpaid", "failed"].includes(lower(request.payment_status)));
        const revenue = sumAmounts(paid);
        const counts = statusCounts(requests);
        const documentCounts = statusCounts(documents);

        setLabeled(".report-summary", "Total Requests", requests.length);
        setLabeled(".report-summary", "Total Payments", peso(revenue));
        setLabeled(".report-summary", "Documents Issued", documentCounts.released || 0);
        setLabeled(".report-summary", "Active Residents",
            new Set(requests.map((request) => request.resident_id).filter(Boolean)).size);

        renderServiceBars(requests);

        ["pending", "processing", "completed", "rejected"].forEach((status) =>
            setLabeled(".status-report", capitalize(status), counts[status] || 0));

        setLabeled(".payment-summary", "Paid Transactions", paid.length);
        setLabeled(".payment-summary", "Unpaid Transactions", unpaid.length);
        setLabeled(".payment-summary", "Total Collected", peso(revenue));
        setLabeled(".payment-summary", "Average Transaction",
            peso(paid.length ? revenue / paid.length : 0));

        setLabeled(".document-report", "Generated",
            documents.filter((document) => document.generated_at).length);
        setLabeled(".document-report", "Ready for Release",
            documentCounts.ready_for_release || 0);
        setLabeled(".document-report", "Released", documentCounts.released || 0);
        setLabeled(".document-report", "Archived", documentCounts.archived || 0);
    }

    function tableHTML(section) {
        const columns = section.columns || [];
        const rows = section.rows || [];

        const head = columns.map((column) => `<th>${escapeHTML(column)}</th>`).join("");
        const body = rows.length
            ? rows.map((row) => `
                <tr>
                    ${columns.map((_, index) => `<td>${escapeHTML(row[index] ?? "—")}</td>`).join("")}
                </tr>
            `).join("")
            : `<tr><td colspan="${columns.length}">No records found.</td></tr>`;

        return `
            <section class="report-section">
                <h4>${escapeHTML(section.title)}</h4>
                <div class="report-table-wrapper">
                    <table class="report-table">
                        <thead><tr>${head}</tr></thead>
                        <tbody>${body}</tbody>
                    </table>
                </div>
            </section>
        `;
    }

    function renderDetailedReport(report) {
        const section = $("generatedReport");
        const body = $("generatedReportBody");
        if (!section || !body) return;

        if (!report) {
            section.hidden = true;
            body.replaceChildren();
            return;
        }

        section.hidden = false;
        $("generatedReportTitle").textContent = report.title;
        $("generatedReportMeta").textContent =
            `${report.range} • Generated ${report.generatedAt} by ${report.generatedBy}`;

        body.innerHTML = `
            <div class="report-stats-grid">
                ${report.stats.map((stat) => `
                    <div class="report-stat">
                        <span>${escapeHTML(stat.label)}</span>
                        <strong>${escapeHTML(stat.value)}</strong>
                    </div>
                `).join("")}
            </div>
            ${report.sections.map(tableHTML).join("")}
        `;
    }

    /* ---------- CSV ---------- */

    function csvCell(value) {
        const text = String(value ?? "");
        // Neutralise spreadsheet formulas and quote every cell.
        const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
        return `"${safe.replace(/"/g, '""')}"`;
    }

    function csvLines(type, data) {
        const report = buildReport(type, data);
        const lines = [
            ["BarangayPay Report"],
            ["Report", report.title],
            ["Date Range", report.range],
            ["Generated", report.generatedAt],
            ["Generated By", report.generatedBy],
            [],
            ["SUMMARY STATISTICS"]
        ];

        report.stats.forEach((stat) => lines.push([stat.label, stat.value]));

        report.sections.forEach((section) => {
            lines.push([]);
            lines.push([section.title]);
            lines.push(section.columns);
            section.rows.forEach((row) => lines.push(row));
        });

        if (data.warnings?.length) {
            lines.push([]);
            lines.push(["Warnings", data.warnings.join(" | ")]);
        }

        return lines;
    }

    function downloadCsv(type, data) {
        const csv = csvLines(type, data).map((row) => row.map(csvCell).join(",")).join("\r\n");
        const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
        downloadBlob(blob, `barangaypay-${type}-${data.from}-to-${data.to}.csv`);
    }

    /* ---------- PDF (dependency-free text PDF) ---------- */

    // Standard PDF Type1 fonts are Latin-1 only; keep the document ASCII-safe.
    function pdfPlain(value) {
        return String(value ?? "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/₱/g, "PHP ")
            .replace(/[–—]/g, "-")
            .replace(/[^\x20-\x7E]/g, "?");
    }

    function pdfEscape(value) {
        return pdfPlain(value)
            .replace(/\\/g, "\\\\")
            .replace(/\(/g, "\\(")
            .replace(/\)/g, "\\)");
    }

    function wrapText(value, maxChars) {
        const words = pdfPlain(value).split(/\s+/).filter(Boolean);
        if (!words.length) return [""];

        const lines = [];
        let line = "";

        words.forEach((word) => {
            const candidate = line ? `${line} ${word}` : word;
            if (candidate.length <= maxChars) {
                line = candidate;
            } else {
                if (line) lines.push(line);
                line = word.length > maxChars ? word.slice(0, maxChars) : word;
            }
        });

        if (line) lines.push(line);
        return lines;
    }

    function fitCell(value, width, isLast) {
        const text = pdfPlain(value);
        let fitted = text.length > width ? `${text.slice(0, width - 1)}.` : text;
        return isLast ? fitted : fitted.padEnd(width, " ");
    }

    function pdfTable(write, columns, rows) {
        const sample = rows.slice(0, 300);
        let widths = columns.map((column, index) => {
            let width = pdfPlain(column).length + 2;
            sample.forEach((row) => {
                width = Math.max(width, pdfPlain(row[index] ?? "").length + 2);
            });
            return Math.min(Math.max(width, 8), 40);
        });

        const total = widths.reduce((sum, width) => sum + width, 0);
        if (total > 100) {
            const scale = 100 / total;
            widths = widths.map((width) => Math.max(8, Math.floor(width * scale)));
        }

        const formatRow = (row) => columns
            .map((_, index) => fitCell(row[index] ?? "", widths[index], index === columns.length - 1))
            .join("");

        write(formatRow(columns.map((column) => column.toUpperCase())), { size: 8 });
        rows.forEach((row) => write(formatRow(row), { size: 8 }));
    }

    function buildPdf(report) {
        const pages = [];
        let content = [];
        let y = 799;
        const margin = 42;

        const newPage = () => {
            if (content.length) pages.push(content);
            content = [];
            y = 799;
        };

        const write = (text, options = {}) => {
            const font = options.font || "F3";
            const size = options.size || 9;
            const leading = size + 4;

            if (y < margin + leading) newPage();

            content.push(
                `BT /${font} ${size} Tf ${margin} ${y.toFixed(2)} Td (${pdfEscape(text)}) Tj ET`
            );
            y -= leading;
        };

        const line = (text) => wrapText(text, 100).forEach((part) => write(part));

        const heading = (text) => {
            y -= 6;
            write(text, { font: "F2", size: 13 });
            y -= 2;
        };

        write("BarangayPay", { font: "F2", size: 12 });
        write(report.title, { font: "F2", size: 18 });
        line(`Date Range: ${report.range}`);
        line(`Generated: ${report.generatedAt}`);
        line(`Generated By: ${report.generatedBy}`);
        if (report.warnings?.length) report.warnings.forEach((warning) => line(`Warning: ${warning}`));

        heading("SUMMARY STATISTICS");
        pdfTable(write, ["Metric", "Value"], report.stats.map((stat) => [stat.label, stat.value]));

        report.sections.forEach((section) => {
            heading(section.title);
            pdfTable(write, section.columns, section.rows);
        });

        // Flush the final page before adding footer page numbers.
        newPage();
        pages.forEach((lines, index) => {
            lines.push(
                `BT /F1 8 Tf ${margin} 26 Td (Page ${index + 1} of ${pages.length}) Tj ET`
            );
        });

        const objects = [];
        objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
        objects[2] = `<< /Type /Pages /Kids [${pages
            .map((_, index) => `${6 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`;
        objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
        objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
        objects[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>";

        pages.forEach((lines, index) => {
            const pageNumber = 6 + index * 2;
            const contentNumber = pageNumber + 1;
            const stream = lines.join("\n");

            objects[pageNumber] =
                `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] ` +
                `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> ` +
                `/Contents ${contentNumber} 0 R >>`;
            objects[contentNumber] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
        });

        let pdf = "%PDF-1.4\n";
        const offsets = [0];

        for (let number = 1; number < objects.length; number += 1) {
            offsets[number] = pdf.length;
            pdf += `${number} 0 obj\n${objects[number]}\nendobj\n`;
        }

        const xrefOffset = pdf.length;
        pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;

        for (let number = 1; number < objects.length; number += 1) {
            pdf += `${String(offsets[number]).padStart(10, "0")} 00000 n \n`;
        }

        pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\n`;
        pdf += `startxref\n${xrefOffset}\n%%EOF`;

        return new Blob([pdf], { type: "application/pdf" });
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.style.display = "none";
        document.body.appendChild(link);
        link.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window
        }));
        link.remove();
        // Keep the blob URL alive long enough for slower browsers to start the save.
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    function downloadPdf(report) {
        const blob = buildPdf(report);
        downloadBlob(blob, `barangaypay-${report.type}-${report.from}-to-${report.to}.pdf`);
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
        const type = $("reportType").value;
        const button = $("generateReport");

        if (!from || !to) {
            setStatus("Please select a date range.", "warning");
            return;
        }
        if (from > to) {
            setStatus("The starting date cannot be later than the ending date.", "warning");
            return;
        }

        button.disabled = true;
        setStatus("Generating report...", "info");

        try {
            const data = await fetchRange(from, to);
            data.warnings = data.warnings || [];
            const report = buildReport(type, data);
            report.warnings = data.warnings;

            current = { data, report };
            render(data);
            renderDetailedReport(report);

            if (record) {
                $("generatedReport")?.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });

                addToHistory({
                    type,
                    from,
                    to,
                    by: staffName,
                    at: new Date().toISOString()
                });
            }

            if (data.warnings.length) {
                setStatus(`Report generated with warnings: ${data.warnings.join(" ")}`, "warning");
            } else {
                setStatus(
                    `Report generated for ${report.range}. Use PDF, CSV, or Print below.`,
                    "success"
                );
            }
        } catch (error) {
            console.error("Report generation failed:", error);
            setStatus(`Could not generate the report: ${error.message}`, "error");
        } finally {
            button.disabled = false;
        }
    }

    $("generateReport").addEventListener("click", () => generate({ record: true }));

    // The three existing panel export buttons stay in place and keep working.
    const PANEL_EXPORT_TYPES = ["service", "payment", "document"];
    document.querySelectorAll(".reports-grid .export-button").forEach((button, index) => {
        button.addEventListener("click", () => {
            if (!current) {
                setStatus("Generate a report first.", "warning");
                return;
            }
            downloadCsv(PANEL_EXPORT_TYPES[index], current.data);
            setStatus("CSV download started.", "success");
        });
    });

    $("downloadReportCsv")?.addEventListener("click", () => {
        if (!current) {
            setStatus("Generate a report first.", "warning");
            return;
        }
        downloadCsv(current.report.type, current.data);
        setStatus("CSV download started.", "success");
    });

    $("downloadReportPdf")?.addEventListener("click", () => {
        if (!current) {
            setStatus("Generate a report first.", "warning");
            return;
        }
        downloadPdf(current.report);
        setStatus("PDF download started.", "success");
    });

    $("printReport")?.addEventListener("click", () => {
        if (!current) {
            setStatus("Generate a report first.", "warning");
            return;
        }
        document.body.classList.add("bp-print-report");
        window.print();
        setTimeout(() => document.body.classList.remove("bp-print-report"), 0);
    });

    document.querySelector(".recent-reports-table")?.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-history]");
        if (!button) return;

        const entry = readHistory()[Number(button.dataset.history)];
        if (!entry) return;

        button.disabled = true;
        setStatus("Preparing download...", "info");

        try {
            downloadCsv(entry.type, await fetchRange(entry.from, entry.to));
            setStatus("Report downloaded.", "success");
        } catch (error) {
            console.error("Report download failed:", error);
            setStatus(`Could not download the report: ${error.message}`, "error");
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
            setStatus("Could not verify your staff account. Please sign in again.", "error");
        });
})();
