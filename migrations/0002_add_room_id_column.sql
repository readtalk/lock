cat > migrations/0002_add_room_id.sql << 'EOF'
-- Migration number: 0002 	 2025-12-28
ALTER TABLE user ADD COLUMN room_id TEXT;
EOF
