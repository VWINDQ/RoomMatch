-- Withdrawn invitations remain as history and no longer reserve the pair.
DROP INDEX friend_connection_pair;
CREATE UNIQUE INDEX friend_connection_pair
  ON FRIEND_CONNECTION (LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id))
  WHERE status <> 'cancelled';
