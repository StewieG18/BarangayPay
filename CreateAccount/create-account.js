document.addEventListener("DOMContentLoaded", function () {
    const form = document.getElementById("registerForm");
    const errorMessage = document.getElementById("errorMessage");

    form.addEventListener("submit", async function (event) {
        event.preventDefault();

        errorMessage.textContent = "";

        const fullName = document.getElementById("fullName").value.trim();
        const email = document.getElementById("email").value.trim();
        const mobile = document.getElementById("mobile").value.trim();
        const birthdate = document.getElementById("birthdate").value;
        const sex = document.getElementById("sex").value;
        const houseStreet = document.getElementById("houseStreet").value.trim();
        const barangay = document.getElementById("barangay").value.trim();
        const city = document.getElementById("city").value.trim();
        const province = document.getElementById("province").value.trim();
        const password = document.getElementById("password").value;
        const confirmPassword = document.getElementById("confirmPassword").value;
        const terms = document.getElementById("terms").checked;

        if (!fullName || !email || !mobile || !birthdate || !sex ||
            !houseStreet || !barangay || !city || !province) {
            errorMessage.textContent = "Please complete all required fields.";
            return;
        }

        const normalizedMobile = mobile.replace(/[\s-]/g, "");

        if (!/^(09|\+639)\d{9}$/.test(normalizedMobile)) {
            errorMessage.textContent =
                "Enter a valid mobile number, e.g. 09171234567.";
            return;
        }

        if (new Date(`${birthdate}T00:00:00`) > new Date()) {
            errorMessage.textContent = "Birthdate cannot be in the future.";
            return;
        }

        const strongPassword =
            password.length >= 8 &&
            /[A-Z]/.test(password) &&
            /[a-z]/.test(password) &&
            /[0-9]/.test(password) &&
            /[^A-Za-z0-9]/.test(password);

        if (!strongPassword) {
            errorMessage.textContent =
                "Please create a strong password that meets all requirements.";
            return;
        }

        if (password !== confirmPassword) {
            errorMessage.textContent = "Passwords do not match.";
            return;
        }

        if (!terms) {
            errorMessage.textContent =
                "Please agree to the Terms and Conditions and Privacy Policy.";
            return;
        }

        const address = `${houseStreet}, ${barangay}, ${city}, ${province}`;

        try {
            const { data, error } = await supabaseClient.auth.signUp({
                email: email,
                password: password,

                options: {
                    data: {
                        full_name: fullName,
                        phone: normalizedMobile,
                        birthdate: birthdate,
                        sex: sex,
                        house_street: houseStreet,
                        barangay: barangay,
                        city: city,
                        province: province,
                        address: address
                    }
                }
            });

            if (error) {
                console.error("Signup error:", error);
                errorMessage.textContent = error.message;
                return;
            }

            // Supabase hides duplicate sign-ups behind a user with no identities.
            if (data.user && Array.isArray(data.user.identities) &&
                data.user.identities.length === 0) {
                errorMessage.textContent =
                    "An account with this email already exists. Please sign in instead.";
                return;
            }

            // If email confirmation is off, signUp starts a session; end it so
            // the resident signs in through the normal login flow.
            if (data.session) {
                await supabaseClient.auth.signOut();
            }

            alert(
                "Account created successfully! Please check your email to verify your account."
            );

            window.location.href = "../login/login.html";

        } catch (error) {
            console.error("Unexpected error:", error);

            errorMessage.textContent =
                "Something went wrong while creating your account. Please try again.";
        }
    });
});