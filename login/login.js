
document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("loginForm");
    const errorMessage = document.getElementById("errorMessage");

    if (!form) {
        console.error("Login form not found. Check the form ID in login.html.");
        return;
    }

    const HOME_BY_ROLE = {
        resident: "../index.html",
        staff: "../Staff/StaffPage/staff.html",
        admin: "../Admin/admin.html"
    };

    // Already signed in with an active account: go straight to that portal.
    (async () => {
        try {
            const { data } = await supabaseClient.auth.getSession();
            const user = data?.session?.user;
            if (!user) return;

            const { data: profile } = await supabaseClient
                .from("profiles")
                .select("role, status")
                .eq("id", user.id)
                .maybeSingle();

            if (profile?.status === "active" && HOME_BY_ROLE[profile.role]) {
                window.location.replace(HOME_BY_ROLE[profile.role]);
            }
        } catch (sessionError) {
            console.warn("Could not check the existing session:", sessionError);
        }
    })();

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (errorMessage) errorMessage.textContent = "";

        const email = document.getElementById("email")?.value.trim();
        const password = document.getElementById("password")?.value;

        if (!email || !password) {
            if (errorMessage) {
                errorMessage.textContent = "Enter your email and password.";
            } else {
                alert("Enter your email and password.");
            }
            return;
        }

        const button = form.querySelector('[type="submit"]');
        if (button) button.disabled = true;

        try {
            if (!window.supabase || typeof supabaseClient === "undefined") {
                throw new Error("Supabase is not loaded. Check your script paths.");
            }

            const { data, error } =
                await supabaseClient.auth.signInWithPassword({
                    email,
                    password
                });

            if (error) throw error;

            const user = data.user;

            const { data: profile, error: profileError } =
                await supabaseClient
                    .from("profiles")
                    .select("role, status")
                    .eq("id", user.id)
                    .single();

            if (profileError || !profile) {
                await supabaseClient.auth.signOut();
                throw new Error(
                    "Your profile was not found. Please contact the administrator."
                );
            }

            if (profile.status !== "active") {
                await supabaseClient.auth.signOut();
                throw new Error("Your account is inactive. Please contact the administrator.");
            }

            const home = HOME_BY_ROLE[profile.role];

            if (!home) {
                await supabaseClient.auth.signOut();
                throw new Error("Your account has an unrecognized role.");
            }

            window.location.href = home;
        } catch (error) {
            console.error("Login error:", error);

            if (errorMessage) {
                errorMessage.textContent = error.message ||
                    "Sign in failed. Please try again.";
            } else {
                alert(error.message || "Sign in failed. Please try again.");
            }
        } finally {
            if (button) button.disabled = false;
        }
    });
});
