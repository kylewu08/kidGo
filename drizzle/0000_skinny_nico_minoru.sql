CREATE TABLE `calendar_days` (
	`date` text PRIMARY KEY NOT NULL,
	`day_type` text NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `category_preferences` (
	`category` text PRIMARY KEY NOT NULL,
	`learned_weight` real DEFAULT 0 NOT NULL,
	`manual_weight` real,
	`sample_count` integer DEFAULT 0 NOT NULL,
	`last_updated_at` text
);
--> statement-breakpoint
CREATE TABLE `children` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`birth_date` text NOT NULL,
	`nap_stage` text NOT NULL,
	`wake_time` text NOT NULL,
	`nap_windows` text DEFAULT '[]' NOT NULL,
	`bed_time` text NOT NULL,
	`mobility` text NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `context_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`raw_input` text NOT NULL,
	`overrides` text DEFAULT '{}' NOT NULL,
	`explanation` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `family_preferences` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`outdoor_tendency` integer DEFAULT 0 NOT NULL,
	`max_parent_effort` integer NOT NULL,
	`requires_meal` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `home_base` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`cwa_county_name` text NOT NULL,
	`cwa_location_name` text NOT NULL,
	`max_drive_minutes` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `places` (
	`id` text PRIMARY KEY NOT NULL,
	`source_dataset` text NOT NULL,
	`source_id` text NOT NULL,
	`imported_at` text,
	`source_updated_at` text,
	`source_removed_at` text,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`parking_search_minutes` integer DEFAULT 5 NOT NULL,
	`uses_freeway` integer DEFAULT false NOT NULL,
	`energy_burn` integer NOT NULL,
	`typical_duration_minutes` integer NOT NULL,
	`best_time_slots` text DEFAULT '[]' NOT NULL,
	`facility_age_bands` text,
	`suitable_age_months` text NOT NULL,
	`runnable_space` integer NOT NULL,
	`safety_enclosure` integer NOT NULL,
	`parent_effort` integer NOT NULL,
	`indoor_type` text NOT NULL,
	`has_air_conditioning` integer NOT NULL,
	`shade_level` integer NOT NULL,
	`stroller_friendly` integer NOT NULL,
	`field_sources` text DEFAULT '{}' NOT NULL,
	`data_suspect` integer DEFAULT false NOT NULL,
	`data_suspect_reason` text,
	`last_verified_at` text,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE TABLE `route_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`place_id` text NOT NULL,
	`direction` text NOT NULL,
	`departure_at` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`fetched_at` text NOT NULL,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`sent_at` text NOT NULL,
	`kind` text NOT NULL,
	`primary_place_id` text,
	`backup_place_id` text,
	`explore_place_id` text,
	`suggested_departure` text,
	`suggested_return` text,
	`no_outing_reason` text,
	`context_override_id` text,
	`response` text,
	`responded_at` text,
	`went_elsewhere_place_id` text,
	`response_note` text,
	FOREIGN KEY (`primary_place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`backup_place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`explore_place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`context_override_id`) REFERENCES `context_overrides`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`went_elsewhere_place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `visits` (
	`id` text PRIMARY KEY NOT NULL,
	`place_id` text NOT NULL,
	`suggestion_id` text,
	`date` text NOT NULL,
	`child_ids` text DEFAULT '[]' NOT NULL,
	`child_ages_months` text DEFAULT '[]' NOT NULL,
	`duration_feeling` text NOT NULL,
	`outcome` text NOT NULL,
	`arrived_at` text,
	`left_at` text,
	`actual_drive_minutes` integer,
	`weather_snapshot` text,
	`context_override_id` text,
	`notes` text,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`suggestion_id`) REFERENCES `suggestions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`context_override_id`) REFERENCES `context_overrides`(`id`) ON UPDATE no action ON DELETE no action
);
