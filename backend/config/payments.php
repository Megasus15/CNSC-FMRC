<?php

/*
|--------------------------------------------------------------------------
| Payment collection
|--------------------------------------------------------------------------
|
| FMRC collects GCash money on one of two rails, and only the rail changes
| between them - the checkout screen the customer sees is the same either way.
|
|   manual   The centre's own GCash QR is shown, the customer pays from their
|            own app, and types the 13-digit reference number GCash gives them.
|            Staff match that reference in their GCash app and confirm the
|            payment. Free, needs no merchant contract, works today.
|
|   paymongo A licensed gateway creates a checkout session, GCash itself
|            confirms the payment over a webhook, and nobody has to eyeball a
|            reference. Needs a PayMongo account (business documents) and
|            costs a per-transaction fee, so it stays switched off until the
|            keys are present.
|
| Nothing here is secret except the PayMongo keys, which live in .env.
|
*/

return [

    /*
     | Which rail is live. Falls back to "manual" whenever the configured
     | gateway has no usable credentials, so a half-finished .env can never
     | leave the checkout unable to take an order.
     */
    'gateway' => env('PAYMENT_GATEWAY', 'manual'),

    'gcash' => [

        /*
         | GCash hands the payer a 13-digit reference number for every send.
         | That number is what staff search for in their own GCash app, so it
         | is the one piece of proof the customer must supply.
         */
        'reference_digits' => 13,

        /*
         | Trusting a customer-typed reference number would mark an order paid
         | before a single peso arrived, so a manual GCash order starts as
         | pending and waits for staff to confirm it. Setting this to true
         | restores the old behaviour of auto-confirming GCash on submit -
         | only useful if you have decided to reconcile payments some other
         | way, and it lets an unpaid order straight into the shipping queue.
         */
        'auto_confirm' => env('GCASH_AUTO_CONFIRM', false),

        /*
         | How long a customer has to send the money after placing the order,
         | mirroring the countdown Shopee and Lazada show on an unpaid order.
         | Stamped onto orders.payment_due_at at checkout so the deadline the
         | customer was promised never moves afterwards.
         |
         | Nothing cancels an order automatically when this lapses: shared
         | hosting gives us no cron, so the deadline is a prompt for the
         | customer and a filter for staff, not an enforced expiry.
         */
        'payment_window_hours' => (int) env('GCASH_PAYMENT_WINDOW_HOURS', 48),

        /*
         | Cap on the receipt screenshot a customer may attach when they submit
         | their reference number. Kept small because the image is stored inline
         | as base64 and travels with the order payload.
         */
        'proof_max_kb' => (int) env('GCASH_PROOF_MAX_KB', 2048),
    ],

    'paymongo' => [
        'base_url' => env('PAYMONGO_BASE_URL', 'https://api.paymongo.com/v1'),
        'secret_key' => env('PAYMONGO_SECRET_KEY'),
        'public_key' => env('PAYMONGO_PUBLIC_KEY'),
        'webhook_secret' => env('PAYMONGO_WEBHOOK_SECRET'),

        /*
         | Where GCash sends the customer back to after they approve or cancel
         | the payment inside the GCash app.
         */
        'success_url' => env('PAYMONGO_SUCCESS_URL'),
        'failed_url' => env('PAYMONGO_FAILED_URL'),
    ],
];
