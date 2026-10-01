/* Request a Service - client-side validation.
   The same rules are re-checked on the server in submit_request.php. */
(() => {
    'use strict';

    const form = document.getElementById('serviceRequestForm');
    if (!form) return;

    const SERVICES = ['barangay-clearance', 'certificate-residency', 'certificate-indigency', 'business-clearance'];
    const PURPOSES = ['employment', 'school', 'business', 'government', 'personal', 'other'];
    const NAME_RE  = /^\p{L}[\p{L} .'-]*$/u;
    const PHONE_RE = /^(09|\+639)\d{9}$/;
    const FILE = { exts: ['pdf', 'jpg', 'jpeg', 'png'], maxMB: 5, maxFiles: 5 };
    const MAX_DAYS_AHEAD = 90;

    const $   = id => document.getElementById(id);
    const val = id => $(id).value.trim();

    const pad = n => String(n).padStart(2, '0');
    const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const today = new Date();
    const maxDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + MAX_DAYS_AHEAD);
    $('preferredDate').min = iso(today);
    $('preferredDate').max = iso(maxDate);

    const serviceRequirements = {
    'barangay-clearance': [
        'Valid government-issued ID',
        'Proof of residency if required'
    ],
    'certificate-residency': [
        'Valid government-issued ID',
        'Proof of residency/address if required'
    ],
    'certificate-indigency': [
        'Valid government-issued ID',
        'Proof of residency',
        'Supporting document explaining the purpose, if applicable'
    ],
    'business-clearance': [
        'Valid government-issued ID',
        'DTI/SEC registration, as applicable',
        'Proof of business address/occupancy',
        'Other business-related permits/documents required by the barangay'
    ]
};

function updateRequirements() {
    const selected = form.querySelector('input[name="service"]:checked');
    const list = document.getElementById('requirementsList');
    if (!selected || !serviceRequirements[selected.value]) {
        list.innerHTML = '';
        return;
    }
    const docs = serviceRequirements[selected.value];
    list.innerHTML = docs.map(d => `<li>${d}</li>`).join('');
}

form.querySelectorAll('input[name="service"]').forEach(radio => {
    radio.addEventListener('change', updateRequirements);
});

    const nameCheck = (id, label, required) => () => {
        const v = val(id);
        if (!v) return required ? `${label} is required.` : '';
        if (v.length < 2) return `${label} must be at least 2 characters.`;
        if (v.length > 50) return `${label} must be 50 characters or fewer.`;
        if (!NAME_RE.test(v)) return `${label} may only contain letters, spaces, periods, hyphens and apostrophes.`;
        return '';
    };

    const fields = {
        service: {
            anchor: () => form.querySelector('.service-selection'),
            check: () => {
                const c = form.querySelector('input[name="service"]:checked');
                if (!c) return 'Please select a service.';
                return SERVICES.includes(c.value) ? '' : 'The selected service is not valid.';
            }
        },
        firstName:  { anchor: () => $('firstName').closest('.form-group'),  check: nameCheck('firstName', 'First name', true) },
        lastName:   { anchor: () => $('lastName').closest('.form-group'),   check: nameCheck('lastName', 'Last name', true) },
        middleName: { anchor: () => $('middleName').closest('.form-group'), check: nameCheck('middleName', 'Middle name', false) },
        contactNumber: {
            anchor: () => $('contactNumber').closest('.form-group'),
            check: () => {
                const v = val('contactNumber').replace(/[\s\-()]/g, '');
                if (!v) return 'Contact number is required.';
                return PHONE_RE.test(v) ? '' : 'Enter a valid mobile number, e.g. 0917 123 4567 or +63 917 123 4567.';
            }
        },
        address: {
            anchor: () => $('address').closest('.form-group'),
            check: () => {
                const v = val('address');
                if (!v) return 'Address is required.';
                if (v.length < 10) return 'Please enter your complete address (at least 10 characters).';
                return v.length > 255 ? 'Address must be 255 characters or fewer.' : '';
            }
        },
        purpose: {
            anchor: () => $('purpose').closest('.form-group'),
            check: () => {
                const v = $('purpose').value;
                if (!v) return 'Please select a purpose.';
                return PURPOSES.includes(v) ? '' : 'The selected purpose is not valid.';
            }
        },
        preferredDate: {
            anchor: () => $('preferredDate').closest('.form-group'),
            check: () => {
                const v = $('preferredDate').value;
                if (!v) return 'Please choose a valid preferred date.';
                if (v < iso(today)) return 'Preferred date cannot be in the past.';
                if (v > iso(maxDate)) return `Preferred date must be within ${MAX_DAYS_AHEAD} days from today.`;
                return '';
            }
        },
        requestNotes: {
            anchor: () => $('requestNotes').closest('.form-group'),
            check: () => val('requestNotes').length > 500 ? 'Additional information must be 500 characters or fewer.' : ''
        },
        requirements: {
            anchor: () => form.querySelector('.upload-area'),
            check: () => {
                const files = Array.from($('requirements').files);
                if (!files.length) return 'Please upload at least one supporting document.';
                if (files.length > FILE.maxFiles) return `You can upload up to ${FILE.maxFiles} files.`;
                for (const f of files) {
                    const ext = f.name.split('.').pop().toLowerCase();
                    if (!FILE.exts.includes(ext)) return `"${f.name}" is not an accepted format (PDF, JPG, JPEG, PNG).`;
                    if (f.size === 0) return `"${f.name}" is empty.`;
                    if (f.size > FILE.maxMB * 1024 * 1024) return `"${f.name}" is larger than ${FILE.maxMB} MB.`;
                }
                return '';
            }
        },
        confirmInformation: {
            anchor: () => form.querySelector('.confirmation-checkbox'),
            check: () => $('confirmInformation').checked ? '' : 'Please confirm that your information is accurate.'
        }
    };

    /* ---------- error display ---------- */
    function showError(key, msg) {
        const anchor = fields[key].anchor();
        const old = form.querySelector(`.field-error[data-for="${key}"]`);
        if (old) old.remove();
        anchor.classList.toggle('has-error', !!msg);
        if (!msg) return;
        const p = document.createElement('p');
        p.className = 'field-error';
        p.dataset.for = key;
        p.setAttribute('role', 'alert');
        p.textContent = msg;
        anchor.classList.contains('form-group') ? anchor.appendChild(p) : anchor.after(p);
    }

    const validateField = key => { const m = fields[key].check(); showError(key, m); return !m; };

    function validateAll() {
        let firstBad = null;
        for (const key of Object.keys(fields)) {
            if (!validateField(key) && !firstBad) firstBad = key;
        }
        return firstBad;
    }

    function focusField(key) {
        const target = key === 'service' ? form.querySelector('input[name="service"]')
                     : key === 'requirements' ? form.querySelector('.upload-button')
                     : $(key);
        const box = fields[key].anchor();
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (target && key !== 'requirements') target.focus({ preventScroll: true });
    }

    /* ---------- status banner ---------- */
    const status = document.createElement('div');
    status.className = 'form-status';
    status.hidden = true;
    status.setAttribute('role', 'status');
    form.prepend(status);

    function setStatus(type, msg) {
        status.hidden = !msg;
        status.className = `form-status ${type || ''}`;
        status.textContent = msg || '';
        if (msg) status.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    /* ---------- live validation ---------- */
    Object.keys(fields).forEach(key => {
        const els = key === 'service' ? form.querySelectorAll('input[name="service"]') : [$(key)];
        els.forEach(el => {
            el.addEventListener('change', () => validateField(key));
            if (['INPUT', 'TEXTAREA'].includes(el.tagName) && !['checkbox', 'file', 'radio'].includes(el.type)) {
                el.addEventListener('blur', () => { el.value = el.value.trim(); validateField(key); });
                el.addEventListener('input', () => {
                    if (fields[key].anchor().classList.contains('has-error')) validateField(key);
                });
            }
        });
    });

    /* ---------- file list + drag and drop ---------- */
    const upload = form.querySelector('.upload-area');
    const list = document.createElement('ul');
    list.className = 'file-list';
    upload.appendChild(list);

    const renderFiles = () => {
        list.innerHTML = '';
        Array.from($('requirements').files).forEach(f => {
            const li = document.createElement('li');
            li.textContent = `${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB)`;
            list.appendChild(li);
        });
    };
    $('requirements').addEventListener('change', renderFiles);

    ['dragenter', 'dragover'].forEach(ev => upload.addEventListener(ev, e => {
        e.preventDefault(); upload.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach(ev => upload.addEventListener(ev, e => {
        e.preventDefault(); upload.classList.remove('dragover');
    }));
    upload.addEventListener('drop', e => {
        if (!e.dataTransfer.files.length) return;
        $('requirements').files = e.dataTransfer.files;
        renderFiles();
        validateField('requirements');
    });

    /* ---------- submit ---------- */
    form.addEventListener('submit', async e => {
        e.preventDefault();
        setStatus('', '');

        const firstBad = validateAll();
        if (firstBad) {
            setStatus('error', 'Please fix the highlighted fields and try again.');
            focusField(firstBad);
            return;
        }

        const btn = form.querySelector('.primary-button');
        btn.disabled = true;

        try {
            const res = await fetch(form.action, { method: 'POST', body: new FormData(form) });
            const data = await res.json();

            if (data.success) {
                form.reset();
                renderFiles();
                Object.keys(fields).forEach(k => showError(k, ''));
                setStatus('success', data.message || 'Your request was submitted.');
            } else {
                Object.entries(data.errors || {}).forEach(([k, m]) => fields[k] && showError(k, m));
                setStatus('error', data.message || 'Some information is not valid. Please review the form.');
                const bad = Object.keys(data.errors || {}).find(k => fields[k]);
                if (bad) focusField(bad);
            }
        } catch (err) {
            setStatus('error', 'Could not reach the server. Please try again later.');
        } finally {
            btn.disabled = false;
        }
    });

        // ...existing code...
    
    (() => {
        const form = document.getElementById('serviceRequestForm');
        const steps = [...document.querySelectorAll('.request-steps .request-step')];
        const lines = [...document.querySelectorAll('.request-steps .step-line')];
    
        if (!form || steps.length !== 4) return;
    
        const checks = [
            () => Boolean(form.querySelector('[name="service"]:checked')),
            () => ['firstName', 'lastName', 'contactNumber', 'address', 'purpose']
                .every(id => form.querySelector(`#${id}`)?.value.trim()),
            () => (form.querySelector('#requirements')?.files.length ?? 0) > 0,
            () => Boolean(form.querySelector('#confirmInformation')?.checked)
        ];
    
        const updateSteps = () => {
            const completed = checks.map(check => check());
            const current = completed.findIndex(done => !done);
    
            steps.forEach((step, index) => {
                const isComplete = completed[index];
                const number = step.querySelector('.step-number');
    
                step.classList.toggle('completed', isComplete);
                step.classList.toggle('active', index === current);
    
                if (number) number.textContent = isComplete ? '✓' : String(index + 1);
    
                if (isComplete) {
                    step.setAttribute('aria-label', `Step ${index + 1} completed`);
                } else {
                    step.removeAttribute('aria-label');
                }
            });
    
            lines.forEach((line, index) => {
                line.classList.toggle('completed', completed[index]);
            });
        };
    
        form.addEventListener('input', updateSteps);
        form.addEventListener('change', updateSteps);
        updateSteps();
    })();
    
    // ...existing code...

})();
