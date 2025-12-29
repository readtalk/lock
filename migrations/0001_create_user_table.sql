-- Migration number: 0001 	 2024-12-27T22:04:18.794Z
CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    email TEXT UNIQUE NOT NULL,
    room_id TEXT UNIQUE,
    nama TEXT,
    username TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
