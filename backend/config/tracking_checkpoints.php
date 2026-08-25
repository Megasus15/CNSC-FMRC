<?php

/*
|--------------------------------------------------------------------------
| Tracking Checkpoint Presets
|--------------------------------------------------------------------------
|
| FMRC has no courier API, so every checkpoint on a customer's timeline is
| typed in by a staff member from what the courier told them. That is fine for
| the wording, but it means the same six or seven checkpoints get retyped all
| day, and the map coordinates get retyped with them - which is where the typos
| land, because nobody remembers the latitude of a sorting hub.
|
| This is that list, written once. Picking a preset in the tracking modal fills
| the timeline title, the description, the location name and the coordinates in
| one click; staff can still edit every field afterwards, and can still ignore
| the presets completely and type a checkpoint the courier invented.
|
| `{courier}` in a title or description is replaced with the courier chosen in
| the modal, so one preset covers J&T, LBC and everyone else.
|
| `fulfillment` limits a preset to `pickup`, `delivery`, or `both`. `stage` is
| the customer stage the preset suggests - the modal moves the stage dropdown to
| match, since a staff member posting "Out for delivery" always means the order
| is now To Receive.
|
| `lat`/`lng` are null when the location genuinely is not knowable from here: a
| parcel out for delivery is somewhere in the customer's own street, and the
| customer's map already has their delivery pin. Null leaves the coordinate
| boxes untouched rather than blanking them.
|
| Coordinates are deliberately approximate - a hub pin only has to tell the
| customer which city their parcel is in. Correcting one is a one-line edit
| here.
|
*/

return [

    /*
     | FMRC's own counter. Every pickup checkpoint and the start of every
     | delivery happen here, so it is named once and reused by the presets below.
     |
     | The name and the coordinates deliberately match
     | OrderController::PICKUP_LOCATION_NAME / PICKUP_LATITUDE / PICKUP_LONGITUDE,
     | which are what a pickup order's destination pin already uses - a staff
     | preset must not drop a second, slightly differently named pin on the same
     | office.
     */
    'origin' => [
        'location_name' => 'FMRC Office, University of Camarines Norte, Daet',
        'lat' => 14.1122,
        'lng' => 122.9550,
    ],

    'presets' => [

        // ── Delivery ────────────────────────────────────────────────────────
        [
            'key' => 'packed',
            'label' => 'Packed and waiting for the courier',
            'fulfillment' => 'delivery',
            'stage' => 'to_ship',
            'title' => 'Order packed and ready for pickup by {courier}',
            'description' => 'Your order has been produced, checked and packed at the FMRC office. It is waiting for {courier} to collect it.',
            'location_name' => 'FMRC Office, University of Camarines Norte, Daet',
            'lat' => 14.1122,
            'lng' => 122.9550,
        ],
        [
            'key' => 'handed_over',
            'label' => 'Handed over to the courier',
            'fulfillment' => 'delivery',
            'stage' => 'to_receive',
            'title' => 'Handed over to {courier}',
            'description' => 'FMRC has turned the parcel over to {courier}. The waybill number on this order is now live on their tracking page.',
            'location_name' => 'FMRC Office, University of Camarines Norte, Daet',
            'lat' => 14.1122,
            'lng' => 122.9550,
        ],
        [
            'key' => 'origin_branch',
            'label' => 'Received at the courier branch in Daet',
            'fulfillment' => 'delivery',
            'stage' => 'to_receive',
            'title' => 'Received at {courier} Daet branch',
            'description' => 'The parcel has been scanned in at the courier branch in Daet, Camarines Norte.',
            'location_name' => 'Daet, Camarines Norte',
            'lat' => 14.1121,
            'lng' => 122.9553,
        ],
        [
            'key' => 'departed_origin',
            'label' => 'Left Daet',
            'fulfillment' => 'delivery',
            'stage' => 'to_receive',
            'title' => 'Departed {courier} Daet branch',
            'description' => 'The parcel has left Camarines Norte and is on its way to the sorting hub.',
            'location_name' => 'Daet, Camarines Norte',
            'lat' => 14.1121,
            'lng' => 122.9553,
        ],
        [
            'key' => 'hub_naga',
            'label' => 'At the Naga City sorting hub',
            'fulfillment' => 'delivery',
            'stage' => 'to_receive',
            'title' => 'Arrived at {courier} Naga City sorting hub',
            'description' => 'The parcel is being sorted in Naga City, Camarines Sur.',
            'location_name' => 'Naga City, Camarines Sur',
            'lat' => 13.6218,
            'lng' => 123.1948,
        ],
        [
            'key' => 'hub_manila',
            'label' => 'At the Metro Manila sorting hub',
            'fulfillment' => 'delivery',
            'stage' => 'to_receive',
            'title' => 'Arrived at {courier} Metro Manila sorting hub',
            'description' => 'The parcel is being sorted in Metro Manila before it is sent on to your area.',
            'location_name' => 'Metro Manila',
            'lat' => 14.5995,
            'lng' => 120.9842,
        ],
        [
            'key' => 'in_transit',
            'label' => 'In transit (no location given)',
            'fulfillment' => 'delivery',
            'stage' => 'to_receive',
            'title' => 'In transit with {courier}',
            'description' => 'The courier has the parcel moving between hubs. The next update will come when it is scanned again.',
            // A courier who only says "in transit" has given no place at all, so
            // the last pin the customer saw is left standing.
            'location_name' => null,
            'lat' => null,
            'lng' => null,
        ],
        [
            'key' => 'out_for_delivery',
            'label' => 'Out for delivery',
            'fulfillment' => 'delivery',
            'stage' => 'to_receive',
            'title' => 'Out for delivery',
            'description' => 'The rider has your parcel and is delivering it today. Please keep your phone reachable.',
            'location_name' => null,
            'lat' => null,
            'lng' => null,
        ],
        [
            'key' => 'delivery_failed',
            'label' => 'Delivery attempt failed',
            'fulfillment' => 'delivery',
            'stage' => 'to_receive',
            'title' => 'Delivery attempt unsuccessful',
            'description' => 'The rider could not hand the parcel over. {courier} will try again on the next delivery run - please answer their call so they can confirm your address.',
            'location_name' => null,
            'lat' => null,
            'lng' => null,
        ],
        [
            'key' => 'delivered',
            'label' => 'Delivered to the customer',
            'fulfillment' => 'delivery',
            'stage' => 'completed',
            'title' => 'Parcel delivered',
            'description' => 'The courier has confirmed the parcel was received. Thank you for ordering from FMRC.',
            'location_name' => null,
            'lat' => null,
            'lng' => null,
        ],

        // ── Pickup at the FMRC office ───────────────────────────────────────
        [
            'key' => 'pickup_preparing',
            'label' => 'Being prepared at FMRC',
            'fulfillment' => 'pickup',
            'stage' => 'to_ship',
            'title' => 'Order is being prepared at FMRC',
            'description' => 'Your order is in production at the FMRC office. You will be notified here the moment it is ready to collect.',
            'location_name' => 'FMRC Office, University of Camarines Norte, Daet',
            'lat' => 14.1122,
            'lng' => 122.9550,
        ],
        [
            'key' => 'pickup_ready',
            'label' => 'Ready for pickup',
            'fulfillment' => 'pickup',
            'stage' => 'to_receive',
            'title' => 'Order is ready for pickup at the FMRC office',
            'description' => 'Your order is finished and waiting at the FMRC office. Bring your pickup code during office hours.',
            'location_name' => 'FMRC Office, University of Camarines Norte, Daet',
            'lat' => 14.1122,
            'lng' => 122.9550,
        ],
        [
            'key' => 'pickup_collected',
            'label' => 'Collected by the customer',
            'fulfillment' => 'pickup',
            'stage' => 'completed',
            'title' => 'Order collected',
            'description' => 'The order was handed over at the FMRC office. Thank you for ordering from FMRC.',
            'location_name' => 'FMRC Office, University of Camarines Norte, Daet',
            'lat' => 14.1122,
            'lng' => 122.9550,
        ],

        // ── Either kind of order ────────────────────────────────────────────
        [
            'key' => 'production_delay',
            'label' => 'Delayed in production',
            'fulfillment' => 'both',
            'stage' => 'to_ship',
            'title' => 'Production is taking longer than expected',
            'description' => 'FMRC needs a little more time on this order. Staff will message you with the new date - sorry for the wait.',
            'location_name' => 'FMRC Office, University of Camarines Norte, Daet',
            'lat' => 14.1122,
            'lng' => 122.9550,
        ],
    ],
];
