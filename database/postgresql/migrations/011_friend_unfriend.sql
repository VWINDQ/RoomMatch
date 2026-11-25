ALTER TABLE friend_connection DROP CONSTRAINT friend_connection_status_check;
ALTER TABLE friend_connection ADD CONSTRAINT friend_connection_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'unfriended'));

CREATE OR REPLACE FUNCTION friend_connection_validate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sender_id <> OLD.sender_id OR NEW.recipient_id <> OLD.recipient_id OR NOT (
    (OLD.status = 'pending' AND NEW.status IN ('accepted', 'declined', 'cancelled'))
    OR (OLD.status = 'accepted' AND NEW.status = 'unfriended' AND NEW.responded_at = OLD.responded_at)
  ) THEN
    RAISE EXCEPTION 'Invalid friend connection transition';
  END IF;
  RETURN NEW;
END $$;
