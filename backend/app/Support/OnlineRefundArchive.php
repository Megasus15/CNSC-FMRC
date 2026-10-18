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

    /** Only settled requests may leave the working queue. Keep every ledger row. */
    public static function blockedReason(Collection $refunds, ?string $cancellation): ?string
    {
        if ($refunds->isEmpty()) return 'There is no refund record to archive.';
        if ($cancellation === 'requested') return 'Review the cancellation before archiving.';
        foreach ($refunds as $refund) {
            if (in_array($refund->status, ['succeeded', 'rejected'], true)) continue;
            // A failed attempt stays actionable until a later attempt resolves it.
            if ($refund->status === 'failed' && $refunds->contains(fn ($later) =>
                $later->id > $refund->id && $later->provider_payment_id === $refund->provider_payment_id
                && in_array($later->status, ['succeeded', 'rejected'], true)
                && (int) $later->amount_centavos >= (int) $refund->amount_centavos)) continue;
            return 'Resolve pending or failed refunds before archiving.';
        }
        return null;
    }
}
