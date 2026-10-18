<?php

namespace App\Support;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Schema;

final class OnlineRefundArchive
{
    public static function available(): bool
    {
        return Schema::hasColumn('payments', 'online_refund_archived_at')
            && Schema::hasColumn('payments', 'online_refund_archived_by');
    }

    /** Only provider-confirmed refunds may leave the working queue. */
    public static function blockedReason(Collection $refunds, ?string $cancellation): ?string
    {
        if ($refunds->isEmpty()) return 'There is no refund record to archive.';
        if ($cancellation === 'requested') return 'Review the cancellation before archiving.';
        foreach ($refunds as $refund) {
            if ($refund->status === 'succeeded') continue;
            if (in_array($refund->status, ['failed','rejected'], true) && $refunds->contains(fn ($later) =>
                $later->id > $refund->id && $later->provider_payment_id === $refund->provider_payment_id
                && $later->status === 'succeeded'
                && (int) $later->amount_centavos >= (int) $refund->amount_centavos)) continue;
            return 'Archive becomes available after the refund is confirmed.';
        }
        return null;
    }
}
