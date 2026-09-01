<?php

namespace App\Support;

use App\Models\AdminNotification;
use App\Models\Order;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * One place for the admin in-app notification + transactional customer email
 * used by both the order flow and the return/refund flow.
 *
 * OrderController keeps its private wrappers so no call site had to change; they
 * delegate here so the email template exists exactly once.
 */
class OrderNotifier
{
    private const STAGE_LABELS = [
        'to_pay'     => 'To Pay',
        'to_ship'    => 'To Ship',
        'to_receive' => 'To Receive',
        'completed'  => 'Completed',
    ];

    /** Create an in-app notification for admin & staff. */
    public static function notifyAdmins(string $type, string $title, string $message, array $metadata = []): void
    {
        try {
            AdminNotification::create([
                'type'     => $type,
                'title'    => $title,
                'message'  => $message,
                'is_read'  => false,
                'metadata' => $metadata ?: null,
            ]);
        } catch (\Throwable $e) {
            Log::warning('Could not create admin notification: ' . $e->getMessage());
        }
    }

    /**
     * Send a transactional email to the order's customer.
     * Falls back gracefully when mail is not configured (log driver).
     */
    public static function emailCustomer(Order $order, string $subject, string $htmlBody): void
    {
        if (!$order->relationLoaded('customer') && $order->customer_id) {
            $order->load('customer');
        }

        // Priority: User.email → customer_contact (only when it looks like an email)
        $emailAddress = $order->customer?->email ?? null;

        if (!$emailAddress && $order->customer_contact) {
            $contact = trim($order->customer_contact);
            if (filter_var($contact, FILTER_VALIDATE_EMAIL)) {
                $emailAddress = $contact;
            }
        }

        if (!$emailAddress) {
            Log::info("Skipping order email — no valid customer email for Order #{$order->id}");
            return;
        }

        $orderId = (string) $order->id;
        $fromAddress = config('mail.from.address', 'noreply@cnsc-fmrc.edu.ph');
        $fromName = config('mail.from.name', 'UCN-FMRC');

        self::afterResponse(function () use ($emailAddress, $subject, $htmlBody, $orderId, $fromAddress, $fromName): void {
            try {
                Mail::html($htmlBody, function ($message) use ($emailAddress, $subject, $fromAddress, $fromName) {
                    $message->to($emailAddress)
                        ->subject($subject)
                        ->from($fromAddress, $fromName);
                });

                Log::info("Customer order email sent to {$emailAddress} | Subject: {$subject} | Order #{$orderId}");
            } catch (\Throwable $e) {
                Log::error("Customer order email FAILED for Order #{$orderId} to {$emailAddress}: " . $e->getMessage());
            }
        });
    }

    public static function afterResponse(callable $callback): void
    {
        try {
            app()->terminating(function () use ($callback) {
                if (function_exists('fastcgi_finish_request')) {
                    @fastcgi_finish_request();
                }
                $callback();
            });
        } catch (\Throwable $e) {
            if (function_exists('fastcgi_finish_request')) {
                @fastcgi_finish_request();
            }
            $callback();
        }
    }

    /**
     * Styled HTML email body for order/return status notifications.
     *
     * `$statusOverride` replaces the "Status" row for return emails, where the
     * order's own customer_stage ("Completed") is not the interesting fact.
     *
     * `$templateKey` is the EmailTemplate slug whose admin-editable header, body
     * and footer wrap the order summary chip. The chip itself stays code-owned:
     * an admin must not be able to delete the order number out of an order
     * email. Without a slug the caller's own $headline/$bodyText are shelled
     * as-is, so an unconverted caller still sends a correct email.
     *
     * @param  array<string, mixed>  $tokens  Extra {token} values for the template.
     */
    public static function buildEmailHtml(
        Order $order,
        string $headline,
        string $bodyText,
        string $statusColor = '#800000',
        ?string $statusOverride = null,
        ?string $amountOverride = null,
        ?string $templateKey = null,
        array $tokens = [],
    ): string {
        $orderNo = (string) ($order->order_no ?? "ORD-{$order->id}");
        $total = $amountOverride ?? ('₱ ' . number_format((float) $order->total, 2, '.', ','));
        $stage = $statusOverride ?? (self::STAGE_LABELS[$order->customer_stage] ?? 'Processing');
        $amountLabel = $amountOverride !== null ? 'Refund Amount' : 'Total Amount';

        if ($templateKey !== null && EmailTemplate::has($templateKey)) {
            // The four tokens every order email shares are derived here so most
            // call sites only have to pass their slug.
            $tokens += [
                'customer_name' => (string) ($order->customer_name ?: 'Customer'),
                'order_number' => $orderNo,
                'amount' => $total,
                'status' => $stage,
            ];
            $parts = EmailTemplate::resolve($templateKey, $tokens);
        } else {
            $parts = [
                'header_title' => Branding::NAME,
                'header_subtitle' => 'Fabrication & Manufacturing Research Center',
                'header_color' => $statusColor,
                'body_heading' => $headline,
                'body_text' => $bodyText,
                'footer_note' => 'You can track your order status by logging into your account at any time.',
            ];
        }

        // A saved header colour wins over the caller's, so the chip's Status row
        // keeps matching the header band.
        $parts['header_color'] = EmailTemplate::color($parts['header_color'] ?? '', $statusColor);

        return EmailTemplate::shell(
            $parts,
            self::summaryChip($orderNo, $stage, $amountLabel, $total, $parts['header_color']),
        );
    }

    /**
     * The order/refund summary chip: code-owned, never editable, always present.
     */
    private static function summaryChip(
        string $orderNo,
        string $stage,
        string $amountLabel,
        string $total,
        string $color,
    ): string {
        $orderNo = htmlspecialchars($orderNo, ENT_QUOTES);
        $stageHtml = htmlspecialchars($stage, ENT_QUOTES);
        $amountLabel = htmlspecialchars($amountLabel, ENT_QUOTES);
        $total = htmlspecialchars($total, ENT_QUOTES);

        return <<<HTML
<!-- Order summary chip -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fb;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:24px;">
              <tr>
                <td style="padding:18px 22px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:13px;color:#718096;padding-bottom:8px;">Order Number</td>
                      <td align="right" style="font-size:13px;font-weight:700;color:#1a202c;padding-bottom:8px;">{$orderNo}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#718096;padding-bottom:8px;">Status</td>
                      <td align="right" style="font-size:13px;font-weight:700;color:{$color};padding-bottom:8px;">{$stageHtml}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#718096;">{$amountLabel}</td>
                      <td align="right" style="font-size:14px;font-weight:700;color:#1a202c;">{$total}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
HTML;
    }
}
