CREATE TABLE "action_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"persona" text DEFAULT 'ulysse' NOT NULL,
	"action_type" text NOT NULL,
	"action_category" text NOT NULL,
	"input_payload" jsonb,
	"output_payload" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"effectiveness_score" integer,
	"coherence_score" integer,
	"precision_score" integer,
	"overall_score" integer,
	"validation_notes" text,
	"error_message" text,
	"execution_time_ms" integer,
	"was_rolled_back" boolean DEFAULT false NOT NULL,
	"related_action_id" integer,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "active_navigation" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"route_id" integer,
	"current_waypoint_index" integer DEFAULT 0 NOT NULL,
	"current_instruction_index" integer DEFAULT 0 NOT NULL,
	"waypoints_data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"instructions_data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"profile" text DEFAULT 'driving' NOT NULL,
	"total_distance" integer,
	"total_duration" integer,
	"remaining_distance" integer,
	"remaining_duration" integer,
	"last_known_lat" text,
	"last_known_lng" text,
	"is_off_route" boolean DEFAULT false NOT NULL,
	"off_route_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "active_navigation_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "agentmail_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"attachment_id" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"local_path" text,
	"url" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agentmail_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"message_id" text NOT NULL,
	"thread_id" text,
	"inbox_id" text NOT NULL,
	"from" text NOT NULL,
	"to" text[] DEFAULT '{}',
	"cc" text[] DEFAULT '{}',
	"subject" text,
	"body" text,
	"html_body" text,
	"snippet" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"is_processed" boolean DEFAULT false NOT NULL,
	"category" text,
	"priority" text DEFAULT 'normal',
	"sentiment" text,
	"summary" text,
	"suggested_action" text,
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"received_at" timestamp,
	"cached_at" timestamp DEFAULT now(),
	CONSTRAINT "agentmail_messages_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "ambiance_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_preset" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"visual_mode" text DEFAULT 'orb' NOT NULL,
	"orb_color" text DEFAULT '#6366f1',
	"orb_intensity" integer DEFAULT 50,
	"background_gradient" text,
	"auto_speak" boolean DEFAULT true NOT NULL,
	"voice_speed" integer DEFAULT 100,
	"voice_pitch" integer DEFAULT 100,
	"ambient_sound" text,
	"ambient_volume" integer DEFAULT 30,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"last_used_at" timestamp DEFAULT now(),
	"is_revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "approved_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"approved_by" integer NOT NULL,
	"access_level" text DEFAULT 'basic' NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "capability_changelog" (
	"id" serial PRIMARY KEY NOT NULL,
	"capability_id" integer,
	"change_type" text NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb,
	"reason" text,
	"version" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "capability_registry" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"marker" text,
	"is_available" boolean DEFAULT true NOT NULL,
	"last_verified" timestamp DEFAULT now(),
	"failure_reason" text,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"dependencies" text[] DEFAULT '{}',
	"usage_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_used" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"modality" text DEFAULT 'text' NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"is_edited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "conversation_threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" text,
	"summary" text,
	"origin_device" text,
	"last_device" text,
	"message_count" integer DEFAULT 0 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"tags" text[] DEFAULT '{}',
	"last_message_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "daily_summaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"date" text NOT NULL,
	"summary" text NOT NULL,
	"highlights" jsonb DEFAULT '[]'::jsonb,
	"tasks_completed" integer DEFAULT 0,
	"conversations_count" integer DEFAULT 0,
	"emails_summary" text,
	"weather_info" jsonb DEFAULT '{}'::jsonb,
	"generated_at" timestamp DEFAULT now(),
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"device_name" text NOT NULL,
	"device_type" text DEFAULT 'unknown' NOT NULL,
	"device_identifier" text NOT NULL,
	"last_seen" timestamp DEFAULT now(),
	"last_ip" text,
	"user_agent" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"push_token" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "devices_device_identifier_unique" UNIQUE("device_identifier")
);
--> statement-breakpoint
CREATE TABLE "diagnostic_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"domain" text NOT NULL,
	"component" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"recommendation" text,
	"self_healing_action" text,
	"can_auto_fix" boolean DEFAULT false NOT NULL,
	"was_auto_fixed" boolean DEFAULT false NOT NULL,
	"fix_result" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "diagnostic_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"run_type" text NOT NULL,
	"triggered_by" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"system_health" jsonb,
	"interface_health" jsonb,
	"communication_health" jsonb,
	"overall_score" integer,
	"findings_count" integer DEFAULT 0 NOT NULL,
	"critical_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"info_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"gmail_id" text NOT NULL,
	"thread_id" text,
	"from" text NOT NULL,
	"to" text,
	"subject" text,
	"snippet" text,
	"body" text,
	"labels" text[] DEFAULT '{}',
	"is_read" boolean DEFAULT false NOT NULL,
	"is_starred" boolean DEFAULT false NOT NULL,
	"has_attachments" boolean DEFAULT false NOT NULL,
	"received_at" timestamp,
	"cached_at" timestamp DEFAULT now(),
	CONSTRAINT "email_messages_gmail_id_unique" UNIQUE("gmail_id")
);
--> statement-breakpoint
CREATE TABLE "face_descriptors" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"descriptor" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "geofence_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"geofence_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"latitude" text NOT NULL,
	"longitude" text NOT NULL,
	"accuracy" integer,
	"action_executed" boolean DEFAULT false NOT NULL,
	"action_result" text,
	"dwell_time_minutes" integer,
	"triggered_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "geofences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"latitude" text NOT NULL,
	"longitude" text NOT NULL,
	"radius_meters" integer DEFAULT 100 NOT NULL,
	"type" text DEFAULT 'circle' NOT NULL,
	"trigger_on" text DEFAULT 'both' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"linked_action" text,
	"linked_action_id" integer,
	"action_payload" jsonb,
	"cooldown_minutes" integer DEFAULT 60 NOT NULL,
	"last_triggered_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "gmail_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_type" text DEFAULT 'Bearer' NOT NULL,
	"scope" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "gmail_tokens_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "homework_execution" (
	"id" serial PRIMARY KEY NOT NULL,
	"homework_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"triggered_by" text DEFAULT 'auto' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"result_summary" text,
	"artifacts" jsonb DEFAULT '{}'::jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "location_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_id" integer,
	"latitude" text NOT NULL,
	"longitude" text NOT NULL,
	"altitude" text,
	"accuracy" integer,
	"altitude_accuracy" integer,
	"heading" integer,
	"speed" integer,
	"context" text,
	"address" text,
	"city" text,
	"country" text,
	"metadata" jsonb,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "location_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"feature" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"accuracy" text DEFAULT 'balanced' NOT NULL,
	"retention_days" integer DEFAULT 30 NOT NULL,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "location_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"device_id" text NOT NULL,
	"device_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"consent_granted" boolean DEFAULT false NOT NULL,
	"consent_timestamp" timestamp,
	"accuracy_mode" text DEFAULT 'balanced' NOT NULL,
	"update_interval_ms" integer DEFAULT 600000 NOT NULL,
	"background_enabled" boolean DEFAULT false NOT NULL,
	"last_location_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "media_library" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"filename" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"storage_path" text NOT NULL,
	"thumbnail_path" text,
	"duration" integer,
	"width" integer,
	"height" integer,
	"description" text,
	"tags" text[] DEFAULT '{}',
	"is_favorite" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"project_id" integer,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "project_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"project_id" integer,
	"project_name" text NOT NULL,
	"summary" text,
	"tech_stack" text[] DEFAULT '{}',
	"goals" text[] DEFAULT '{}',
	"decisions" jsonb DEFAULT '[]'::jsonb,
	"challenges" text[] DEFAULT '{}',
	"next_steps" text[] DEFAULT '{}',
	"status" text DEFAULT 'active',
	"last_discussed" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "route_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"saved_route_id" integer,
	"name" text,
	"profile" text DEFAULT 'driving' NOT NULL,
	"start_address" text,
	"end_address" text,
	"waypoints_data" jsonb DEFAULT '[]'::jsonb,
	"planned_distance" integer,
	"planned_duration" integer,
	"actual_distance" integer,
	"actual_duration" integer,
	"deviation_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"status" text DEFAULT 'completed' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "route_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"default_profile" text DEFAULT 'driving' NOT NULL,
	"avoid_tolls" boolean DEFAULT false NOT NULL,
	"avoid_highways" boolean DEFAULT false NOT NULL,
	"avoid_ferries" boolean DEFAULT false NOT NULL,
	"optimize_order" boolean DEFAULT true NOT NULL,
	"show_alternatives" boolean DEFAULT false NOT NULL,
	"voice_guidance" boolean DEFAULT true NOT NULL,
	"auto_recalculate" boolean DEFAULT true NOT NULL,
	"deviation_threshold" integer DEFAULT 50 NOT NULL,
	"arrival_alert_distance" integer DEFAULT 200 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "route_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "route_waypoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"route_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"order_index" integer NOT NULL,
	"label" text NOT NULL,
	"latitude" text NOT NULL,
	"longitude" text NOT NULL,
	"address" text,
	"name" text,
	"estimated_arrival" timestamp,
	"estimated_duration" integer,
	"estimated_distance" integer,
	"is_current_location" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "saved_routes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"profile" text DEFAULT 'driving' NOT NULL,
	"total_distance" integer,
	"total_duration" integer,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"tags" text[] DEFAULT '{}',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"user_agent" text,
	"ip_address" text
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"priority" text DEFAULT 'medium',
	"due_date" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ulysse_charter" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"communication_style" text DEFAULT 'direct',
	"language" text DEFAULT 'fr',
	"response_length" text DEFAULT 'concise',
	"priority_domains" text[] DEFAULT '{}',
	"active_projects" jsonb DEFAULT '[]'::jsonb,
	"behavior_rules" jsonb DEFAULT '[]'::jsonb,
	"wake_word" text DEFAULT 'Ulysse',
	"voice_personality" text DEFAULT 'professional',
	"remember_conversations" boolean DEFAULT true NOT NULL,
	"context_retention_days" integer DEFAULT 30,
	"proactive_insights" boolean DEFAULT true NOT NULL,
	"daily_brief_enabled" boolean DEFAULT true NOT NULL,
	"daily_brief_time" text DEFAULT '08:00',
	"custom_instructions" text,
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "ulysse_charter_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "ulysse_code_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"version" text NOT NULL,
	"summary" text,
	"files_count" integer DEFAULT 0 NOT NULL,
	"total_size" integer DEFAULT 0 NOT NULL,
	"code_content" text NOT NULL,
	"structure_map" jsonb DEFAULT '{}'::jsonb,
	"key_components" text[] DEFAULT '{}',
	"analysis_notes" text,
	"last_analyzed_at" timestamp,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ulysse_diagnostics" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"reported_by" text DEFAULT 'ulysse' NOT NULL,
	"synced_to_owner" boolean DEFAULT false NOT NULL,
	"type" text NOT NULL,
	"component" text NOT NULL,
	"description" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'detected' NOT NULL,
	"root_cause" text,
	"solution" text,
	"proposed_upgrade" text,
	"user_impact" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ulysse_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"filename" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text DEFAULT 'application/pdf' NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"storage_path" text NOT NULL,
	"description" text,
	"generated_by" text DEFAULT 'ulysse' NOT NULL,
	"category" text DEFAULT 'generated' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ulysse_homework" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"recurrence" text DEFAULT 'none' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_date" timestamp,
	"completed_at" timestamp,
	"next_occurrence" timestamp,
	"last_executed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ulysse_improvements" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"originated_from" text DEFAULT 'ulysse' NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"user_feedback" text,
	"implemented_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ulysse_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"category" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"confidence" integer DEFAULT 50 NOT NULL,
	"source" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ulysse_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"experience" integer DEFAULT 0 NOT NULL,
	"unlocked_features" text[] DEFAULT '{}' NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb,
	"personality" text DEFAULT 'helpful',
	"last_interaction" timestamp DEFAULT now(),
	"total_conversations" integer DEFAULT 0 NOT NULL,
	"total_tasks_completed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "user_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"display_name" text,
	"role" text DEFAULT 'guest' NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "voice_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tts_voice" text DEFAULT 'onyx' NOT NULL,
	"tts_speed" integer DEFAULT 100 NOT NULL,
	"tts_pitch" text DEFAULT 'normal' NOT NULL,
	"tts_auto_speak" boolean DEFAULT true NOT NULL,
	"tts_max_length" integer DEFAULT 500,
	"stt_mode" text DEFAULT 'auto' NOT NULL,
	"stt_language" text DEFAULT 'fr-FR' NOT NULL,
	"stt_wake_word_enabled" boolean DEFAULT true NOT NULL,
	"prefer_browser_fallback" boolean DEFAULT false NOT NULL,
	"voice_feedback_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "voice_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "web_search_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"query" text NOT NULL,
	"topic" text,
	"key_findings" text[] DEFAULT '{}',
	"sources" jsonb DEFAULT '[]'::jsonb,
	"user_context" text,
	"learned_insights" text,
	"usefulness_score" integer DEFAULT 50,
	"times_referenced" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"reliability_score" integer DEFAULT 0,
	"tags" text[] DEFAULT '{}',
	"category" text,
	"domain" text,
	"confidence_score" integer DEFAULT 0,
	"expires_at" timestamp,
	"policy_report" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"device_type" text,
	"transports" text[],
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;