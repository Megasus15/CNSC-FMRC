# Appointment team workflow release

Deploy the application and versioned shared assets together, then run these commands from Hostinger's `public_html/backend` directory:

```sh
php artisan migrate --force
php artisan config:clear
```

The additive migration `2026_11_11_000001_add_consultation_completed_at_to_appointments` adds two nullable appointment fields: the actual consultation completion timestamp and the pre-archive status used for restoration. Unknown historical completion dates are left empty; their table ordering falls back to booking creation time.

Check with an owned record in both Admin and Staff:

1. Open an ordinary appointment, choose **Confirm consultation**, confirm attendance, and save. The details stay open and the record moves below active work.
2. Open a custom request. **Prepare quotation** opens the editor and moves within the modal; **View quotation** targets the current quotation. Draft entries survive navigation and refresh.
3. Scroll or use keyboard arrows in an address list. The results and modal scroll independently; the background page remains still and returns to its previous position on closing.
4. Verify that a completed consultation with ongoing quotation, payment, production, or delivery remains active and cannot be archived.
5. Archive one safely closed test appointment, find it in Archives, and restore it. No sibling consultation or linked order should change. Cancelled custom consultations retain their cancelled status on restoration.

No shipment cron, provider setting, payment calculation, or refund action changes in this release. Local fixtures and regression tests do not establish hosted readback or real provider delivery.
