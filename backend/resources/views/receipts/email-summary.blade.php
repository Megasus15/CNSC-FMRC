<table width="100%" cellpadding="0" cellspacing="0" role="presentation"
       style="margin:0 0 22px;background:#f8f3ee;border:1px solid #e4dbd6;border-radius:10px;color:#26292e;">
    <tr>
        <td style="padding:15px 18px 10px;">
            <p style="margin:0;color:#57585d;font-size:12px;font-weight:600;">Amount paid</p>
            <p style="margin:4px 0 0;color:#6b202b;font-size:24px;font-weight:700;">{{ $amount }}</p>
        </td>
    </tr>
    <tr>
        <td style="padding:8px 18px 15px;font-size:13px;line-height:1.7;">
            <strong>Receipt number</strong> {{ $number }}<br>
            <strong>Order number</strong> {{ $orderNumber }}<br>
            <strong>Payment method</strong> {{ $method }}<br>
            <strong>Paid on</strong> {{ $paidOn }}
        </td>
    </tr>
</table>
@if ($orderUrl)
    <p style="margin:0 0 18px;">
        <a href="{{ $orderUrl }}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#6b202b;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">Open My Orders</a>
    </p>
@elseif ($isSample ?? false)
    <p style="margin:0 0 18px;color:#57585d;font-size:13px;">This test message contains a sample receipt.</p>
@else
    <p style="margin:0 0 18px;color:#57585d;font-size:13px;">A downloadable PDF is attached when this email is sent.</p>
@endif
