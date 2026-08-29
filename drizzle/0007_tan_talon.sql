CREATE TABLE `invoice_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`direction` text DEFAULT 'sale' NOT NULL,
	`number_prefix` text DEFAULT 'INV' NOT NULL,
	`title` text DEFAULT 'INVOICE' NOT NULL,
	`seller_name` text NOT NULL,
	`seller_address` text DEFAULT '' NOT NULL,
	`seller_email` text DEFAULT '' NOT NULL,
	`seller_phone` text DEFAULT '' NOT NULL,
	`tax_registration` text DEFAULT '' NOT NULL,
	`bank_details` text DEFAULT '' NOT NULL,
	`payment_terms` text DEFAULT 'Payment due within 30 days' NOT NULL,
	`footer` text DEFAULT 'Thank you for your business' NOT NULL,
	`accent_color` text DEFAULT '#176f8f' NOT NULL,
	`custom_fields_json` text DEFAULT '[]' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `app_users` ADD `language` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_users` ADD `default_view` text DEFAULT 'overview' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_users` ADD `date_format` text DEFAULT 'DD/MM/YYYY' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_users` ADD `compact_mode` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `template_id` integer REFERENCES invoice_templates(id);--> statement-breakpoint
ALTER TABLE `invoices` ADD `tax_rate` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `tax_amount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `discount_amount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `shipping_amount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `reference` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `template_snapshot` text DEFAULT '{}' NOT NULL;