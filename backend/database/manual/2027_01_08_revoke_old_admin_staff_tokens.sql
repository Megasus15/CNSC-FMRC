-- Import with phpMyAdmin into the SAME live Laravel database only AFTER the
-- complete portal-security code upload and cache clear. Keep outside public_html.
-- One-time rollover: existing Admin/Staff bearer tokens were issued before the
-- new deadlines and must sign in again. Customer tokens are left untouched.
START TRANSACTION;
SELECT COUNT(*) AS admin_staff_tokens_to_revoke
FROM `personal_access_tokens` AS pat
INNER JOIN `users` AS u ON u.`id` = pat.`tokenable_id`
WHERE pat.`tokenable_type` = CONCAT('App', CHAR(92), 'Models', CHAR(92), 'User')
  AND u.`role` IN ('admin', 'staff');
DELETE pat FROM `personal_access_tokens` AS pat
INNER JOIN `users` AS u ON u.`id` = pat.`tokenable_id`
WHERE pat.`tokenable_type` = CONCAT('App', CHAR(92), 'Models', CHAR(92), 'User')
  AND u.`role` IN ('admin', 'staff');
SET @fmrc_revoked = ROW_COUNT();
COMMIT;
SELECT @fmrc_revoked AS admin_staff_tokens_revoked,
  'NOT TARGETED' AS customer_tokens;
