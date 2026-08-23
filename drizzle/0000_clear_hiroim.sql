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
CREATE TABLE `home_base` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`cwa_location_name` text NOT NULL,
	`max_drive_minutes` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `places` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local' NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`address` text NOT NULL,
	`drive_minutes` integer NOT NULL,
	`parking` text NOT NULL,
	`energy_burn` integer NOT NULL,
	`typical_duration_min` integer NOT NULL,
	`best_time_slots` text DEFAULT '[]' NOT NULL,
	`age_range` text NOT NULL,
	`sweet_spot_age` text,
	`indoor` text NOT NULL,
	`shade_level` integer NOT NULL,
	`stroller_friendly` integer NOT NULL,
	`has_changing_table` integer NOT NULL,
	`has_nursing_space` integer NOT NULL,
	`has_food_on_site` integer NOT NULL,
	`has_water_play` integer NOT NULL,
	`needs_reservation` integer NOT NULL,
	`quiet_hours` text,
	`crowd_level` text NOT NULL,
	`cost_per_family` integer,
	`indoor_backup_place_ids` text DEFAULT '[]' NOT NULL,
	`personal_rating` integer,
	`notes` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`field_sources` text DEFAULT '{}' NOT NULL,
	`last_verified_at` text
);
--> statement-breakpoint
CREATE TABLE `visits` (
	`id` text PRIMARY KEY NOT NULL,
	`place_id` text NOT NULL,
	`child_ids` text DEFAULT '[]' NOT NULL,
	`date` text NOT NULL,
	`arrived_at` text NOT NULL,
	`left_at` text NOT NULL,
	`child_ages_months` text DEFAULT '[]' NOT NULL,
	`weather_snapshot` text NOT NULL,
	`outcome` integer NOT NULL,
	`actual_energy_burn` integer NOT NULL,
	`nap_happened` integer NOT NULL,
	`meltdown` integer NOT NULL,
	`would_return` integer NOT NULL,
	`notes` text,
	`photos` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action
);
