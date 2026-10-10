import { createClient } from "npm:@supabase/supabase-js@2";

const METHOD_NAMES: Record<string, string> = {
  gcash: "GCash",
  paymaya: "Maya",
  maya: "Maya",
  card: "Card",
  grab_pay: "GrabPay",
  qrph: "QR Ph",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Header looks like: t=1496734173,te=<test signature>,li=<live signature>
async function isValidSignature(
  rawBody: string,
  header: string,
  secret: string,
): Promise<boolean> {
  const parts: Record<string, string> = {};
  for (const piece of header.split(",")) {
    const i = piece.indexOf("=");
    if (i > 0) parts[piece.slice(0, i).trim()] = piece.slice(i + 1).trim();
  }

  if (!parts.t) return false;

  const expected = await hmacHex(secret, `${parts.t}.${rawBody}`);

  // Test events carry the signature in "te", live events in "li".
  return [parts.te, parts.li].some((sig) => sig && safeEqual(sig, expected));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const webhookSecret = Deno.env.get("PAYMONGO_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!webhookSecret || !supabaseUrl || !serviceKey) {
    console.error("Missing environment variables.");
    return json({ error: "Webhook is not configured." }, 500);
  }

  // Verify against the RAW body, before any JSON parsing.
  const rawBody = await req.text();
  const header = req.headers.get("Paymongo-Signature") ?? "";

  if (!(await isValidSignature(rawBody, header, webhookSecret))) {
    console.warn("Rejected a webhook with an invalid signature.");
    return json({ error: "Invalid signature." }, 401);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ received: true, ignored: "invalid json" });
  }

  const eventData = event?.data;
  const eventType = eventData?.attributes?.type ?? eventData?.type;

  // Acknowledge (2xx) events we don't use, so PayMongo doesn't retry them.
  if (eventType !== "checkout_session.payment.paid") {
    console.log("Ignored event type:", eventType);
    return json({ received: true, ignored: eventType ?? "unknown" });
  }

  const session = eventData?.attributes?.data ?? eventData?.data;
  const attrs = session?.attributes ?? {};
  const requestId = attrs.metadata?.request_id;
  const requestCode = attrs.reference_number ?? attrs.metadata?.request_code;

  if (!requestId) {
    console.warn("Paid event without a request id in metadata.");
    return json({ received: true, ignored: "no request id" });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: row, error: rowError } = await admin
    .from("service_requests")
    .select("id, request_code, payment_status")
    .eq("id", requestId)
    .maybeSingle();

  if (rowError) {
    console.error("Could not load the request:", rowError);
    return json({ error: "Database error." }, 500); // PayMongo will retry
  }

  if (!row) {
    console.warn("No request found for id:", requestId);
    return json({ received: true, ignored: "request not found" });
  }

  if (requestCode && row.request_code !== requestCode) {
    console.warn("Request code mismatch for id:", requestId);
    return json({ received: true, ignored: "code mismatch" });
  }

  // Duplicate delivery: already recorded, nothing more to do.
  if (row.payment_status === "paid") {
    return json({ received: true, duplicate: true });
  }

  const payment = attrs.payments?.[0];
  const rawMethod = String(
    attrs.payment_method_used ?? payment?.attributes?.source?.type ?? "PayMongo",
  );
  const reference = String(payment?.id ?? session?.id ?? eventData?.id ?? "");

  const { error: updateError } = await admin
    .from("service_requests")
    .update({
      payment_status: "paid",
      payment_method: METHOD_NAMES[rawMethod] ?? rawMethod,
      payment_reference: reference || null,
      paid_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .neq("payment_status", "paid");

  if (updateError) {
    console.error("Could not mark the request as paid:", updateError);
    return json({ error: "Database error." }, 500); // PayMongo will retry
  }

  console.log("Marked request as paid:", row.id);
  return json({ received: true, paid: true });
});