CREATE TABLE `client_supplier_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`supplier_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `clients` ADD `website` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `contact_person` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `bank_account_number` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `beneficiary_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `bank_address` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `swift_code` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `ifsc_code` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `commission_earned` real DEFAULT 0 NOT NULL;