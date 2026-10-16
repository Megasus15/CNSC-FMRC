<?php
namespace App\Support;

use App\Models\OrderTrackingEvent;
use Illuminate\Support\Collection;

final class RefundStatus
{
    /** Keep safe error codes and actionable copy, never raw provider payloads. */
    public static function failure(?string $code, string $detail = '', int $httpStatus = 0): array
    {
        $code = strtolower((string) $code);
        if (!preg_match('/^[a-z][a-z0-9_]{0,79}$/', $code) || str_starts_with($code, 'sk_')) $code = 'refund_rejected';
        $hint = strtolower($code.' '.$detail);
        [$message, $action] = match (true) {
            str_contains($hint, 'insufficient') || preg_match('/(balance.*(low|not enough)|not enough.*balance)/', $hint) === 1 =>
                ['PayMongo does not have enough available funds to cover this refund.', 'Check the merchant payout balance in PayMongo and arrange sufficient funds. Then retry this refund. The customer has not been refunded.'],
            in_array($httpStatus,[401,403],true) =>
                ['PayMongo did not authorize this refund.', 'Ask the account owner to check refund access and the live account credentials with PayMongo. Retry only after access is restored.'],
            str_contains($hint,'exceeds') || str_contains($hint,'already_refunded') =>
                ['The refund exceeds the amount PayMongo can still return.', 'Check the original payment for previous or pending refunds in PayMongo before making another request.'],
            str_contains($hint,'expired') || str_contains($hint,'window') =>
                ['This payment is outside the provider refund window.', 'Contact PayMongo and the customer to arrange the next step. Do not mark the payment refunded until funds are actually returned.'],
            str_contains($hint,'payment_not_found') =>
                ['PayMongo could not find this payment in the merchant account.', 'Check the original payment reference and make sure the same live merchant account is configured.'],
            str_contains($hint,'not_refundable') =>
                ['PayMongo cannot refund this payment in its current state.', 'Open the original payment in PayMongo and check its refund eligibility, then contact PayMongo if needed.'],
            default => ['PayMongo did not accept the refund request.', 'Check the original payment in PayMongo and share the error code with PayMongo support. Resolve the issue before retrying.'],
        };
        return ['error_code'=>$code,'http_status'=>$httpStatus,'failure_message'=>$message,'failure_action'=>$action];
    }

    /** Diagnostics use the existing audit trail; no production schema change. */
    public static function details(Collection $refunds): Collection
    {
        if ($refunds->isEmpty()) return $refunds;
        $events = OrderTrackingEvent::whereIn('metadata->refund_id', $refunds->pluck('id')->all())
            ->where('title','Refund needs attention')->orderByDesc('id')->get()->unique(fn($e) => $e->metadata['refund_id'] ?? null)
            ->keyBy(fn($e) => $e->metadata['refund_id'] ?? null);
        return $refunds->map(function ($r) use ($events) {
            $info = $events->get($r->id)?->metadata ?? [];
            $r->error_code = $info['error_code'] ?? null;
            $r->failure_message = $r->status === 'failed' ? ($info['failure_message'] ?? 'This refund was not completed. The original failure reason was not saved.') : null;
            $r->failure_action = $r->status === 'failed' ? ($info['failure_action'] ?? 'Check the original payment in PayMongo before retrying. New failed attempts will show the provider error code here.') : null;
            return $r;
        });
    }
}
