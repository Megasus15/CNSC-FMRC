-- FMRC upgrade: generated from the four canonical Laravel migrations.
-- For the verified missing-schema state only. Back up the database first.
-- Import ONCE. If any statement fails, STOP and report the error; do not rerun blindly.
-- DDL commits implicitly. This is not a transaction or a courier activation.
USE `u799987132_ucn_fmrc_db`;
SET time_zone = '+00:00';
SET @portal_upgrade_batch = (SELECT COALESCE(MAX(batch), 0) + 1 FROM migrations);

-- 2026_11_02_000001_add_shipping_quotes_and_settings
create table `shipping_settings` (`id` tinyint unsigned not null, `revision` int unsigned not null default '0', `draft` json null, `published` json null, `published_version` char(36) null, `published_at` timestamp null, `published_by` bigint unsigned null, `created_at` timestamp null, `updated_at` timestamp null, primary key (`id`)) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;
insert into `shipping_settings` (`id`, `revision`, `created_at`, `updated_at`) values (1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
alter table `orders` add `shipping_fee` decimal(12, 2) null;
alter table `orders` add `shipping_quote` json null;
alter table `orders` add `estimated_delivery_from` date null;
alter table `orders` add `estimated_delivery_to` date null;
INSERT INTO migrations (migration, batch) SELECT '2026_11_02_000001_add_shipping_quotes_and_settings', @portal_upgrade_batch WHERE NOT EXISTS (SELECT 1 FROM migrations WHERE migration = '2026_11_02_000001_add_shipping_quotes_and_settings');

-- 2026_11_02_000002_add_transaction_policy_snapshots
create table `commerce_policies` (`version` char(36) not null, `title` varchar(180) not null, `terms_text` longtext not null, `refund_text` longtext not null, `published_by` bigint unsigned not null, `published_at` timestamp not null, primary key (`version`)) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;
create table `commerce_policy_settings` (`id` tinyint unsigned not null, `revision` int unsigned not null default '0', `draft` json null, `published_version` char(36) null, primary key (`id`)) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;
insert into `commerce_policy_settings` (`id`, `revision`) values (1, 0);
alter table `orders` add `accepted_policy_version` char(36) null;
alter table `orders` add `accepted_policy_text` json null;
alter table `orders` add `policy_accepted_at` timestamp null;
INSERT INTO migrations (migration, batch) SELECT '2026_11_02_000002_add_transaction_policy_snapshots', @portal_upgrade_batch WHERE NOT EXISTS (SELECT 1 FROM migrations WHERE migration = '2026_11_02_000002_add_transaction_policy_snapshots');

-- 2026_11_02_000003_add_courier_shipments
create table `courier_shipments` (`id` bigint unsigned not null auto_increment primary key, `order_id` bigint unsigned not null, `active_order_id` bigint unsigned null, `environment` varchar(20) not null, `reference` varchar(80) not null, `requested_tracking_number` varchar(40) not null, `tracking_number` varchar(100) null, `status` varchar(40) not null, `provider_status` varchar(160) null, `parcel` json not null, `booking_payload` json not null, `payload_hash` char(64) not null, `actual_booking_cost` decimal(12, 2) null, `created_by` bigint unsigned not null, `booked_at` timestamp null, `last_event_at` timestamp null, `last_error_code` varchar(80) null, `created_at` timestamp null, `updated_at` timestamp null) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;
alter table `courier_shipments` add constraint `courier_shipments_order_id_foreign` foreign key (`order_id`) references `orders` (`id`) on delete cascade;
alter table `courier_shipments` add unique `courier_shipments_environment_tracking_number_unique`(`environment`, `tracking_number`);
alter table `courier_shipments` add unique `courier_shipments_active_order_id_unique`(`active_order_id`);
alter table `courier_shipments` add unique `courier_shipments_reference_unique`(`reference`);
alter table `courier_shipments` add unique `courier_shipments_requested_tracking_number_unique`(`requested_tracking_number`);
create table `shipment_booking_attempts` (`id` bigint unsigned not null auto_increment primary key, `shipment_id` bigint unsigned not null, `request_key` char(36) not null, `actor_id` bigint unsigned null, `action` varchar(16) not null, `status` varchar(24) not null, `payload_hash` char(64) not null, `http_status` smallint unsigned null, `provider_code` varchar(80) null, `created_at` timestamp null, `updated_at` timestamp null) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;
alter table `shipment_booking_attempts` add constraint `shipment_booking_attempts_shipment_id_foreign` foreign key (`shipment_id`) references `courier_shipments` (`id`) on delete cascade;
alter table `shipment_booking_attempts` add unique `shipment_booking_attempts_request_key_unique`(`request_key`);
create table `courier_webhook_events` (`id` bigint unsigned not null auto_increment primary key, `event_key` char(64) not null, `shipment_id` bigint unsigned null, `tracking_number` varchar(100) not null, `reference` varchar(100) null, `status` varchar(160) not null, `source` varchar(20) not null default 'webhook', `created_by` bigint unsigned null, `location` varchar(200) null, `return_trip` tinyint(1) not null default '0', `occurred_at` timestamp not null, `received_at` timestamp not null) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;
alter table `courier_webhook_events` add constraint `courier_webhook_events_shipment_id_foreign` foreign key (`shipment_id`) references `courier_shipments` (`id`) on delete set null;
alter table `courier_webhook_events` add unique `courier_webhook_events_event_key_unique`(`event_key`);
alter table `orders` add `courier_history_version` bigint unsigned not null default '0';
INSERT INTO migrations (migration, batch) SELECT '2026_11_02_000003_add_courier_shipments', @portal_upgrade_batch WHERE NOT EXISTS (SELECT 1 FROM migrations WHERE migration = '2026_11_02_000003_add_courier_shipments');

-- 2026_11_02_000004_extend_appointment_workflows
alter table `appointments` add `appointment_method` varchar(20) null;
alter table `appointments` add `appointment_starts_at` timestamp null;
alter table `appointments` add `meeting_platform` varchar(60) null;
alter table `appointments` add `meeting_url` text null;
alter table `appointments` add `schedule_version` int unsigned not null default '0';
alter table `appointments` add index `appointments_user_id_appointment_date_index`(`user_id`, `appointment_date`);
create table `appointment_schedule_locks` (`id` int unsigned not null, primary key (`id`)) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;
insert into `appointment_schedule_locks` (`id`) values (1);
create table `appointment_attachments` (`id` bigint unsigned not null auto_increment primary key, `appointment_id` bigint unsigned not null, `name` varchar(255) not null, `path` varchar(255) not null, `mime` varchar(150) not null, `size` bigint unsigned not null, `created_at` timestamp not null) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;
alter table `appointment_attachments` add constraint `appointment_attachments_appointment_id_foreign` foreign key (`appointment_id`) references `appointments` (`id`) on delete cascade;
create table `appointment_schedule_history` (`id` bigint unsigned not null auto_increment primary key, `appointment_id` bigint unsigned not null, `actor_id` bigint unsigned null, `previous_date` date not null, `previous_time` varchar(60) not null, `appointment_date` date not null, `appointment_time` varchar(60) not null, `created_at` timestamp not null) default character set utf8mb4 collate 'utf8mb4_unicode_ci' engine = InnoDB;
alter table `appointment_schedule_history` add constraint `appointment_schedule_history_appointment_id_foreign` foreign key (`appointment_id`) references `appointments` (`id`) on delete cascade;
alter table `appointment_schedule_history` add constraint `appointment_schedule_history_actor_id_foreign` foreign key (`actor_id`) references `users` (`id`) on delete set null;
INSERT INTO migrations (migration, batch) SELECT '2026_11_02_000004_extend_appointment_workflows', @portal_upgrade_batch WHERE NOT EXISTS (SELECT 1 FROM migrations WHERE migration = '2026_11_02_000004_extend_appointment_workflows');

SELECT migration, batch FROM migrations WHERE migration LIKE '2026_11_02_00000%' ORDER BY migration;
SELECT id, revision, published_version FROM shipping_settings;
SELECT id, revision, published_version FROM commerce_policy_settings;
SELECT id FROM appointment_schedule_locks;
