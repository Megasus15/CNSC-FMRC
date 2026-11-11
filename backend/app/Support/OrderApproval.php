<?php

namespace App\Support;

use App\Models\Order;
use App\Services\AppointmentProducts;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

final class OrderApproval
{
    /** Eligibility only: approving never confirms or changes a payment. */
    public static function state(Order $order): array
    {
        $custom = AppointmentProducts::custom($order);
        $reason = match (true) {
            (bool) $order->is_archived => 'Restore this order before continuing.',
            $order->lifecycle_status !== 'incoming' => 'This order is no longer awaiting approval.',
            $order->hasPendingCancellation() => 'Review the cancellation request first.',
            default => null,
        };
        if ($reason === null && $custom) {
            try {
                AppointmentProducts::assertProduction($order);
            } catch (HttpExceptionInterface $error) {
                $reason = $error->getMessage();
            }
        } elseif ($reason === null) {
            $method = $order->payment?->method ?? $order->payment_method;
            // Keep legacy cash-on-delivery records usable; new COD checkout is disabled elsewhere.
            $cashDueOnCollection = in_array($method, ['COP', 'COD'], true)
                && ($order->payment?->status ?? 'pending') === 'pending';
            if ($order->payment?->status !== 'paid' && ! $cashDueOnCollection) {
                $reason = 'Payment must be confirmed before approving this order.';
            }
        }

        return ['allowed' => $reason === null, 'label' => $custom ? 'Start production' : 'Approve order', 'reason' => $reason];
    }
}
