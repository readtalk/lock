-- Migration number: 0002 	 2025-01-15
ALTER TABLE user ADD COLUMN room_id TEXT UNIQUE;
