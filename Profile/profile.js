/* Resident profile: show, edit and save profile details. */
document.addEventListener("DOMContentLoaded", async () => {
    "use strict";

    const editButton = document.getElementById("editProfileButton");
    const changePasswordButton = document.getElementById("changePasswordButton");
    const editMessage = document.getElementById("profileEditMessage");
    const logoutButton = document.getElementById("logoutButton");

    const PROFILE_KEYS = {
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

    const PHONE_RE = /^(09|\+639)\d{9}$/;
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const SEXES = ["male", "female"];

    const displayFields = [...document.querySelectorAll("[data-profile-key]")];

    // Only one editable element per key, and never headings (the name is
    // shown twice on the page; editing both made the result unpredictable).
    const editableFields = displayFields.filter((field, index) => {
        const key = field.dataset.profileKey;
        if (!PROFILE_KEYS[key] || key === "email" || field.tagName === "H2") return false;
        return displayFields.findIndex((other) =>
            other.dataset.profileKey === key && other.tagName !== "H2") === index;
    });

    let currentUser = null;
    let originalProfile = null;
    let isEditing = false;
    let isSaving = false;

    function showMessage(message, isError = false) {
        if (!editMessage) return;
        editMessage.textContent = message;
        editMessage.style.color = isError ? "#b42318" : "";
    }

    function showLoadError(message) {
        showMessage(message, true);

        displayFields.forEach((el) => {
            if (el.textContent.trim() === "Loading...") el.textContent = "Unavailable";
        });

        const status = document.getElementById("profileStatus");
        if (status && status.textContent.trim() === "Loading...") status.textContent = "Unknown";
    }

    function displayValue(value, key) {
        if (value === null || value === undefined || value === "") return "Not provided";

        if (key === "sex") return BP.capitalize(value);

        if (key === "birthdate") {
            const date = new Date(`${value}T00:00:00`);
            return Number.isNaN(date.getTime())
                ? value
                : date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
        }

        return String(value);
    }

    function renderProfile(profile) {
        displayFields.forEach((field) => {
            const key = field.dataset.profileKey;
            const column = PROFILE_KEYS[key];
            if (column) field.textContent = displayValue(profile[column], key);
        });

        const avatar = document.getElementById("profileAvatar");
        if (avatar) avatar.textContent = BP.initials(profile.full_name) || "--";

        const statusElement = document.getElementById("profileStatus");
        if (statusElement) {
            const labels = { active: "Active", pending: "Pending", inactive: "Inactive" };
            statusElement.textContent = labels[profile.status] || "Unknown";
        }
    }

    async function loadRequestCounts() {
        const { data, error } = await BP.getClient()
            .from("service_requests")
            .select("status")
            .eq("resident_id", currentUser.id);

        if (error) {
            console.error("Could not load request counts:", error);
            return;
        }

        const requests = data || [];
        const count = (status) => requests.filter((r) => r.status === status).length;
        const setCount = (id, value) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        };

        setCount("totalRequests", requests.length);
        setCount("pendingRequests", count("pending"));
        setCount("approvedRequests", count("completed"));
        setCount("rejectedRequests", count("rejected"));
    }

    // Returns { updates } or { error } for the values typed into the page.
    function collectUpdates() {
        const updates = Object.fromEntries(
            editableFields.map((field) => [
                PROFILE_KEYS[field.dataset.profileKey],
                field.textContent.trim() || null
            ])
        );

        if (!updates.full_name || updates.full_name.length < 2) {
            return { error: "Please enter your full name." };
        }

        if (updates.sex) {
            const sex = updates.sex.toLowerCase();
            if (!SEXES.includes(sex)) return { error: "Sex must be Male or Female." };
            updates.sex = sex;
        }

        if (updates.phone) {
            const phone = updates.phone.replace(/[\s-]/g, "");
            if (!PHONE_RE.test(phone)) {
                return { error: "Enter a valid mobile number, e.g. 09171234567." };
            }
            updates.phone = phone;
        }

        if (updates.birthdate) {
            if (!DATE_RE.test(updates.birthdate)) {
                return { error: "Enter birthdate in YYYY-MM-DD format, for example 2002-03-15." };
            }
            const date = new Date(`${updates.birthdate}T00:00:00Z`);
            if (Number.isNaN(date.getTime()) ||
                date.toISOString().slice(0, 10) !== updates.birthdate ||
                date > new Date()) {
                return { error: "Please enter a valid birthdate." };
            }
        }

        return { updates };
    }

    function setEditing(editing) {
        isEditing = editing;

        editableFields.forEach((field) => {
            field.contentEditable = editing ? "true" : "false";
            field.classList.toggle("profile-field-editing", editing);
            if (editing) {
                field.setAttribute("aria-label", `Edit ${field.dataset.profileKey}`);
                field.textContent = originalProfile[PROFILE_KEYS[field.dataset.profileKey]] ?? "";
            } else {
                field.removeAttribute("aria-label");
            }
        });

        editButton.textContent = editing ? "Save Changes" : "Edit Profile";
    }

    async function saveProfile() {
        const { updates, error: validationError } = collectUpdates();
        if (validationError) {
            showMessage(validationError, true);
            return;
        }

        isSaving = true;
        editButton.disabled = true;

        try {
            const { data, error } = await BP.getClient()
                .from("profiles")
                .update(updates)
                .eq("id", currentUser.id)
                .select()
                .single();

            if (error) throw error;

            originalProfile = { ...data, email: data.email || currentUser.email };
            setEditing(false);
            renderProfile(originalProfile);
            showMessage("Your profile has been saved to your account.");
        } catch (error) {
            console.error("Profile update failed:", error);
            showMessage(`Could not save changes: ${error.message}`, true);
        } finally {
            isSaving = false;
            editButton.disabled = false;
        }
    }

    // Buttons that do not depend on the profile loading.
    changePasswordButton?.addEventListener("click", () => {
        BPPassword.openDialog(() => showMessage("Password updated successfully."));
    });

    logoutButton?.addEventListener("click", () => BP.signOut());

    try {
        const auth = await BP.initPortal("resident");
        if (!auth) return; // redirecting

        currentUser = auth.user;
        originalProfile = auth.profile;
        renderProfile(originalProfile);

        await loadRequestCounts();
    } catch (error) {
        console.error("Profile initialization failed:", error);
        showLoadError("Unable to load your profile. Check your connection and try again.");
        return;
    }

    editButton?.addEventListener("click", () => {
        if (!originalProfile || isSaving) return;

        if (!isEditing) {
            setEditing(true);
            showMessage("Edit your details, then select Save Changes. Birthdate uses YYYY-MM-DD.");
            return;
        }

        saveProfile();
    });
});
