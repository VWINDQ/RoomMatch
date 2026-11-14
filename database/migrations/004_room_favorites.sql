CREATE TABLE IF NOT EXISTS ROOM_FAVORITE (
    user_id INTEGER NOT NULL,
    room_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (user_id, room_id),
    FOREIGN KEY (user_id) REFERENCES USER(user_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES ROOM(room_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS room_favorite_room
    ON ROOM_FAVORITE(room_id);