-- Early seed data used a literal backslash-n between the presentation title and
-- description. Convert only those legacy separators to the real line feed used
-- by the API title convention.
UPDATE ROOM
SET description = replace(description, '\n', char(10))
WHERE instr(description, '\n') > 0;

-- The original trigger applied only to approved members, which allowed an
-- owner to be recorded incorrectly as a departed member. Owner exclusion is an
-- invariant for every membership status.
DROP TRIGGER IF EXISTS trg_room_member_validate_insert;

CREATE TRIGGER trg_room_member_validate_insert
BEFORE INSERT ON ROOM_MEMBER
FOR EACH ROW
BEGIN
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM ROOM
        WHERE room_id = NEW.room_id AND owner_id = NEW.user_id
    ) THEN RAISE(ABORT, 'room owner is not stored as a room member') END;

    SELECT CASE WHEN NEW.status = 'approved' AND NOT EXISTS (
        SELECT 1 FROM ROOM_REQUEST
        WHERE room_id = NEW.room_id
          AND user_id = NEW.user_id
          AND status = 'approved'
    ) THEN RAISE(ABORT, 'approved membership requires an approved request') END;

    SELECT CASE WHEN NEW.status = 'approved' AND (
        SELECT 1 + COUNT(*)
        FROM ROOM_MEMBER
        WHERE room_id = NEW.room_id AND status = 'approved'
    ) >= (
        SELECT capacity FROM ROOM WHERE room_id = NEW.room_id
    ) THEN RAISE(ABORT, 'room capacity reached') END;
END;
