CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"conversation_id" uuid,
	"question" text NOT NULL,
	"top_score" real,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "doc_chunks" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "doc_chunks" ADD COLUMN "chunk_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "doc_chunks" ADD COLUMN "scope" varchar(20) DEFAULT 'kb' NOT NULL;--> statement-breakpoint
ALTER TABLE "doc_chunks" ADD COLUMN "session_id" varchar(255);--> statement-breakpoint
ALTER TABLE "doc_chunks" ADD COLUMN "embedding" jsonb;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "scope" varchar(20) DEFAULT 'kb' NOT NULL;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "session_id" varchar(255);--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "filename" text;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "file_type" varchar(20);--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "chunk_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_chunks_scope_session_idx" ON "doc_chunks" USING btree ("scope","session_id");--> statement-breakpoint
CREATE INDEX "docs_scope_session_idx" ON "docs" USING btree ("scope","session_id");