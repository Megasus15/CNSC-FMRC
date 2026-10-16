<?php
namespace App\Support;

use App\Models\OrderTrackingEvent;
use Illuminate\Support\Collection;

final class RefundStatus
{
    /** Keep safe error codes and actionable copy, never raw provider payloads. */
    public static function failure(?string $code, string $detail = '', int $httpStatus = 0, mixed $source = []): array
    {
        $code = strtolower((string) $code);
        if (!preg_match('/^[a-z][a-z0-9_]{0,79}$/', $code) || str_starts_with($code, 'sk_')) $code = 'refund_rejected';
        $hint = strtolower($code.' '.$detail);
        $field = is_array($source) ? ($source['attribute'] ?? basename((string)($source['pointer'] ?? ''))) : '';
        $field = in_array($field,['payment_id','amount','reason','notes','currency'],true) ? $field : null;
        [$message, $action] = match (true) {
            $code === 'parameter_invalid' =>
                ['PayMongo rejected a refund request field'.($field ? ' ('.$field.')' : '').'.', 'Check the original payment reference and refund amount. Share this error code and field with FMRC technical support before retrying.'],
            str_contains($hint, 'insufficient') || preg_match('/(balance.*(low|not enough)|not enough.*balance)/', $hint) === 1 =>
                ['PayMongo does not have enough available funds to cover this refund.', 'For QR Ph refunds, fund the merchant PayMongo wallet or wait for settlement into it. Scheduled payouts are not available wallet funds. Then retry this refund. The customer has not been refunded.'],
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
        return ['error_code'=>$code,'error_field'=>$field,'http_status'=>$httpStatus,'failure_message'=>$message,'failure_action'=>$action];
    }

    public static function safeTransferLink(mixed $url, bool $live): ?string
    {
        if (!is_string($url) || strlen($url)>2048 || !filter_var($url,FILTER_VALIDATE_URL)) return null;
        $parts = parse_url($url);
        $hosts = $live ? ['transfer.paymongo.com'] : ['transfer.paymongo.com','transfer.paymongo-stg.com'];
        return ($parts['scheme'] ?? '') === 'https' && in_array($parts['host'] ?? '',$hosts,true)
            && !isset($parts['user']) && !isset($parts['pass']) && !isset($parts['port']) ? $url : null;
    }

    /** Claim URLs stay behind authenticated order/payment APIs, out of public settings. */
    public static function claims(Collection $refunds): Collection
    {
        if ($refunds->isEmpty()) return $refunds;
        $events = OrderTrackingEvent::whereIn('metadata->refund_id',$refunds->pluck('id')->all())
            ->where('title','Refund ready to claim')->orderByDesc('id')->get()->unique(fn($e)=>$e->metadata['refund_id'] ?? null)
            ->keyBy(fn($e)=>$e->metadata['refund_id'] ?? null);
        return $refunds->map(function($r) use ($events) {
            $info=$events->get($r->id)?->metadata ?? [];
            $active=in_array($r->status,['pending','unknown'],true);
            $r->claim_expires_at=$active ? ($info['claim_expires_at'] ?? null) : null;
            $expired=$r->claim_expires_at && \Illuminate\Support\Carbon::parse($r->claim_expires_at)->isPast();
            $r->transfer_link=$active && !$expired ? self::safeTransferLink($info['transfer_link'] ?? null,(bool)$r->livemode) : null;
            return $r;
        });
    }

    /** Diagnostics use the existing audit trail; no production schema change. */
    public static function details(Collection $refunds): Collection
    {
        if ($refunds->isEmpty()) return $refunds;
        $events = OrderTrackingEvent::whereIn('metadata->refund_id', $refunds->pluck('id')->all())
            ->where('title','Refund needs attention')->orderByDesc('id')->get()->unique(fn($e) => $e->metadata['refund_id'] ?? null)
            ->keyBy(fn($e) => $e->metadata['refund_id'] ?? null);
        return self::claims($refunds)->map(function ($r) use ($events) {
            $info = $events->get($r->id)?->metadata ?? [];
            $r->error_code = $info['error_code'] ?? null;
            $r->error_field = $info['error_field'] ?? null;
            $r->failure_message = $r->status === 'failed' ? ($info['failure_message'] ?? 'This refund was not completed. The original failure reason was not saved.') : null;
            $r->failure_action = $r->status === 'failed' ? ($info['failure_action'] ?? 'Check the original payment in PayMongo before retrying. New failed attempts will show the provider error code here.') : null;
            return $r;
        });
    }
}
