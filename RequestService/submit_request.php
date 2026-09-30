<?php
/* Request a Service - server-side validation.
   Never trust the browser: these rules mirror service.js and run on every submit. */

declare(strict_types=1);
date_default_timezone_set('Asia/Manila');
header('Content-Type: application/json; charset=utf-8');

function respond(int $code, array $body): void
{
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['success' => false, 'message' => 'Method not allowed.']);
}

// TODO: once login sessions exist, block anonymous requests here, e.g.
// session_start(); if (empty($_SESSION['user_id'])) respond(401, [...]);

// An upload larger than post_max_size arrives with an empty $_POST.
if (empty($_POST) && empty($_FILES) && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
    respond(413, ['success' => false, 'message' => 'The upload is too large.']);
}

const SERVICES  = ['barangay-clearance', 'certificate-residency', 'certificate-indigency', 'business-clearance'];
const PURPOSES  = ['employment', 'school', 'business', 'government', 'personal', 'other'];
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 5;
const MAX_DAYS_AHEAD = 90;
const ALLOWED_FILES = [            // extension => real MIME type
    'pdf'  => 'application/pdf',
    'jpg'  => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'png'  => 'image/png',
];

function clean(string $key): string
{
    $v = $_POST[$key] ?? '';
    if (!is_string($v)) return '';
    $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $v) ?? '';
    return trim($v);
}

$d = [];
foreach (['service', 'firstName', 'middleName', 'lastName', 'contactNumber',
          'address', 'purpose', 'preferredDate', 'requestNotes'] as $k) {
    $d[$k] = clean($k);
}
$errors = [];

// Service
if ($d['service'] === '') $errors['service'] = 'Please select a service.';
elseif (!in_array($d['service'], SERVICES, true)) $errors['service'] = 'The selected service is not valid.';

// Names
$checkName = function (string $key, string $label, bool $required) use ($d, &$errors): void {
    $v = $d[$key];
    if ($v === '') { if ($required) $errors[$key] = "$label is required."; return; }
    $len = mb_strlen($v);
    if ($len < 2)       $errors[$key] = "$label must be at least 2 characters.";
    elseif ($len > 50)  $errors[$key] = "$label must be 50 characters or fewer.";
    elseif (!preg_match("/^\p{L}[\p{L} .'-]*$/u", $v))
        $errors[$key] = "$label may only contain letters, spaces, periods, hyphens and apostrophes.";
};
$checkName('firstName', 'First name', true);
$checkName('lastName', 'Last name', true);
$checkName('middleName', 'Middle name', false);

// Contact number (PH mobile: 09XXXXXXXXX or +639XXXXXXXXX)
$phone = preg_replace('/[\s\-()]/', '', $d['contactNumber']);
if ($phone === '') $errors['contactNumber'] = 'Contact number is required.';
elseif (!preg_match('/^(09|\+639)\d{9}$/', $phone))
    $errors['contactNumber'] = 'Enter a valid mobile number, e.g. 0917 123 4567 or +63 917 123 4567.';

// Address
$len = mb_strlen($d['address']);
if ($len === 0)       $errors['address'] = 'Address is required.';
elseif ($len < 10)    $errors['address'] = 'Please enter your complete address (at least 10 characters).';
elseif ($len > 255)   $errors['address'] = 'Address must be 255 characters or fewer.';

// Purpose
if ($d['purpose'] === '') $errors['purpose'] = 'Please select a purpose.';
elseif (!in_array($d['purpose'], PURPOSES, true)) $errors['purpose'] = 'The selected purpose is not valid.';

// Preferred date: real calendar date, today up to MAX_DAYS_AHEAD
$date = DateTime::createFromFormat('!Y-m-d', $d['preferredDate']);
if ($d['preferredDate'] === '' || !$date || $date->format('Y-m-d') !== $d['preferredDate']) {
    $errors['preferredDate'] = 'Please choose a valid preferred date.';
} else {
    $today = new DateTime('today');
    if ($date < $today) $errors['preferredDate'] = 'Preferred date cannot be in the past.';
    elseif ($date > (clone $today)->modify('+' . MAX_DAYS_AHEAD . ' days'))
        $errors['preferredDate'] = 'Preferred date must be within ' . MAX_DAYS_AHEAD . ' days from today.';
}

// Notes
if (mb_strlen($d['requestNotes']) > 500) $errors['requestNotes'] = 'Additional information must be 500 characters or fewer.';

// Confirmation checkbox
if (empty($_POST['confirmInformation'])) $errors['confirmInformation'] = 'Please confirm that your information is accurate.';

// Files: check the real content type, not just the extension
$names = $_FILES['requirements']['name'] ?? [];
$names = is_array($names) ? array_values(array_filter($names, fn($n) => $n !== '')) : [];
if (!$names) {
    $errors['requirements'] = 'Please upload at least one supporting document.';
} elseif (count($names) > MAX_FILES) {
    $errors['requirements'] = 'You can upload up to ' . MAX_FILES . ' files.';
} else {
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    foreach ($_FILES['requirements']['name'] as $i => $name) {
        $tmp  = $_FILES['requirements']['tmp_name'][$i];
        $size = $_FILES['requirements']['size'][$i];
        $ext  = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        $label = htmlspecialchars($name, ENT_QUOTES, 'UTF-8');

        if ($_FILES['requirements']['error'][$i] !== UPLOAD_ERR_OK || !is_uploaded_file($tmp))
            $msg = "\"$label\" could not be uploaded.";
        elseif (!isset(ALLOWED_FILES[$ext]))
            $msg = "\"$label\" is not an accepted format (PDF, JPG, JPEG, PNG).";
        elseif ($size === 0 || $size > MAX_BYTES)
            $msg = "\"$label\" must be between 1 byte and " . (MAX_BYTES / 1048576) . ' MB.';
        elseif ($finfo->file($tmp) !== ALLOWED_FILES[$ext])
            $msg = "\"$label\" does not match its file type.";
        else continue;

        $errors['requirements'] = $msg;
        break;
    }
}

if ($errors) {
    respond(422, ['success' => false, 'message' => 'Some information is not valid. Please review the form.', 'errors' => $errors]);
}

// TODO: everything is valid. Save the request here (database insert), and store the
// uploads outside the public web root under random names, e.g. bin2hex(random_bytes(16)) . ".$ext".

respond(200, ['success' => true, 'message' => 'Your request was submitted successfully.']);
