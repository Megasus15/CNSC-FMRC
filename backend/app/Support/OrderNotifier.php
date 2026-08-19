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
     */
    public static function buildEmailHtml(
        Order $order,
        string $headline,
        string $bodyText,
        string $statusColor = '#800000',
        ?string $statusOverride = null,
        ?string $amountOverride = null,
    ): string {
        $orderNo   = htmlspecialchars($order->order_no ?? "ORD-{$order->id}", ENT_QUOTES);
        $headline  = htmlspecialchars($headline, ENT_QUOTES);
        $bodyText  = nl2br(htmlspecialchars($bodyText, ENT_QUOTES));
        $total     = $amountOverride !== null
            ? htmlspecialchars($amountOverride, ENT_QUOTES)
            : '₱ ' . number_format((float) $order->total, 2, '.', ',');
        $stage     = $statusOverride ?? (self::STAGE_LABELS[$order->customer_stage] ?? 'Processing');
        $stageHtml = htmlspecialchars($stage, ENT_QUOTES);
        $amountLabel = $amountOverride !== null ? 'Refund Amount' : 'Total Amount';

        return <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>{$headline}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f6;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.09);max-width:600px;">
        <!-- Header -->
        <tr>
          <td style="background:{$statusColor};padding:28px 36px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;letter-spacing:.3px;">UCN-FMRC</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,.85);font-size:13px;">Fabrication &amp; Manufacturing Research Center</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 36px;">
            <h2 style="margin:0 0 12px;color:#1a202c;font-size:18px;">{$headline}</h2>
            <p style="margin:0 0 20px;color:#4a5568;font-size:14px;line-height:1.7;">{$bodyText}</p>
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
                      <td align="right" style="font-size:13px;font-weight:700;color:{$statusColor};padding-bottom:8px;">{$stageHtml}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#718096;">{$amountLabel}</td>
                      <td align="right" style="font-size:14px;font-weight:700;color:#1a202c;">{$total}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <p style="margin:0;color:#718096;font-size:12px;">You can track your order status by logging into your account at any time.</p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8f9fb;border-top:1px solid #e2e8f0;padding:18px 36px;text-align:center;">
            <p style="margin:0;color:#a0aec0;font-size:11px;">© 2025 UCN-FMRC · University of Camarines Norte</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
HTML;
    }
}
