ALTER TABLE `orders` ADD `supplier_id` integer REFERENCES clients(id);--> statement-breakpoint
ALTER TABLE `orders` ADD `purchase_price` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `sale_price` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `commission_percent` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `purchase_currency` text DEFAULT 'RUB' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `sale_currency` text DEFAULT 'RUB' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `purchase_invoice_details` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `sales_invoice_details` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `order_id` integer REFERENCES orders(id);
