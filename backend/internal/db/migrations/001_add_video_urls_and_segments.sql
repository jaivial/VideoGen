-- migrations/001_add_video_urls_and_segments.sql
-- Add missing columns to videos_requested table

ALTER TABLE videos_requested ADD COLUMN bunny_video_url VARCHAR(512);
ALTER TABLE videos_requested ADD COLUMN bunny_audio_url VARCHAR(512);
ALTER TABLE videos_requested ADD COLUMN caption_segments JSON;
ALTER TABLE videos_requested ADD COLUMN error_message TEXT;
