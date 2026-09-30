from docx import Document
from docx.shared import Pt

TEMPLATE = r"C:\Users\Jhouanese\Downloads\gcash-srs-specification.docx"
OUTPUT = r"C:\Users\Jhouanese\Desktop\BarangayPay\BarangayPay-SRS.docx"


def set_cell(cell, value):
    cell.text = str(value)
    for p in cell.paragraphs:
        for run in p.runs:
            run.font.name = "Arial"
            run.font.size = Pt(9)


def set_table(table, headers, rows):
    while len(table.rows) > 1:
        table._tbl.remove(table.rows[-1]._tr)
    for i, value in enumerate(headers):
        set_cell(table.rows[0].cells[i], value)
    for row in rows:
        cells = table.add_row().cells
        for i, value in enumerate(row):
            set_cell(cells[i], value)


doc = Document(TEMPLATE)
doc.core_properties.title = "BarangayPay Software Requirement Specification"
doc.core_properties.subject = "Technical requirements for the BarangayPay resident services portal"
doc.core_properties.author = "BarangayPay Product and QA Team"

doc.paragraphs[0].text = "SOFTWARE REQUIREMENT SPECIFICATION (SRS)\nBarangayPay Resident Services Portal API, Database, and Technical Specifications"
doc.paragraphs[2].text = "1. REST API Interface Specification (Postman and Playwright Verification)"
doc.paragraphs[4].text = "2. Database Schema and Data Models (PostgreSQL and Document Storage)"
doc.paragraphs[6].text = "3. Non-Functional Requirements (NFR) Matrix"
doc.paragraphs[8].text = "4. End-to-End Requirement Traceability Matrix (RTM)"

set_table(doc.tables[0], ["Document ID", "SRS-BP-RESIDENT-2026-V1.0"], [
    ["Parent Documents", "BRD-BP-RESIDENT-2026-V1.0 and FRD-BP-RESIDENT-2026-V1.0"],
    ["Target System Architecture", "Responsive web client with REST API, relational database, document storage, and PayMongo payment integration"],
    ["Primary Author", "BarangayPay Product and QA Team"],
    ["Verification Tools", "Postman, Playwright, SQL test queries, and application logs"],
])

set_table(doc.tables[1], ["HTTP Endpoint and Method", "Interface Specification"], [
    ["POST /api/v1/auth/login", '{"request": {"email": "resident@example.com", "password": "<password>"}, "response": {"access_token": "<JWT>", "user_id": "USR-0001", "expires_in": 3600}}'],
    ["GET /api/v1/services", "Returns active service records with service_id, name, description, availability, requirements, and fee configuration."],
    ["POST /api/v1/service-requests", '{"service_id": "SRV-BC", "first_name": "Juan", "last_name": "Dela Cruz", "middle_name": "Santos", "contact_number": "09171234567", "address": "123 Mactan St.", "purpose": "employment", "preferred_date": "2026-10-15", "request_notes": "Please prepare for pickup."}'],
    ["Request Headers", "Authorization: Bearer <JWT>\nContent-Type: application/json\nX-Request-ID: <UUID>"],
    ["POST /api/v1/service-requests/{request_id}/documents", "Multipart upload for one or more PDF, JPG, JPEG, or PNG supporting documents. Returns document_id and validation status for each file."],
    ["POST /api/v1/service-requests/{request_id}/submit", "Validates required data and confirmation acknowledgement, creates a transaction reference, and sets the request status to PENDING."],
    ["POST /api/v1/payments/checkout", '{"request_id": "REQ-0001", "amount": 150.00, "currency": "PHP", "return_url": "https://barangaypay.example/payments/return"}'],
    ["Success Response (201 Created)", '{"status": "PENDING", "request_id": "REQ-0001", "transaction_ref": "BP-20260927-0001", "payment_status": "NOT_REQUIRED", "created_at": "2026-09-27T10:00:00Z"}'],
    ["Error Response (422 Unprocessable)", '{"status": "FAILED", "error_code": "ERR-BP-103", "message": "Complete all required information before continuing.", "field_errors": {"contact_number": "Required"}}'],
])

set_table(doc.tables[2], ["Target Database", "Table or Collection Name", "Field Name and Data Type", "QA Validation Query Example"], [
    ["PostgreSQL", "users", "user_id (UUID PK)\nemail (VARCHAR UNIQUE)\npassword_hash (VARCHAR)\nrole (VARCHAR)\nstatus (VARCHAR)", "SELECT status, role FROM users WHERE email = 'resident@example.com';"],
    ["PostgreSQL", "services", "service_id (UUID PK)\nname (VARCHAR)\ndescription (TEXT)\nfee (NUMERIC(10,2))\nis_active (BOOLEAN)", "SELECT name, fee FROM services WHERE is_active = TRUE ORDER BY name;"],
    ["PostgreSQL", "service_requests", "request_id (UUID PK)\nuser_id (UUID FK)\nservice_id (UUID FK)\nstatus (VARCHAR)\npurpose (VARCHAR)\npreferred_date (DATE)\ncreated_at (TIMESTAMP)", "SELECT status FROM service_requests WHERE request_id = 'REQ-0001';"],
    ["PostgreSQL plus object storage", "request_documents", "document_id (UUID PK)\nrequest_id (UUID FK)\nstorage_key (VARCHAR)\nfile_name (VARCHAR)\nmime_type (VARCHAR)\nvalidation_status (VARCHAR)", "SELECT file_name, validation_status FROM request_documents WHERE request_id = 'REQ-0001';"],
    ["PostgreSQL", "payments", "payment_id (UUID PK)\nrequest_id (UUID FK)\nprovider_reference (VARCHAR)\namount (NUMERIC(10,2))\nstatus (VARCHAR)", "SELECT status, amount FROM payments WHERE request_id = 'REQ-0001';"],
    ["PostgreSQL", "request_status_history", "history_id (BIGSERIAL PK)\nrequest_id (UUID FK)\nold_status (VARCHAR)\nnew_status (VARCHAR)\nchanged_at (TIMESTAMP)", "SELECT old_status, new_status FROM request_status_history WHERE request_id = 'REQ-0001' ORDER BY changed_at;"],
    ["Document storage", "audit_events", "event_id (UUID)\nactor_id (UUID)\nentity_type (VARCHAR)\nentity_id (UUID)\naction (VARCHAR)\ncreated_at (TIMESTAMP)", "Find audit_events where entity_id = 'REQ-0001' sorted by created_at ascending."],
])

set_table(doc.tables[3], ["NFR Domain", "Technical Requirement Specification", "Verification Tool and Method"], [
    ["Performance", "P95 API response time shall be no more than 2 seconds under 100 concurrent resident sessions, excluding third-party payment response time.", "Postman collection runner or k6 load test with API metrics."],
    ["Data Security", "All authenticated endpoints shall require TLS, JWT validation, server-side authorization, parameterized queries, and encrypted password storage. Uploaded files shall be type-checked before storage.", "OWASP ZAP, dependency scanning, API security tests, and code review."],
    ["Availability and Recovery", "The service portal shall target 99.5% monthly availability, use health checks, and preserve request and payment records during an API restart or provider timeout.", "Synthetic monitoring, restart testing, backup-restore test, and payment timeout simulation."],
    ["Privacy and Auditability", "Personal information, uploaded-document access, status changes, and payment events shall be logged with actor and timestamp. Access shall be limited by user role and request ownership.", "SQL audit queries, authorization tests, and retention review."],
    ["Usability and Accessibility", "The resident workflow shall remain usable on desktop and mobile widths, provide field-level validation, and expose labels and status messages to keyboard and assistive-technology users.", "Playwright responsive tests, keyboard-only review, and accessibility audit."],
])

set_table(doc.tables[4], ["BRD Requirement ID", "FRD Feature ID", "SRS Technical Specification", "Test Case ID", "Automation Script", "Defect ID"], [
    ["BRD-BP-01", "US-BP-101", "POST /api/v1/auth/login and users query", "TC_BP_AUTH_001", "test_login.spec.js", "N/A"],
    ["BRD-BP-02", "US-BP-102", "GET /api/v1/services and services table", "TC_BP_SERVICE_001", "test_service_catalog.spec.js", "N/A"],
    ["BRD-BP-03", "US-BP-103", "POST /service-requests plus request_documents validation", "TC_BP_REQUEST_001", "test_request_submission.spec.js", "N/A"],
    ["BRD-BP-04", "US-BP-104", "POST /payments/checkout and payments status", "TC_BP_PAYMENT_001", "test_payment_flow.spec.js", "N/A"],
    ["BRD-BP-05", "BR-BP-08", "request_status_history and GET request status", "TC_BP_STATUS_001", "test_status_tracking.spec.js", "N/A"],
])

doc.save(OUTPUT)
print(OUTPUT)
