-- Migration number: 0002 	 2025-01-15T00:00:00.000Z
ALTER TABLE user ADD COLUMN room_id TEXT UNIQUE;
-- Optional: Buat index untuk pencarian cepat jika perlu
-- CREATE INDEX idx_user_room_id ON user(room_id);
