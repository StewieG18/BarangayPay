import { createClient } from "npm:@supabase/supabase-js@2";

// Site addresses allowed to receive the customer back after payment.
// Add your own if Live Server uses a different port.
const ALLOWED_ORIGINS = [
  "http://127.0.0.1:5500",
  "http://localhost:5500",
];

// Methods shown on PayMongo's page. They must be enabled in your PayMongo dashboard.
const PAYMENT_METHODS = ["card", "gcash", "qrph"];

const SERVICE_NAMES: Record<string, string> = {
  "barangay-clearance": "Barangay Clearance",
  "certificate-residency": "Certificate of Residency",
  "certificate-indigency": "Certificate of Indigency",
  "business-clearance": "Barangay Business Clearance",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    const secretKey = Deno.env.get("PAYMONGO_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!secretKey || !supabaseUrl || !anonKey || !serviceKey) {
      console.error("Missing environment variables.");
      return json({ error: "The payment service is not configured." }, 500);
    }

    // 1. Who is calling? (the logged-in resident)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: { Authorization: req.headers.get("Authorization") ?? "" },
      },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return json({ error: "Please log in again." }, 401);
    }
    const user = userData.user;

    // 2. Read and check the input
    const body = await req.json().catch(() => ({}));
    const requestId = body?.requestId;
    const origin = String(body?.origin ?? "");

    if (!requestId) return json({ error: "Missing request id." }, 400);

    if (!ALLOWED_ORIGINS.includes(origin)) {
      return json(
        { error: `This site address (${origin}) is not allowed to start a payment.` },
        400,
      );
    }

    // 3. Load the request. Row-level security limits this to the resident's own rows.
    const { data: row, error: rowError } = await userClient
      .from("service_requests")
      .select("id, request_code, service, amount, payment_status, resident_id")
      .eq("id", requestId)
      .maybeSingle();

    if (rowError) {
      console.error("Could not load the request:", rowError);
      return json({ error: "Could not load the request." }, 500);
    }

    if (!row || row.resident_id !== user.id) {
      return json({ error: "Request not found." }, 404);
    }

    if (!["unpaid", "failed"].includes(row.payment_status)) {
      return json({ error: "This request does not need a payment." }, 400);
    }

    // The amount always comes from the database, never from the browser.
    const centavos = Math.round(Number(row.amount) * 100);
    if (!Number.isInteger(centavos) || centavos <= 0) {
      return json({ error: "This request has no amount to pay." }, 400);
    }

    const pageUrl =
      `${origin}/Payment/payment.html?request=${encodeURIComponent(String(row.id))}`;

    // 4. Create the PayMongo checkout session
    const response = await fetch("https://api.paymongo.com/v2/checkout_sessions", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${secretKey}:`)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: [
              {
                name: SERVICE_NAMES[row.service] ?? "Barangay service",
                amount: centavos,
                currency: "PHP",
                quantity: 1,
              },
            ],
            payment_method_types: PAYMENT_METHODS,
            success_url: `${pageUrl}&status=success`,
            cancel_url: `${pageUrl}&status=cancelled`,
            reference_number: row.request_code,
            metadata: {
              request_id: String(row.id),
              request_code: String(row.request_code),
            },
          },
        },
      }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.data?.attributes?.checkout_url) {
      console.error("PayMongo error:", response.status, JSON.stringify(payload));
      const detail = payload?.errors?.[0]?.detail;
      return json({ error: detail ?? "PayMongo could not create the checkout." }, 502);
    }

    // 5. Remember which session belongs to this request
    const admin = createClient(supabaseUrl, serviceKey);
    const { error: saveError } = await admin
      .from("service_requests")
      .update({ paymongo_session_id: payload.data.id })
      .eq("id", row.id);

    if (saveError) console.error("Could not save the session id:", saveError);

    return json({ checkout_url: payload.data.attributes.checkout_url });
  } catch (error) {
    console.error("create-checkout failed:", error);
    return json({ error: "Something went wrong creating the payment." }, 500);
  }
});