const editButton = document.getElementById('editProfileButton');
const changePasswordButton = document.getElementById('changePasswordButton');
const editMessage = document.getElementById('profileEditMessage');
const editableFields = [...document.querySelectorAll('[data-profile-key]')];
const storageKey = 'barangaypay-resident-profile';

function loadProfile() {
    try {
        const savedProfile = JSON.parse(localStorage.getItem(storageKey) || '{}');

        editableFields.forEach((field) => {
            const key = field.dataset.profileKey;
            if (savedProfile[key]) field.textContent = savedProfile[key];
        });
    } catch {
        // Ignore invalid or unavailable local profile data.
    }
}

editButton.addEventListener('click', () => {
    const isEditing = editButton.dataset.editing === 'true';

    if (!isEditing) {
        editableFields.forEach((field) => {
            field.contentEditable = 'true';
            field.setAttribute('aria-label', `Edit ${field.dataset.profileKey}`);
        });
        editButton.textContent = 'Save Changes';
        editButton.dataset.editing = 'true';
        editMessage.textContent = 'Edit the highlighted details, then select Save Changes.';
        return;
    }

    const profile = {};
    editableFields.forEach((field) => {
        const key = field.dataset.profileKey;
        if (!(key in profile)) profile[key] = field.textContent.trim();
    });

    // Keep repeated full-name fields in sync.
    editableFields.forEach((field) => {
        field.textContent = profile[field.dataset.profileKey];
        field.contentEditable = 'false';
        field.removeAttribute('aria-label');
    });

    try {
        localStorage.setItem(storageKey, JSON.stringify(profile));
        editMessage.textContent = 'Profile changes saved on this device.';
    } catch {
        editMessage.textContent = 'Changes are shown on this device but could not be saved.';
    }

    editButton.textContent = 'Edit Profile';
    editButton.dataset.editing = 'false';
});

changePasswordButton.addEventListener('click', () => {
    window.alert('Password changes will be available when account services are connected.');
});

loadProfile();