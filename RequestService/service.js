(() => {
  'use strict';

  const form = document.getElementById('serviceRequestForm');
  if (!form) return;

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

  const FEES = {
    'barangay-clearance': 50,
    'certificate-residency': 50,
    'certificate-indigency': 0,
    'business-clearance': 350
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

    const confirmation = document.getElementById('confirmInformation');

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

  function safeFileName(name) {
    return name.replace(/[^A-Za-z0-9._-]/g, '_');
  }

  // Step 2: the user confirmed. Save the request, then go to payment.
  confirmButton.addEventListener('click', async () => {
    if (isSubmitting) return;

    const details = getFormDetails();
    const errors = validateForm(details);

    if (errors.length) {
      closeModal();
      setStatus('error', errors.join('\n'));
      return;
    }

    isSubmitting = true;
    confirmButton.disabled = true;
    confirmButton.textContent = 'Saving request...';

    const uploaded = [];

    try {
      if (typeof supabaseClient === 'undefined') {
        throw new Error('Supabase is not initialized. Check the script tags in service.html and your js/supabase.js file.');
      }

      const client = supabaseClient;;

      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;

      const user = sessionData.session?.user;
      if (!user) {
        window.location.href = '../login/login.html';
        return;
      }

      const serviceValue = getSelectedService();
      const amount = FEES[serviceValue] ?? 0;

      // Upload documents first: <user id>/<random folder>/<file>
      const folder = `${user.id}/${window.crypto.randomUUID()}`;
      const files = details.files;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const path = `${folder}/${i + 1}-${safeFileName(file.name)}`;
        const { error } = await client.storage
          .from('request-documents')
          .upload(path, file, { contentType: file.type });
        if (error) throw error;
        uploaded.push(path);
      }

      const { data, error: insertError } = await client
        .from('service_requests')
        .insert({
          resident_id: user.id,
          service: SERVICE_NAMES[serviceValue],
          service_id: SERVICE_IDS[serviceValue],
          first_name: details.firstName,
          middle_name: details.middleName || null,
          last_name: details.lastName,
          contact_number: details.contactNumber,
          address: details.address,
          purpose: details.purpose,
          preferred_date: details.preferredDate || null,
          notes: details.requestNotes || null,
          document_paths: uploaded,
          amount: amount,
          payment_status: amount > 0 ? 'unpaid' : 'not_required',
          status: 'pending'
        })
        .select('id')
        .single();

      if (insertError) throw insertError;

      window.location.href = `../Payment/payment.html?request=${encodeURIComponent(data.id)}`;

    } catch (err) {
      console.error('Saving the request failed:', err);

      if (uploaded.length && typeof supabaseClient !== 'undefined') {
        try {
          await supabaseClient.storage.from('request-documents').remove(uploaded);
        } catch (cleanupError) {
          console.error('Storage cleanup failed:', cleanupError);
        }
      }

      closeModal();
      setStatus('error', `Could not save your request: ${err.message}`);
      isSubmitting = false;
      confirmButton.disabled = false;
      confirmButton.textContent = 'Confirm & Submit';
    }
  });

})();