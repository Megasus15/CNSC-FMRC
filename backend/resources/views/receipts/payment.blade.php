<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>UCN-FMRC Payment Receipt {{ $number }}</title>
    <style>
        @font-face { font-family: Montserrat; src: url("Montserrat-Regular.ttf") format("truetype"); font-weight: 400; }
        @font-face { font-family: Montserrat; src: url("Montserrat-SemiBold.ttf") format("truetype"); font-weight: 700; }
        @page { margin: 15mm 17mm 19mm; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Montserrat, "DejaVu Sans", sans-serif; font-size: 10pt; line-height: 1.45; color: #26292e; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .brand td { vertical-align: middle; }
        .brand-mark { width: 11%; }
        .brand-text { width: 89%; }
        .brand-mark img { width: 38pt; height: 38pt; }
        .brand-name { margin: 0; color: #6b202b; font-size: 12pt; font-weight: 700; }
        .brand-sub { margin: 2pt 0 0; color: #57585d; font-size: 9pt; }
        .hero { margin: 16pt 0 13pt; background: #f8f3ee; border-top: 2pt solid #6b202b; }
        .hero td { padding: 13pt 14pt; vertical-align: middle; }
        .hero h1 { margin: 0; color: #6b202b; font-size: 20pt; line-height: 1.2; }
        .label { margin: 0 0 3pt; color: #57585d; font-size: 8pt; font-weight: 700; }
        .hero .total { margin: 0; color: #6b202b; font-size: 21pt; font-weight: 700; overflow-wrap: anywhere; word-wrap: break-word; }
        .right { text-align: right; }
        .facts { margin-bottom: 15pt; }
        .facts td { width: 50%; padding: 7pt 10pt; vertical-align: top; border: 0.6pt solid #e4dbd6; word-wrap: break-word; }
        .value { margin: 0; font-size: 9pt; }
        h2 { margin: 0 0 7pt; color: #6b202b; font-size: 12pt; page-break-after: avoid; }
        .lines thead { display: table-header-group; }
        .lines tr { page-break-inside: avoid; }
        .lines th { padding: 7pt 8pt; color: #6b202b; background: #f8f3ee; font-size: 8pt; text-align: left; }
        .lines td { padding: 7pt 8pt; border-bottom: 0.6pt solid #e4dbd6; vertical-align: top; font-size: 9pt; word-wrap: break-word; }
        .lines .right { text-align: right; }
        .settlement { page-break-inside: avoid; margin-top: 13pt; }
        .totals td { padding: 4pt 8pt; }
        .totals .paid td { padding-top: 7pt; font-weight: 700; color: #6b202b; border-top: 1pt solid #e4dbd6; }
        .foot { margin-top: 16pt; padding-top: 9pt; border-top: 0.6pt solid #e4dbd6; color: #57585d; font-size: 8pt; }
        .foot p { margin: 0 0 3pt; word-wrap: break-word; }
        .foot strong { color: #6b202b; }
        .test { color: #6b202b; font-weight: 700; margin: 9pt 0 0; }
    </style>
</head>
<body>
    <table class="brand" role="presentation">
        <tr>
            <td class="brand-mark"><img src="{{ $logo }}" alt="FMRC logo"></td>
            <td class="brand-text">
                <p class="brand-name">University of Camarines Norte</p>
                <p class="brand-sub">Fabrication &amp; Manufacturing Research Center</p>
            </td>
        </tr>
    </table>

    @if ($details['test_payment'])
        <p class="test">Test payment record</p>
    @endif

    <table class="hero" role="presentation">
        <tr>
            <td><h1>Payment Receipt</h1></td>
            <td class="right">
                <p class="label">Amount paid</p>
                <p class="total">{{ $money($details['amount_centavos']) }}</p>
            </td>
        </tr>
    </table>

    <table class="facts" role="presentation">
        <tr>
            <td><p class="label">Receipt number</p><p class="value">{{ $number }}</p></td>
            <td><p class="label">Order number</p><p class="value">{{ $details['order_number'] }}</p></td>
        </tr>
        <tr>
            <td><p class="label">Customer</p><p class="value">{{ $details['customer_name'] }}</p></td>
            <td><p class="label">Paid on</p><p class="value">{{ $details['paid_on'] }}</p></td>
        </tr>
        <tr>
            <td><p class="label">Payment method</p><p class="value">{{ $details['method'] }}</p></td>
            <td><p class="label">Payment reference</p><p class="value">{{ $details['reference'] ?: 'Recorded by FMRC' }}</p></td>
        </tr>
        @if ($details['quote'])
            <tr>
                <td colspan="2"><p class="label">Accepted custom quotation</p><p class="value">{{ $details['quote'] }}</p></td>
            </tr>
        @endif
    </table>

    <h2>Order items</h2>
    <table class="lines">
        <thead><tr>
            <th scope="col" style="width: 49%">Product</th>
            <th scope="col" class="right" style="width: 9%">Qty</th>
            <th scope="col" class="right" style="width: 21%">Unit price</th>
            <th scope="col" class="right" style="width: 21%">Total</th>
        </tr></thead>
        <tbody>
            @foreach ($details['lines'] as $line)
                <tr>
                    <td>{{ $line['name'] }}</td>
                    <td class="right">{{ $line['quantity'] }}</td>
                    <td class="right">{{ $money($line['unit_centavos']) }}</td>
                    <td class="right">{{ $money($line['total_centavos']) }}</td>
                </tr>
            @endforeach
        </tbody>
    </table>

    <div class="settlement">
        <table class="totals" role="presentation">
            <tr><td></td><td>Items subtotal</td><td class="right">{{ $money($details['subtotal_centavos']) }}</td></tr>
            @if (($details['delivery'] ?? false) || $details['shipping_centavos'] > 0)
                <tr><td></td><td>Delivery fee</td><td class="right">{{ $money($details['shipping_centavos']) }}</td></tr>
            @endif
            <tr class="paid"><td></td><td>Amount paid (PHP)</td><td class="right">{{ $money($details['amount_centavos']) }}</td></tr>
        </table>
        <div class="foot">
            <p><strong>FMRC payment record</strong></p>
            <p>For payment inquiries and document requests, contact the FMRC team.</p>
            @if ($details['phone'] || $details['website'])
                <p>{{ implode('  |  ', array_filter([$details['website'], $details['phone']])) }}</p>
            @endif
        </div>
    </div>
</body>
</html>
