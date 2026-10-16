# BarangayPay

Web-based barangay transaction and payment system. Residents request
barangay documents and pay online (PayMongo); staff process requests and
release documents; admins manage staff, services and see payments.

Plain HTML/CSS/JavaScript on top of [Supabase](https://supabase.com)
(auth, database, storage, Edge Functions). No build step.

## Portals

| Role     | Start page                    | What it does |
|----------|-------------------------------|--------------|
| Resident | `index.html`                  | Dashboard, request a service, pay, track transactions, profile, settings |
| Staff    | `Staff/StaffPage/staff.html`  | Review requests, accept / reject / complete, documents, reports |
| Admin    | `Admin/admin.html`            | Dashboard, all requests, payments, service fees, staff accounts |

Everyone signs in at `login/login.html` and is sent to their own portal.
Each page checks the signed-in role and redirects anyone who does not belong.

## Project layout

```
js/supabase.js        Supabase client (project URL + publishable key)
js/app.js             Shared helpers: role guard, header, sign-out, formatting, file viewer
js/password.js        Password strength rule + change-password dialog
js/dashboard.js       Resident dashboard
RequestService/       Request form (uploads to the request-documents bucket)
Payment/              PayMongo checkout + receipt
MyTransactions/       Resident request history
Profile/, Settings/   Resident account pages
Staff/                Staff portal pages
Admin/                Admin portal (admin-staff.js, admin-data.js)
supabase/functions/   Edge Functions: create-checkout, paymongo-webhook, manage-staff
supabase/schema.sql   Reference database schema, RLS policies and security triggers
```

`Database/` and `RequestService/submit_request.php` are the old SQLite/PHP
version and are not used by the current site.

## Running locally

Serve the repository root over HTTP (opening files with `file://` breaks the
Supabase session). With VS Code Live Server the site runs at
`http://127.0.0.1:5500`, which is already allowed for payments.

```bash
npx serve -l 5500 .
```

## Supabase setup

1. **Database** – compare `supabase/schema.sql` with your project and run what
   is missing in the SQL editor. Run the *Security triggers* section even if
   your tables already exist: it stops residents from changing their own role
   and makes the database, not the browser, decide a request's price.
2. **Storage** – a private `request-documents` bucket (created by the schema file).
3. **Edge Functions**

   ```bash
   npx supabase functions deploy create-checkout
   npx supabase functions deploy paymongo-webhook
   npx supabase functions deploy manage-staff
   ```

4. **Secrets**

   ```bash
   npx supabase secrets set PAYMONGO_SECRET_KEY=sk_test_xxx PAYMONGO_WEBHOOK_SECRET=whsk_xxx
   ```

   To allow payments from a deployed site, also set
   `ALLOWED_ORIGINS=https://your-site.example` (comma-separated).
5. **PayMongo webhook** – point it at
   `https://<project>.supabase.co/functions/v1/paymongo-webhook` for the
   `checkout_session.payment.paid` event.
6. **First admin** – sign up normally, then in the SQL editor:
   `update profiles set role = 'admin' where email = 'you@example.com';`
   Staff accounts are then created from the admin portal.

## Request lifecycle

```
pending ──accept──▶ processing ──document released──▶ completed
   └──────reject (reason required)──────▶ rejected
```

Payment status is separate: `unpaid` → `paid` (set only by the PayMongo
webhook), or `not_required` for free services.
