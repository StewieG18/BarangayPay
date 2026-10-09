const SUPABASE_URL = "https://adomcjxbuumzzxskaxfl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_isXJbey2kK-BIBZ4LBfbeA_UH7L28KH";

window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

console.log("BarangayPay connected to Supabase.");