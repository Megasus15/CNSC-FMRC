# Order refund restrictions and historical review

The unrestricted refund action on active orders is removed. Payment details, provider checks, cash collection, cancellation handling, and approved return refunds remain available through their existing workflows.

## Allowed workflows

- Cancelled/rejected paid orders: use the existing online or manual refund workflow. An unpaid rejected request has nothing to refund.
- Completed orders: use an approved refund resolution, confirm receipt/inspection, and refund through the linked return case.
- Active orders: no general refund of the valid order payment. Resolve an eligible cancellation/rejection first.
- Verified extra receipt: only Admin may return the extra payment. The valid order payment must remain fully covered. Its payment status, inventory, preparation, shipment, and collection are preserved.

Creation, authorization, and retry all recheck eligibility. Old requested refunds on active orders cannot bypass the rule; already-submitted provider refunds continue reconciliation and keep their financial evidence.

## Historical refunded orders

Active catalog orders marked fully refunded show **Refunded — FMRC review required** in Orders Directory and Order Details. Customers find them under All with their refund history, rather than in the working payment/preparation tabs. Custom orders continue through their existing closure/re-quotation workflow.

Only Admin can use **Close refunded order**. It requires a reason, an explicit non-fulfillment acknowledgment, and a usable quantity for every product, including zero. Recorded shipment/collection evidence, unresolved cancellation, or unconfirmed refund evidence blocks closure. A recorded courier booking or tracking number also requires reconciliation before this shortcut is available.

The action closes the order as Cancelled without creating a customer cancellation request or sending another refund. Stock restoration is limited to deducted/reserved quantities not previously restored. Missing/unreserved/already-released stock is eligible for zero restoration. Order, inventory, and audit updates commit together; an identical retry returns the saved result without changing stock twice.

No historical order or stock is changed automatically. Existing payment amounts, references, refund records, and courier evidence are retained.

## Interfaces

- Existing payment-review responses add `refund_action` for each payment and receipt, including `allowed`, `reason`, `kind`, and `label`. Receipts also expose `refundable_centavos` to authenticated operators.
- Existing refund responses in the review workspace add `actions.approve`, `actions.retry`, and `refund_kind`. The backend remains authoritative even if a stale UI still displays an old button.
- Authenticated order responses add `refund_review`. Operator detail responses include `stock_items` with `product_id`, `quantity`, and `max_restore`; customers receive no stock-review manifest.
- `POST /api/admin/orders/{order}/close-refunded` is Admin-only and accepts:

```json
{
  "reason": "Refund verified; order was never fulfilled.",
  "non_fulfillment_confirmed": true,
  "stock_items": [{"product_id": 123, "quantity": 1}]
}
```

Send every product once, including quantities of zero. An empty array is valid only when no stock lines exist. Conflicting repeats return 409. The closure audit uses existing order fields and tracking-event metadata.

## Deployment

Commit and push the matching backend, canonical frontend, tests, and this document through the existing Git deployment workflow. Changed assets use **2026.1113.5**. Deploy the backend guards before or together with the matching frontend; clear Laravel caches from the deployed backend with `php artisan optimize:clear`.

This update adds no migration or Composer dependency. The original order-review migration must already be installed if that feature is in use. No ZIP delivery or data-repair command is needed.

## Verification boundaries

Local tests cover operator roles, active/closed/completed states, stale authorization and retries, return refunds, extra receipt recovery, provider reconciliation, customer tabs/counters, stock bounds, closure rollback, and repeated requests. Browser fixtures cover the shared Admin/Staff dialogs, failure recovery, global feedback, keyboard controls, responsive widths, and dark mode.

The affected backend suite passed **279 tests / 3,469 assertions**. Shared payment/refund unit checks passed **35 tests**. Review/closure, customer payment, approval-gate, custom-return, stable-dialog, and guided fulfillment browser scenarios passed with isolated API fixtures. Screenshots were inspected at desktop and phone sizes; external CDN font/icon delivery remains a hosted check.

After deployment, verify payment details on an active order have no unrestricted refund action; cancellation and return refunds still follow their proper workflows; and historical refunded records are flagged. Review real records before any closure or stock adjustment. Hosted migration state, actual mail delivery, real provider transactions, and parallel production-database locking are separate from local fixture tests.
