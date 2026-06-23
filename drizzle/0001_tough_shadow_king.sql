CREATE TYPE "public"."system_role" AS ENUM('user', 'superadmin');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "system_role" "system_role" DEFAULT 'user' NOT NULL;