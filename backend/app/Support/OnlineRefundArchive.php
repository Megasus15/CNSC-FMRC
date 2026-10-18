<?php

namespace App\Support;

use Illuminate\Support\Collection;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schema;

final class OnlineRefundArchive
{
    public static function available(): bool
    {
        return Schema::hasColumn('payments', 'online_refund_archived_at')
            && Schema::hasColumn('payments', 'online_refund_archived_by');
    }

    /** Prepare only this feature's nullable metadata, outside any payment transaction. */
    public static function prepareStorage(): bool
    {
        if (self::available()) return true;
        try {
            Cache::lock('online-refund-archive:setup', 30)->block(5, function () {
                if (!Schema::hasColumn('payments', 'online_refund_archived_at')) {
                    Schema::table('payments', fn (Blueprint $table) => $table->timestamp('online_refund_archived_at')->nullable()->index());
                }
                if (!Schema::hasColumn('payments', 'online_refund_archived_by')) {
                    Schema::table('payments', fn (Blueprint $table) => $table->foreignId('online_refund_archived_by')->nullable()->constrained('users')->nullOnDelete());
                }
            });
        } catch (\Throwable $exception) {
            report($exception);
        }
        return self::available();
    }

    /** Only provider-confirmed refunds may leave the working queue. */
    public static function blockedReason(Collection $refunds, ?string $cancellation): ?string
    {
        if ($refunds->isEmpty()) return 'There is no refund record to archive.';
        if ($cancellation === 'requested') return 'Review the cancellation before archiving.';
        foreach ($refunds as $refund) {
            if ($refund->status === 'succeeded') continue;
            // Match the current status shown in Online refunds. Failed/declined
            // attempts stay in history after a later confirmed refund; their
            // attempted amount is not an outstanding transfer or reservation.
            $confirmedLater = $refunds->contains(fn ($later) => $later->id > $refund->id
                && $later->provider_payment_id === $refund->provider_payment_id
                && $later->status === 'succeeded');
            if (in_array($refund->status, ['failed','rejected'], true) && $confirmedLater) continue;
            return 'Available after refund confirmation.';
        }
        return null;
    }
}
