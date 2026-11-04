-- Additive extension: room-based MATCHES and all eight original tables are unchanged.
CREATE TABLE IF NOT EXISTS FRIEND_CONNECTION (
  connection_id INTEGER PRIMARY KEY,
  sender_id INTEGER NOT NULL REFERENCES USER(user_id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES USER(user_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  responded_at TEXT,
  CHECK (sender_id != recipient_id),
  CHECK ((status = 'pending' AND responded_at IS NULL) OR (status != 'pending' AND responded_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS friend_connection_pair
  ON FRIEND_CONNECTION (min(sender_id, recipient_id), max(sender_id, recipient_id));
CREATE INDEX IF NOT EXISTS friend_connection_recipient ON FRIEND_CONNECTION(recipient_id, status);
CREATE INDEX IF NOT EXISTS friend_connection_sender ON FRIEND_CONNECTION(sender_id, status);
CREATE TRIGGER IF NOT EXISTS friend_connection_transition
BEFORE UPDATE ON FRIEND_CONNECTION
WHEN NEW.sender_id != OLD.sender_id OR NEW.recipient_id != OLD.recipient_id
  OR OLD.status != 'pending' OR NEW.status NOT IN ('accepted', 'declined')
BEGIN
  SELECT RAISE(ABORT, 'Invalid friend connection transition');
END;
