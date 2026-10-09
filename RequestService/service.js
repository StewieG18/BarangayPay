(() => {
  'use strict';

  const form = document.getElementById('serviceRequestForm');
  if (!form) return;

  const BUCKET_NAME = 'service-requirements';
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  const MAX_FILES = 5;

  const SERVICE_IDS = {
    'barangay-clearance': 1,
    'certificate-residency': 2,
    'certificate-indigency': 3,
    'business-clearance': 4
  };

  const SERVICE_NAMES = {
    'barangay-clearance': 'Barangay Clearance',
    'certificate-residency': 'Certificate of Residency',
    'certificate-indigency': 'Certificate of Indigency',
    'business-clearance': 'Business Clearance'
  };

  const allowedExtensions = ['pdf', 'jpg', 'jpeg', 'png'];

  let isSubmitting = false;

  // Create a status message area.
  let statusBox = document.getElementById('serviceRequestStatus');

  if (!statusBox) {
    statusBox = document.createElement('div');
    statusBox.id = 'serviceRequestStatus';
    statusBox.setAttribute('role', 'status');
    statusBox.setAttribute('aria-live', 'polite');
    statusBox.style.cssText =
      'display:none;margin:16px 0;padding:12px 16px;' +
      'border-radius:8px;white-space:pre-wrap;';

    form.parentNode.insertBefore(statusBox, form);
  }

  function setStatus(type, message) {
    statusBox.style.display = 'block';
    statusBox.textContent = message;

    if (type === 'success') {
      statusBox.style.background = '#e8f7ed';
      statusBox.style.color = '#176534';
      statusBox.style.border = '1px solid #a8dfb8';
    } else {
      statusBox.style.background = '#fff0f0';
      statusBox.style.color = '#9c2424';
      statusBox.style.border = '1px solid #efb3b3';
    }

    statusBox.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest'
    });
  }

  function clearStatus() {
    statusBox.style.display = 'none';
    statusBox.textContent = '';
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function getValue(id) {
    return document.getElementById(id)?.value?.trim() || '';
  }

  function getSelectedService() {
    const selected = form.querySelector('input[type="radio"]:checked');
    return selected ? selected.value : '';
  }

  function getSelectedFiles() {
    return Array.from(
      document.getElementById('requirements')?.files || []
    );
  }

  function getFormDetails() {
    const serviceValue = getSelectedService();

    return {
      serviceValue,
      serviceName: SERVICE_NAMES[serviceValue] || serviceValue,
      firstName: getValue('firstName'),
      lastName: getValue('lastName'),
      middleName: getValue('middleName'),
      contactNumber: getValue('contactNumber'),
      address: getValue('address'),
      purpose: getValue('purpose'),
      preferredDate: getValue('preferredDate'),
      requestNotes: getValue('requestNotes'),
      files: getSelectedFiles()
    };
  }

  function validateForm(details) {
    const errors = [];

    if (!SERVICE_IDS[details.serviceValue]) {
      errors.push('Please select a valid service.');
    }

    if (!details.firstName) {
      errors.push('Please enter your first name.');
    }

    if (!details.lastName) {
      errors.push('Please enter your last name.');
    }

    if (!details.contactNumber) {
      errors.push('Please enter your contact number.');
    }

    if (!details.address) {
      errors.push('Please enter your address.');
    }

    if (!details.purpose) {
      errors.push('Please select the purpose of your request.');
    }

    const confirmation =
      document.getElementById('confirmInformation');

    if (!confirmation?.checked) {
      errors.push('Please confirm that your information is correct.');
    }

    if (details.files.length === 0) {
      errors.push('Please upload at least one requirement.');
    }

    if (details.files.length > MAX_FILES) {
      errors.push(`You can upload a maximum of ${MAX_FILES} files.`);
    }

    details.files.forEach(file => {
      const extension = file.name.split('.').pop().toLowerCase();

      if (!allowedExtensions.includes(extension)) {
        errors.push(
          `${file.name}: only PDF, JPG, JPEG, and PNG files are allowed.`
        );
      }

      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: the maximum file size is 5 MB.`);
      }

      if (file.size === 0) {
        errors.push(`${file.name}: the file is empty.`);
      }
    });

    return errors;
  }

  // Create a confirmation modal.
  const modalStyles = document.createElement('style');

  modalStyles.textContent = `
    .bp-confirm-overlay {
      position: fixed;
      inset: 0;
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
      background: rgba(0, 0, 0, 0.58);
    }

    .bp-confirm-overlay[hidden] {
      display: none !important;
    }

    .bp-confirm-dialog {
      width: 100%;
      max-width: 540px;
      max-height: 85vh;
      overflow-y: auto;
      padding: 24px;
      border-radius: 14px;
      background: #fff;
      color: #202020;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
    }

    .bp-confirm-dialog h2 {
      margin: 0 0 10px;
      font-size: 22px;
    }

    .bp-confirm-details {
      margin: 18px 0;
      padding: 14px;
      background: #f5f7fa;
      border-radius: 8px;
      overflow-wrap: anywhere;
    }

    .bp-confirm-details p {
      margin: 8px 0;
    }

    .bp-confirm-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 20px;
    }

    .bp-confirm-actions button {
      border: 0;
      border-radius: 8px;
      padding: 11px 16px;
      cursor: pointer;
      font: inherit;
    }

    .bp-confirm-actions button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    #bpCancelSubmit {
      background: #e8e8e8;
      color: #222;
    }

    #bpConfirmSubmit {
      background: #176b45;
      color: white;
    }
  `;

  document.head.appendChild(modalStyles);

  // Remove any old modal created by the previous service.js.
  document.getElementById('confirmModal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'confirmModal';
  modal.className = 'bp-confirm-overlay';
  modal.hidden = true;

  modal.innerHTML = `
    <section
      class="bp-confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bpConfirmTitle"
    >
      <h2 id="bpConfirmTitle">Confirm Service Request</h2>
      <p>Please review your information before submitting.</p>

      <div class="bp-confirm-details" id="bpConfirmDetails"></div>

      <p>
        By confirming, you agree to submit this information
        to BarangayPay for processing.
      </p>

      <div class="bp-confirm-actions">
        <button type="button" id="bpCancelSubmit">
          Go Back
        </button>
        <button type="button" id="bpConfirmSubmit">
          Confirm &amp; Submit
        </button>
      </div>
    </section>
  `;

  document.body.appendChild(modal);

  const detailsBox = modal.querySelector('#bpConfirmDetails');
  const confirmButton = modal.querySelector('#bpConfirmSubmit');
  const cancelButton = modal.querySelector('#bpCancelSubmit');

  function closeModal() {
    modal.hidden = true;
  }

  function openModal(details) {
    const fullName = [
      details.firstName,
      details.middleName,
      details.lastName
    ].filter(Boolean).join(' ');

    detailsBox.innerHTML = `
      <p><strong>Service:</strong> ${escapeHTML(details.serviceName)}</p>
      <p><strong>Name:</strong> ${escapeHTML(fullName)}</p>
      <p><strong>Contact:</strong> ${escapeHTML(details.contactNumber)}</p>
      <p><strong>Address:</strong> ${escapeHTML(details.address)}</p>
      <p><strong>Purpose:</strong> ${escapeHTML(details.purpose)}</p>
      <p><strong>Preferred date:</strong>
        ${escapeHTML(details.preferredDate || 'Not specified')}
      </p>
      <p><strong>Notes:</strong>
        ${escapeHTML(details.requestNotes || 'None')}
      </p>
      <p><strong>Requirements:</strong>
        ${details.files.map(file => escapeHTML(file.name)).join(', ')}
      </p>
    `;

    clearStatus();
    modal.hidden = false;
    cancelButton.focus();
  }

  cancelButton.addEventListener('click', closeModal);

  modal.addEventListener('click', event => {
    if (event.target === modal) closeModal();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modal.hidden && !isSubmitting) {
      closeModal();
    }
  });

  // Preserve service selection from links such as
  // service.html?service=barangay-clearance.
  const params = new URLSearchParams(window.location.search);
  const requestedService = params.get('service');

  if (requestedService && SERVICE_IDS[requestedService]) {
    const radio = Array.from(
      form.querySelectorAll('input[type="radio"]')
    ).find(input => input.value === requestedService);

    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // Validate first; do not send anything until the resident confirms.
  form.addEventListener('submit', event => {
    event.preventDefault();

    if (isSubmitting) return;

    const details = getFormDetails();
    const errors = validateForm(details);

    if (errors.length) {
      setStatus('error', errors.join('\n'));
      return;
    }

    openModal(details);
  });

  function generateRequestCode() {
    const randomPart = (
      window.crypto?.randomUUID?.() ||
      Math.random().toString(36).slice(2) +
      Math.random().toString(36).slice(2)
    ).replace(/-/g, '').slice(0, 8).toUpperCase();

    return `BP-${Date.now()}-${randomPart}`;
  }

  function getContentType(file) {
    const extension = file.name.split('.').pop().toLowerCase();

    const contentTypes = {
      pdf: 'application/pdf',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png'
    };

    return contentTypes[extension] || file.type;
  }

  function safeFileName(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  confirmButton.addEventListener('click', async () => {
    if (isSubmitting) return;

    const details = getFormDetails();
    const errors = validateForm(details);

    if (errors.length) {
      closeModal();
      setStatus('error', errors.join('\n'));
      return;
    }

    const client = window.supabaseClient;

    if (!client) {
      closeModal();
      setStatus(
        'error',
        'Supabase is not initialized. Check the script tags in service.html and your js/supabase.js file.'
      );
      return;
    }

    isSubmitting = true;
    confirmButton.disabled = true;
    cancelButton.disabled = true;
    confirmButton.textContent = 'Submitting...';

    const uploadedPaths = [];

    try {
      // 1. Confirm that the resident is logged in.
      const {
        data: { user },
        error: authError
      } = await client.auth.getUser();

      if (authError) throw authError;

      if (!user) {
        throw new Error(
          'You must log in before submitting a service request. Please log in and try again.'
        );
      }

      const requestCode = generateRequestCode();

      // 2. Upload the files to the private Storage bucket.
      for (let index = 0; index < details.files.length; index++) {
        const file = details.files[index];

        const uniqueName =
          `${Date.now()}-${index}-${safeFileName(file.name)}`;

        // The first folder must be the authenticated user's UUID.
        const storagePath =
          `${user.id}/${requestCode}/${uniqueName}`;

        const { error: uploadError } = await client.storage
          .from(BUCKET_NAME)
          .upload(storagePath, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: getContentType(file)
          });

        if (uploadError) {
          throw new Error(
            `Could not upload "${file.name}": ${uploadError.message}`
          );
        }

        uploadedPaths.push(storagePath);
      }

      // 3. Save the form's extra details in remarks because
      //    the current service_requests schema has no separate
      //    columns for name, contact, purpose, or file paths.
      const fullName = [
        details.firstName,
        details.middleName,
        details.lastName
      ].filter(Boolean).join(' ');

      const remarks = [
        `Resident name: ${fullName}`,
        `Contact number: ${details.contactNumber}`,
        `Address: ${details.address}`,
        `Purpose: ${details.purpose}`,
        `Preferred date: ${details.preferredDate || 'Not specified'}`,
        `Additional notes: ${details.requestNotes || 'None'}`,
        '',
        'Uploaded requirement paths:',
        ...uploadedPaths.map(path => `- ${path}`)
      ].join('\n');

      // 4. Insert the request into Supabase.
      // submitted_at and updated_at use their database defaults.
      const { error: insertError } = await client
        .from('service_requests')
        .insert({
          request_code: requestCode,
          resident_id: user.id,
          service_id: SERVICE_IDS[details.serviceValue],
          status: 'pending',
          payment_status: 'unpaid',
          remarks: remarks
        });

      if (insertError) throw insertError;

      // 5. The request was saved successfully.
      closeModal();
      form.reset();

      setStatus(
        'success',
        `Your service request was submitted successfully!\n` +
        `Request code: ${requestCode}\n` +
        `Status: Pending\n` +
        `Payment: Unpaid`
      );

    } catch (error) {
      // If upload or database insertion fails, try to remove
      // any files uploaded for this unsuccessful request.
      if (uploadedPaths.length > 0) {
        try {
          await client.storage
            .from(BUCKET_NAME)
            .remove(uploadedPaths);
        } catch (cleanupError) {
          console.error('Storage cleanup failed:', cleanupError);
        }
      }

      closeModal();

      console.error('Service request submission failed:', error);

      const message = error?.message || 'An unexpected error occurred.';

      setStatus(
        'error',
        `Your request could not be submitted.\n${message}\n\n` +
        'Please check your login, Supabase policies, bucket settings, and database schema before trying again.'
      );

    } finally {
      isSubmitting = false;
      confirmButton.disabled = false;
      cancelButton.disabled = false;
      confirmButton.textContent = 'Confirm & Submit';
    }
  });

})();