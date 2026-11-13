# UCN appointment intake

Release assets: **2026.1113.2**.

Step 2 adds **UCN College / Department** for official university unit requests.
Personal student requests continue to use Student. The eight department choices
are CCMS, COENG, CAS, CBPA, COED, CANR, CFAST (formerly IFMS), and COTT.
The department is required for the UCN option; the PR and supporting designs are
optional. The PR accepts one PDF, JPG, PNG, or WebP of at most 10 MB. Up to five
designs plus one PR are allowed, with a combined limit of 50 MB including retained
draft files. File uploads require a signed-in customer; file-free bookings retain
the existing guest workflow.

## Deploy through Git

Commit and push the complete change, including the new migration, intake service,
customer script, and tests, then use the site's existing online deployment.
Apply the migration before reopening appointment booking on the new release.
Deploy backend and versioned frontend assets together. No Composer dependency
has been added.

From the active Hostinger backend directory:

```sh
cd /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend &&
php artisan migrate --path=database/migrations/2026_11_13_000001_add_ucn_appointment_intake.php --force &&
php artisan optimize:clear
```

The additive migration requires the existing appointment attachment and optional
custom-product tables. It adds `appointments.university_department` and a `kind`
column to `appointment_attachments` and `appointment_product_files`. Existing
files default to `design`. Preserve the database and private storage across the
deployment. Keep PHP `post_max_size` at least `64M`, `upload_max_filesize` at least
`50M`, and `max_file_uploads` at least `6` for the existing 50 MB upload allowance.
The application separately enforces the 10 MB PR limit.

All shared script references have been versioned across their customer and team
consumers, including Orders, which also uses the custom-product component.
If a hosting/CDN cache stores HTML, clear that page cache after deployment.

## Interfaces and behavior

- `POST /api/appointments` accepts `university_department` and optional multipart
  `purchase_request`. The department must be one of the eight codes when
  `client_type` is `UCN College / Department`. Non-UCN requests cannot supply a
  department or PR.
- Authenticated responses include `university_department`, its display label,
  and attachment `kind` (`design` or `purchase_request`). Public QR verification
  exposes no PR filenames or file links. Existing private download authorization
  applies to the PR.
- Custom-product draft booking data includes `aptUniversityDepartment`.
  `purchase_request` replaces the saved PR only on successful draft save or
  booking; omission retains it. `purchase_request_removed=1` removes a saved PR.
  Switching to a non-UCN client excludes hidden UCN data and removes the saved PR
  when that draft is saved/booked. A failed transaction retains the previous PR.
- Department and PR selections survive step changes, supported sign-in return,
  and custom-product draft restoration. PRs are separate from supporting designs
  and cannot be selected as quotation design proofs. Customer, Admin, and Staff
  details show a dedicated PR section. No PR is a normal, optional state.
- The department appears in confirmation emails and appointment receipts.
  The shared booking header and completion link read **Return to Home**, retaining
  the existing exit confirmation and reset behavior.

## Verification

```sh
# From backend
php artisan test --compact --filter="UcnAppointmentIntakeTest|AppointmentWorkflowTest|OptionalAppointmentProductsTest|AppointmentCompletionEmailTest"

# From the repository root
node --test backend/tests/Frontend/appointment-intake.browser.cjs backend/tests/Frontend/appointments.browser.cjs backend/tests/Frontend/appointment-guidance.browser.cjs
```

Tests use isolated SQLite/private storage and browser API fixtures. They do not
deploy the release or prove hosted readback. After deployment, book an authorized
test appointment with a PR and supporting design, reload My Appointments, and
verify the same department and private PR download in both Admin and Staff.
Also check a UCN appointment with no PR and an existing non-UCN appointment.
