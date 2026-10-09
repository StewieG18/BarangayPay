document.addEventListener("DOMContentLoaded", async () => {
    const editButton = document.getElementById("editProfileButton");
    const changePasswordButton = document.getElementById("changePasswordButton");
    const editMessage = document.getElementById("profileEditMessage");
    const logoutButton = document.getElementById("logoutButton");

    const editableFields = [
        ...document.querySelectorAll("[data-profile-key]")
    ];

    const profileKeys = {
        fullName: "full_name",
        birthdate: "birthdate",
        sex: "sex",
        contact: "phone",
        email: "email",
        street: "house_street",
        barangay: "barangay",
        city: "city",
        province: "province"
    };

    let currentUser = null;
    let originalProfile = null;
    let isEditing = false;

    function showMessage(message, isError = false) {
        if (!editMessage) return;

        editMessage.textContent = message;
        editMessage.style.color = isError ? "#b42318" : "";
    }

    function showLoadError(message) {
        showMessage(message, true);

        document.querySelectorAll("[data-profile-key]").forEach((el) => {
            if (el.textContent.trim() === "Loading...") {
                el.textContent = "Unavailable";
            }
        });

        const status = document.getElementById("profileStatus");
        if (status && status.textContent.trim() === "Loading...") {
            status.textContent = "Unknown";
        }

        editMessage?.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function displayValue(value, key) {
        if (value === null || value === undefined || value === "") {
            return "Not provided";
        }

        if (key === "sex") {
            const text = String(value);
            return text.charAt(0).toUpperCase() + text.slice(1);
        }

        if (key === "birthdate") {
            const date = new Date(`${value}T00:00:00`);

            return Number.isNaN(date.getTime())
                ? value
                : date.toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric"
                });
        }

        return String(value);
    }

    function renderProfile(profile) {
        editableFields.forEach((field) => {
            const key = field.dataset.profileKey;
            const column = profileKeys[key];

            if (column) {
                field.textContent = displayValue(profile[column], key);
            }
        });

        const avatar = document.getElementById("profileAvatar");

        if (avatar) {
            const initials = (profile.full_name || "")
                .trim()
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map(part => part[0].toUpperCase())
                .join("");

            avatar.textContent = initials || "--";
        }

        const statusElement = document.getElementById("profileStatus");

        if (statusElement) {
            statusElement.textContent =
                profile.status === "active" ? "Active" :
                profile.status === "pending" ? "Pending" :
                profile.status === "inactive" ? "Inactive" :
                "Unknown";
        }
    }

    async function loadRequestCounts() {
        const { data, error } = await supabaseClient
            .from("service_requests")
            .select("status")
            .eq("resident_id", currentUser.id);

        if (error) {
            console.error("Could not load request counts:", error);
            return;
        }

        const requests = data || [];

        const setCount = (id, count) => {
            const element = document.getElementById(id);
            if (element) element.textContent = count;
        };

        setCount("totalRequests", requests.length);
        setCount("pendingRequests",
            requests.filter(r => r.status === "pending").length);
        setCount("approvedRequests",
            requests.filter(r => r.status === "completed").length);
        setCount("rejectedRequests",
            requests.filter(r => r.status === "rejected").length);
    }

    // Wait for Supabase to restore the session before deciding to redirect.
    async function getActiveSession() {
        let { data, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        if (data.session) return data.session;

        const restored = await new Promise((resolve) => {
            let subscription = null;

            const timeout = setTimeout(() => {
                if (subscription) subscription.unsubscribe();
                resolve(null);
            }, 1500);

            const result = supabaseClient.auth.onAuthStateChange(
                (event, session) => {
                    if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
                        clearTimeout(timeout);
                        if (subscription) subscription.unsubscribe();
                        resolve(session);
                    }
                }
            );

            subscription = result.data.subscription;
        });

        if (restored) return restored;

        ({ data, error } = await supabaseClient.auth.getSession());
        if (error) throw error;
        return data.session;
    }

    // Load session and profile.
    try {
        if (typeof supabaseClient === "undefined") {
            throw new Error(
                "Supabase client is not initialized. Check ../js/supabase.js."
            );
        }

        const session = await getActiveSession();

        if (!session) {
            const keys = Object.keys(localStorage).filter(k => k.startsWith("sb-"));
            const info =
                "NO SESSION FOUND\n" +
                "Page address: " + window.location.href + "\n" +
                "Origin: " + window.location.origin + "\n" +
                "Supabase keys in storage: " + (keys.length ? keys.join(", ") : "NONE");

            console.warn(info);
            alert(info);
            // window.location.href = "../login/login.html";   // disabled for debugging
            return;
        }

        currentUser = session.user;

        const { data: profile, error: profileError } =
            await supabaseClient
                .from("profiles")
                .select("*")
                .eq("id", currentUser.id)
                .maybeSingle();

        if (profileError) {
            console.error("Profile loading failed:", profileError);
            showLoadError(`Could not load profile: ${profileError.message}`);
            return;
        }

        if (!profile) {
            console.warn("No profiles row found for user:", currentUser.id);
            showLoadError(
                "No profile found for this account, or access is blocked by database policies."
            );
            renderProfile({ email: currentUser.email });
            return;
        }

        originalProfile = { ...profile, email: profile.email || currentUser.email };
        renderProfile(originalProfile);

        await loadRequestCounts();

    } catch (error) {
        console.error("Profile initialization failed:", error);
        showLoadError(
            "Unable to load your profile. Check your connection and Supabase configuration."
        );
        return;
    }

    // Edit and save profile information.
    editButton?.addEventListener("click", async () => {
        if (!originalProfile || !currentUser) return;

        if (!isEditing) {
            editableFields.forEach((field) => {
                const key = field.dataset.profileKey;

                if (!profileKeys[key] || key === "email") return;

                field.contentEditable = "true";
                field.setAttribute("aria-label", `Edit ${key}`);
                field.classList.add("profile-field-editing");

                const value = originalProfile[profileKeys[key]];
                field.textContent = value ?? "";
            });

            isEditing = true;
            editButton.textContent = "Save Changes";

            showMessage("Edit your details, then select Save Changes.");
            return;
        }

        const updates = {};

        editableFields.forEach((field) => {
            const key = field.dataset.profileKey;
            const column = profileKeys[key];

            if (!column || key === "email") return;

            const value = field.textContent.trim();
            updates[column] = value || null;
        });

        if (
            updates.sex &&
            !["male", "female"].includes(updates.sex.toLowerCase())
        ) {
            showMessage("Sex must be Male or Female.", true);
            return;
        }

        if (updates.sex) {
            updates.sex = updates.sex.toLowerCase();
        }

        if (updates.birthdate) {
            const datePattern = /^\d{4}-\d{2}-\d{2}$/;

            if (!datePattern.test(updates.birthdate)) {
                showMessage(
                    "Enter birthdate in YYYY-MM-DD format, for example 2002-03-15.",
                    true
                );
                return;
            }

            const date = new Date(`${updates.birthdate}T00:00:00`);

            if (
                Number.isNaN(date.getTime()) ||
                date.toISOString().slice(0, 10) !== updates.birthdate
            ) {
                showMessage("Please enter a valid birthdate.", true);
                return;
            }
        }

        const { data, error } = await supabaseClient
            .from("profiles")
            .update(updates)
            .eq("id", currentUser.id)
            .select()
            .single();

        if (error) {
            console.error("Profile update failed:", error);
            showMessage(`Could not save changes: ${error.message}`, true);
            return;
        }

        originalProfile = { ...data, email: data.email || currentUser.email };
        renderProfile(originalProfile);

        editableFields.forEach((field) => {
            field.contentEditable = "false";
            field.removeAttribute("aria-label");
            field.classList.remove("profile-field-editing");
        });

        isEditing = false;
        editButton.textContent = "Edit Profile";

        showMessage("Your profile has been saved to your account.");
    });

    // Change account password.
    changePasswordButton?.addEventListener("click", async () => {
        const newPassword = window.prompt(
            "Enter a new password (at least 8 characters):"
        );

        if (newPassword === null) return;

        if (newPassword.length < 8) {
            window.alert("Your password must be at least 8 characters.");
            return;
        }

        const { error } = await supabaseClient.auth.updateUser({
            password: newPassword
        });

        if (error) {
            console.error("Password update failed:", error);
            window.alert(`Could not update password: ${error.message}`);
            return;
        }

        window.alert("Password updated successfully.");
    });

    // Log out.
    logoutButton?.addEventListener("click", async (event) => {
        event.preventDefault();

        const { error } = await supabaseClient.auth.signOut();

        if (error) {
            console.error("Sign out failed:", error);
            showMessage("Could not sign out. Please try again.", true);
            return;
        }

        window.location.href = "../login/login.html";
    });
});