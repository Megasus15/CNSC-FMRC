<?php

namespace App\Services;

use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

final class CommercePolicy
{
    public static function settings(bool $lock = false): object
    {
        abort_unless(Schema::hasTable('commerce_policy_settings') && Schema::hasColumns('orders', ['accepted_policy_version', 'accepted_policy_text', 'policy_accepted_at']), 503,
            'Transaction policies are temporarily unavailable. Please try again later.');
        $query = DB::table('commerce_policy_settings')->where('id', 1);

        return ($lock ? $query->lockForUpdate() : $query)->firstOrFail();
    }

    public static function published(?string $version = null): ?array
    {
        $version ??= self::settings()->published_version;
        if (! $version) {
            return null;
        }
        $policy = DB::table('commerce_policies')->where('version', $version)->first();

        return $policy ? (array) $policy : null;
    }

    public static function accept(array $input): array
    {
        $settings = self::settings(true);
        $policy = self::published($settings->published_version);
        if (! $policy || ! in_array($input['policy_accepted'] ?? false, [true, 1, '1', 'yes', 'on'], true)
            || ($input['policy_version'] ?? null) !== $settings->published_version) {
            throw new HttpResponseException(response()->json(['code' => 'policy_changed',
                'message' => $policy ? 'The transaction terms and refund policy have changed. Review and accept the current policy before ordering.'
                    : 'The transaction terms and refund policy are not yet available. Please contact FMRC before ordering.',
                'policy' => $policy], 409));
        }

        return $policy;
    }

    public static function draft(): array
    {
        return ['title' => 'FMRC Transaction Terms and Refund Policy',
            'terms_text' => "Ordering and payment\nReview the product description, quantity, customization details, fulfillment method, shipping fee, and payable total before placing an order. Online payments are confirmed through the payment provider. Cash is collected at pickup or delivery. An order remains subject to FMRC review and acceptance.\n\nDelivery and pickup\nDelivery dates are estimates based on preparation, transit, and the published working calendar. FMRC will communicate material changes. Provide complete, accurate recipient details and contact FMRC promptly if a correction is needed. Pickup orders are collected at FMRC when marked ready.\n\nCancellations and custom products\nUse the cancellation action in My Orders while it is available. Contact FMRC if production or preparation has begun. For custom products, confirm the agreed design, materials, dimensions, and specifications before fabrication. A request to change an approved design or cancel work already performed will be reviewed individually. This does not remove remedies for defective or nonconforming goods.\n\nQuestions and assistance\nKeep your order number and proof of purchase. Contact FMRC through the Contact page or My Orders for transaction, delivery, cancellation, or return assistance.",
            'refund_text' => "Eligible concerns\nContact FMRC if an item is defective, damaged, incomplete, different from the ordered item, or does not meet the agreed specifications. Appropriate remedies may include repair, replacement, refund, or another remedy available under applicable Philippine law.\n\nRequesting a review\nOpen My Orders and use Return / Refund when available. Identify the affected item, explain the concern, and provide relevant photographs or other supporting information. Please report concerns promptly. If the online request window has closed, contact FMRC directly; an online time limit does not remove applicable consumer rights.\n\nCustom products and change of mind\nCustomized goods are reviewed against the design and specifications approved for production. Change-of-mind requests and buyer-caused damage are assessed separately from defects or failure to meet the agreed specifications. Customization does not create a blanket exemption from applicable consumer remedies.\n\nReturning an item\nWait for FMRC's return instructions so the item can be assessed safely and sent to the correct location. Keep the item and its relevant accessories available for inspection. For an eligible defect or nonconformity attributable to the merchant, the return arrangements must not impose a return cost on the consumer where applicable law requires this.\n\nShipping fees\nFMRC will explain how the original shipping fee and any return shipping are treated in the written resolution. Charges connected to an eligible merchant-responsible defect or nonconformity are assessed consistently with applicable law. Change-of-mind arrangements require separate agreement; no additional charge should be assumed before FMRC confirms it.\n\nRefund processing\nAn approved refund is processed through the original payment channel where supported. FMRC will explain any alternative arrangement needed for cash payments. Approval or a processing notice does not mean the funds have been returned. A provider refund is complete only when the payment provider confirms completion. Processing times depend on the payment provider and receiving financial institution; FMRC will share the available status and reference.\n\nYour rights\nThis policy does not restrict remedies, warranties, or rights provided under applicable Philippine consumer law. Contact FMRC if a proposed resolution does not address your concern."];
    }
}
