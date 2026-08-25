<?php

/*
|--------------------------------------------------------------------------
| Couriers
|--------------------------------------------------------------------------
|
| FMRC ships through third-party couriers, so the only tracking data the
| system ever holds is what staff are told by the courier and type in. This
| registry is the single place that knows the courier list, so the admin
| dropdown, the customer's "track it yourself" link and the order payload all
| agree on the same names.
|
| `tracking_url` is a template: when it contains `{tracking_no}` the waybill is
| substituted in and the resulting link becomes the customer's one-click primary
| - they click once and land on a page already showing the checkpoints. Most
| Philippine couriers read the waybill from an in-page form instead of the URL,
| so there is nothing to substitute; those entries hold the courier's official
| tracking landing page, which is offered as a secondary link while the primary
| falls through to a pre-filled 17TRACK lookup. Correcting one of these later is
| a one-line change here - never a change in three different files.
|
| No courier API is involved anywhere in this file. Every link is a public web
| page a customer could have typed in themselves; the checkpoint text in the
| order timeline is still typed by staff from what the courier told them.
|
*/

return [

    /*
     | Pre-selected in the admin tracking modal and stamped on a delivery order
     | at checkout. Must be a key below.
     */
    'default' => 'jnt',

    'options' => [

        'jnt' => [
            'label' => 'J&T Express',
            // Landing page: J&T Philippines tracks through an in-page query
            // form, with no documented waybill URL parameter.
            'tracking_url' => 'https://www.jtexpress.ph',
            'accepts_tracking_no' => true,
        ],

        'ninjavan' => [
            'label' => 'Ninja Van',
            'tracking_url' => 'https://www.ninjavan.co/en-ph/tracking',
            'accepts_tracking_no' => true,
        ],

        'flash' => [
            'label' => 'Flash Express',
            'tracking_url' => 'https://www.flashexpress.ph',
            'accepts_tracking_no' => true,
        ],

        'lbc' => [
            'label' => 'LBC Express',
            // LBC's own track-and-trace form. Like J&T it reads the number from
            // an in-page field, so there is no waybill URL parameter to build.
            'tracking_url' => 'https://www.lbcexpress.com/track/',
            'accepts_tracking_no' => true,
        ],

        'lalamove' => [
            'label' => 'Lalamove',
            // Lalamove is same-day point-to-point: the rider's live link comes
            // from their own app, so there is no waybill page to send anyone to.
            'tracking_url' => null,
            'accepts_tracking_no' => true,
        ],

        'phlpost' => [
            'label' => 'PHLPost (Post Office)',
            // Cheapest way to send a keychain or a small print anywhere in the
            // country, and the post office reaches Camarines Norte towns the
            // private couriers skip. Slow, so it is a price choice, not a
            // speed one.
            'tracking_url' => 'https://tracking.phlpost.gov.ph/',
            'accepts_tracking_no' => true,
        ],

        'pickup' => [
            'label' => 'Customer pickup at FMRC',
            'tracking_url' => null,
            'accepts_tracking_no' => false,
        ],

        'other' => [
            'label' => 'Other courier',
            'tracking_url' => null,
            'accepts_tracking_no' => true,
        ],
    ],

    /*
     | Universal fallback, and in practice the link the customer actually clicks.
     | 17TRACK works out the carrier from the waybill number itself, needs no
     | account, and - unlike every Philippine courier page in the list above -
     | accepts the number in the URL, so `{tracking_no}` really is substituted
     | here. `https://www.17track.net/en/track?nums=...` redirects (307) to this
     | address, so the short form is used directly to save the customer a hop.
     |
     | Only its public web page is used. 17TRACK's API and webhooks are a paid
     | product and are not wired up; nothing here polls or receives anything.
     */
    'universal_tracking_url' => 'https://t.17track.net/en#nums={tracking_no}',

    /*
     | Same service with no number attached, for the rare screen that links to
     | 17TRACK before a waybill exists.
     */
    'universal_tracking_landing' => 'https://www.17track.net/en/tracking',
];
