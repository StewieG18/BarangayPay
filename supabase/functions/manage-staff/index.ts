import { createClient } from "npm:@supabase/supabase-js@2";

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^(09|\+639)\d{9}$/;
const NAME_RE = /^\p{L}[\p{L} .'-]*$/u;
const BAN_FOREVER = "876000h"; // about 100 years

const clean = (value: unknown) => String(value ?? "").trim();

function validateName(label: string, value: string): string | null {
  if (value.length < 2 || value.length > 50) {
    return `${label} must be 2 to 50 characters.`;
  }
  if (!NAME_RE.test(value)) {
    return `${label} may only contain letters, spaces, periods, hyphens and apostrophes.`;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceKey) {
      console.error("Missing environment variables.");
      return json({ error: "The staff service is not configured." }, 500);
    }

    // 1. Who is calling?
    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: { Authorization: req.headers.get("Authorization") ?? "" },
      },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return json({ error: "Please log in again." }, 401);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 2. Only an active administrator may continue.
    const { data: me, error: meError } = await admin
      .from("profiles")
      .select("role, status")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (meError) {
      console.error("Could not check the caller:", meError);
      return json({ error: "Could not verify your account." }, 500);
    }

    if (!me || me.role !== "admin" || me.status !== "active") {
      return json({ error: "Only an administrator can manage staff." }, 403);
    }

    // 3. Read the request
    const body = await req.json().catch(() => ({}));
    const action = clean(body.action);

    const firstName = clean(body.firstName);
    const lastName = clean(body.lastName);
    const phone = clean(body.phone).replace(/[\s-]/g, "");
    const status = body.status === "inactive" ? "inactive" : "active";

    if (action !== "create" && action !== "update") {
      return json({ error: "Unknown action." }, 400);
    }

    const fieldError =
      validateName("First name", firstName) ??
      validateName("Last name", lastName) ??
      (phone && !PHONE_RE.test(phone)
        ? "Enter a valid mobile number, e.g. 09171234567."
        : null);

    if (fieldError) return json({ error: fieldError }, 400);

    const fullName = `${firstName} ${lastName}`;

    // ---------- CREATE ----------
    if (action === "create") {
      const email = clean(body.email).toLowerCase();
      const password = String(body.password ?? "");

      if (!EMAIL_RE.test(email)) {
        return json({ error: "Enter a valid email address." }, 400);
      }
      if (password.length < 8) {
        return json({ error: "The temporary password must be at least 8 characters." }, 400);
      }

      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName, phone: phone || null },
        });

      if (createError || !created?.user) {
        const message = createError?.message ?? "Could not create the account.";
        const duplicate = /already|registered|exists/i.test(message);
        return json(
          { error: duplicate ? "An account with this email already exists." : message },
          duplicate ? 409 : 400,
        );
      }

      const staffId = created.user.id;

      // The sign-up trigger created a resident profile. Promote it to staff.
      const { error: profileError } = await admin
        .from("profiles")
        .update({
          role: "staff",
          status,
          full_name: fullName,
          phone: phone || null,
        })
        .eq("id", staffId);

      if (profileError) {
        console.error("Could not set up the staff profile:", profileError);
        await admin.auth.admin.deleteUser(staffId); // avoid a leftover resident account
        return json({ error: "Could not set up the staff profile." }, 500);
      }

      if (status === "inactive") {
        await admin.auth.admin.updateUserById(staffId, { ban_duration: BAN_FOREVER });
      }

      return json(
        { staff: { id: staffId, email, full_name: fullName, phone: phone || null, status } },
        201,
      );
    }

    // ---------- UPDATE ----------
    const userId = clean(body.userId);
    const newPassword = String(body.newPassword ?? "");

    if (!userId) return json({ error: "Missing staff id." }, 400);
    if (newPassword && newPassword.length < 8) {
      return json({ error: "The new password must be at least 8 characters." }, 400);
    }

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id, email, role")
      .eq("id", userId)
      .maybeSingle();

    if (targetError) {
      console.error("Could not load the staff member:", targetError);
      return json({ error: "Could not load the staff account." }, 500);
    }

    // Only staff accounts can be edited here, never residents or admins.
    if (!target || target.role !== "staff") {
      return json({ error: "Staff account not found." }, 404);
    }

    const authChanges: Record<string, unknown> = {
      ban_duration: status === "inactive" ? BAN_FOREVER : "none",
    };
    if (newPassword) authChanges.password = newPassword;

    const { error: authError } = await admin.auth.admin.updateUserById(
      userId,
      authChanges,
    );

    if (authError) {
      console.error("Could not update the login:", authError);
      return json({ error: authError.message }, 400);
    }

    const { error: updateError } = await admin
      .from("profiles")
      .update({ full_name: fullName, phone: phone || null, status })
      .eq("id", userId);

    if (updateError) {
      console.error("Could not update the profile:", updateError);
      return json({ error: "Could not save the changes." }, 500);
    }

    return json({
      staff: {
        id: userId,
        email: target.email,
        full_name: fullName,
        phone: phone || null,
        status,
      },
    });
  } catch (error) {
    console.error("manage-staff failed:", error);
    return json({ error: "Something went wrong." }, 500);
  }
});