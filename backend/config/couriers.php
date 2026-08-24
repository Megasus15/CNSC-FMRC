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
| `tracking_url` is a template. `{tracking_no}` is substituted when present;
| when a courier has no documented public deep-link format the value is its
| official tracking landing page instead, and the customer is given the
| waybill number to paste. Correcting one of these later is a one-line change
| here - never a change in three different files.
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
     | Universal fallback for a courier that is not in the list above, or whose
     | own site has no usable link. 17TRACK auto-detects the carrier from the
     | waybill number and is free to use without an account.
     */
    'universal_tracking_url' => 'https://www.17track.net/en/tracking',
];
