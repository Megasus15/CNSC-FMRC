# FMRC Help and connected support conversations

FMRC Help has two separate functions. **Quick help** searches Admin-approved
English and Filipino answers, aliases and keywords. It is a built-in guide,
not generative AI: it has no external AI API, subscriptions or model-generated
answers. Greetings use the editable welcome message; uncertain questions show
related topics and the option to contact the team.

**Message FMRC** is private, signed-in, text-only communication with the real
FMRC team. The Contact form creates a conversation in this same inbox. Replies
appear in the widget and use existing account notifications. No payment,
refund, order or appointment action is performed by the assistant.

## Customer controls

- Read and resume conversations from the widget across Customer pages and PWA
  routes. While another dialog or any booking step is open, the entire widget is
  hidden and cannot be clicked or focused. It returns after the last dialog
  closes, preserving drafts. The website keeps the selected conversation
  reference, not a local copy of its messages.
- The launcher starts as a labelled, accessible circular icon; hover or keyboard
  focus reveals its name. It shares Back to top's column and moves above the
  arrow while it is visible. Left placement, mobile keyboards and reduced motion
  remain supported. Conversation headings and history do not expose database IDs.
- End chat after confirmation. The history remains available; reopening is an
  explicit action before another message can be sent.
- Remove one or selected ended conversations from personal history. Active chats
  must first be ended. FMRC retains its inquiry records; the customer UI explains
  this distinction before removal.
- Customer-facing human replies always show **FMRC Team** with the FMRC logo.
  Individual operator names remain in the operator view for accountability.
- Failed sends keep the draft and retry identifier. The server prevents duplicate
  accepted submissions, enforces account ownership and renders messages as text.

## Operator and Admin controls

Both roles handle replies, read state and resolution in **Customer Inquiries**.
The existing permanent inquiry deletion controls retain their permissions and
confirmation, including deletion of the conversation's entries.

An operator enables **Available for chat** when able to reply and keeps the inbox
open. It can be in another tab. Presence heartbeats renew a 60-second lease;
closed, disconnected or browser-suspended tabs eventually stop advertising
availability. The server also checks the actual session deadline. Heartbeats do
not reset inactivity or scheduled logout. Away status never prevents a customer
from leaving a message.

Only Admins see **Support Settings**, and the server enforces that restriction.
The editor controls appearance, welcome/away/no-match wording and approved
bilingual answers. Suggested topics and helpful destinations use labelled
checkboxes with counts and limits; there are no Shift/Ctrl selection lists.
Settings save atomically with revision checks and preserve failed-save drafts.

The **Enable Quick help (built-in answers)** switch controls automated answers
only. When disabled, Quick help explains that it is paused and offers messaging.
It does not disable human conversations. Suggested topics are recommendations,
not the only answers that the matcher can find.

## Storage and rollout

The additive migration is
`2027_01_19_000000_add_customer_support_conversations.php`. It extends existing
inquiry roots, creates message/knowledge/presence storage and carries original
inquiries into conversation history. Historical ownership, text, dates and
resolution states are preserved; email matches never claim an unowned inquiry.

For the initial release, back up the production database and run from the
deployed Laravel `backend` directory containing `artisan`:

```bash
php artisan migrate --path=database/migrations/2027_01_19_000000_add_customer_support_conversations.php --force
php artisan optimize:clear
```

The greeting, presentation, checkbox and team-name follow-ups need **no additional
migration**. Deploy the changed code and refresh Customer and operator pages.
Affected support assets use cache version `2026.1117.3`.

The operator heading keeps Refresh at the right edge. The separate **FMRC
Support** card contains personal chat availability and Admin-only Support
Settings. The image picker uses a preview and labelled Choose Image action;
Use defaults stays at the left of the settings footer. These changes reuse the
existing upload, save/discard, presence and conversation endpoints.

Read-only activation checks:

- `GET /api/support/availability`: `installed: true` confirms setup;
  `available: false` means no valid operator presence, not an installation error.
- `GET /api/support/assistant`: publishes approved answers and the Quick help
  enabled preference; disabled answers and operator identities are excluded.
- Check the Contact form, welcome/greeting, an ambiguous question and the same
  conversation in Customer and operator views. Use designated test accounts for
  new messages, end/reopen and history actions; do not mutate unrelated records.

## Verification

Focused PHP tests cover ownership, retry safety, read cursors, end/reopen,
single/bulk history removal, preserved historical inquiries, settings security,
presence/session limits and customer-facing team identity.

Browser tests use isolated HTTP fixtures and cover Customer/Admin/Staff at 320,
390, 768, 1024 and 1440px; short landscape and 200% equivalent text layouts;
light/dark operator themes; all five booking screens; safe text; failed saves;
checkbox limits; greeting-only replies; paused-guide versus offline-team states;
and connected background-tab presence. These tests do not establish real
production message delivery or submit actual orders, payments or refunds.

```bash
node --test --test-concurrency=1 backend/tests/Frontend/support-assistant.test.cjs backend/tests/Frontend/customer-support.browser.cjs backend/tests/Frontend/inquiries-ui.browser.cjs backend/tests/Frontend/customer-notifications.browser.cjs
```

From `backend`, run `php artisan test --filter=CustomerSupportTest` using the
project's working PHP runtime. Existing session and notification regression tests
remain relevant. Preview images under `output` are local fixture screenshots.
