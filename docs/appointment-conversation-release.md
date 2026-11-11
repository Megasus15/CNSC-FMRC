# Appointment Conversation release

Deploy the backend and versioned Customer/Admin/Staff shared assets together. This change needs no database migration or provider configuration. PWA pages use these same canonical assets; the offline worker does not cache conversations.

Conversation uses the existing authenticated message and file endpoints. Messages may contain text, files, or both, with the existing five-file / 50 MB limit and a 5,000-character message limit. Responses include sender IDs, a confirmed message ID on submission, and the viewer's own client request key for retry recovery. Other participants' request keys are not exposed.

On an owned custom-product appointment, verify Customer, Admin, and Staff readback:

1. Open Conversation. Customer names, the shared **FMRC team** label and official logo, Philippine timestamps, date dividers, opposite-side message bubbles, and private downloads should be readable on phone and desktop. Avatars belong beside the last bubble in each consecutive group; operator audit identities remain stored unchanged.
2. Send a message, then a file without text. Desktop Enter sends; Shift+Enter and phone keyboards add a line. No success popup should interrupt chatting.
3. Keep text and a selected attachment in the composer while another account replies. The reply appears without clearing the draft, moving keyboard focus, or replacing the form.
4. Read earlier messages while another account replies. The view stays in place and **New messages** returns to the latest reply.
5. Disconnect while sending. Entries remain. **Retry** checks whether the original request was stored before resending its exact payload/key. A newer draft is retained. Connection failures show **Updates paused. Reconnecting…**.
6. Switch between Overview, Quotation, and Conversation and resize the screen. The composer and existing appointment controls remain usable without background-page scrolling. Leave a conversation at an earlier message through repeated polls and surrounding appointment updates: the inner chat and outer modal must keep their positions. Customer Refresh must preserve that position too.

Quotation cards and workflows are unchanged. Message callbacks do not perform quotation approval, order, payment, refund, production, or courier actions. Local browser fixtures and backend regressions do not establish hosted account-to-account readback; complete the checks above after deployment.
