
document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("loginForm");
    const errorMessage = document.getElementById("errorMessage");

    if (!form) {
        console.error("Login form not found. Check the form ID in login.html.");
        return;
    }

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
                throw new Error(
                    "Your profile was not found. Please contact the administrator."
                );
            }

            if (profile.status !== "active") {
                await supabaseClient.auth.signOut();
                throw new Error("Your account is inactive. Please contact the administrator.");
            }

            switch (profile.role) {
                case "resident":
                    window.location.href = "../index.html";
                    break;

                case "staff":
                    window.location.href = "../StaffPage/staff.html";
                    break;

                case "admin":
                    window.location.href = "../Admin/admin.html";
                    break;

                default:
                    await supabaseClient.auth.signOut();
                    throw new Error("Your account has an unrecognized role.");
            }
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
