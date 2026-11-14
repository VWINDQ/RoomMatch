-- Preserve existing rows and add truthful listing metadata. Legacy values remain NULL.
ALTER TABLE ROOM ADD COLUMN price_basis TEXT CHECK (price_basis IS NULL OR price_basis IN ('per_person', 'per_room'));
ALTER TABLE ROOM ADD COLUMN locality TEXT CHECK (locality IS NULL OR length(locality) <= 200);
ALTER TABLE ROOM ADD COLUMN cost_notes TEXT CHECK (cost_notes IS NULL OR length(cost_notes) <= 1000);

-- SQLite CHECK constraints require rebuilding this table to add the cancelled state.
-- No other table references request_id. Recreate dependent triggers and indexes.
DROP TRIGGER IF EXISTS trg_room_request_validate_insert;
DROP TRIGGER IF EXISTS trg_room_request_validate_transition;
DROP TRIGGER IF EXISTS trg_room_member_validate_insert;
DROP TRIGGER IF EXISTS trg_room_member_validate_reactivation;

CREATE TABLE ROOM_REQUEST_REPLACEMENT (
    request_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    room_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    responded_at TEXT,
    CHECK (
        (status = 'pending' AND responded_at IS NULL)
        OR (status IN ('approved', 'rejected', 'cancelled') AND responded_at IS NOT NULL)
    ),
    FOREIGN KEY (user_id) REFERENCES USER(user_id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES ROOM(room_id) ON UPDATE CASCADE ON DELETE CASCADE
) STRICT;

INSERT INTO ROOM_REQUEST_REPLACEMENT SELECT * FROM ROOM_REQUEST;
DROP TABLE ROOM_REQUEST;
ALTER TABLE ROOM_REQUEST_REPLACEMENT RENAME TO ROOM_REQUEST;
CREATE INDEX idx_room_request_room_status ON ROOM_REQUEST(room_id, status);
CREATE INDEX idx_room_request_user_status ON ROOM_REQUEST(user_id, status);
CREATE UNIQUE INDEX idx_room_request_one_pending ON ROOM_REQUEST(user_id, room_id) WHERE status = 'pending';

CREATE TRIGGER IF NOT EXISTS trg_room_request_validate_insert
BEFORE INSERT ON ROOM_REQUEST
FOR EACH ROW
BEGIN
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM ROOM
        WHERE room_id = NEW.room_id AND status <> 'available'
    ) THEN RAISE(ABORT, 'room is not available for requests') END;

    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM ROOM
        WHERE room_id = NEW.room_id AND owner_id = NEW.user_id
    ) THEN RAISE(ABORT, 'room owner cannot request own room') END;

    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM ROOM_MEMBER
        WHERE room_id = NEW.room_id
          AND user_id = NEW.user_id
          AND status = 'approved'
    ) THEN RAISE(ABORT, 'approved member cannot request the same room') END;

    SELECT CASE WHEN (
        SELECT 1 + COUNT(*)
        FROM ROOM_MEMBER
        WHERE room_id = NEW.room_id AND status = 'approved'
    ) >= (
        SELECT capacity FROM ROOM WHERE room_id = NEW.room_id
    ) THEN RAISE(ABORT, 'room capacity reached') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_room_request_validate_transition
BEFORE UPDATE OF status ON ROOM_REQUEST
FOR EACH ROW
WHEN NEW.status <> OLD.status
BEGIN
    SELECT CASE WHEN OLD.status <> 'pending'
        THEN RAISE(ABORT, 'request decision is final') END;

    SELECT CASE WHEN NEW.status = 'approved' AND EXISTS (
        SELECT 1 FROM ROOM_MEMBER
        WHERE room_id = NEW.room_id
          AND user_id = NEW.user_id
          AND status = 'approved'
    ) THEN RAISE(ABORT, 'user is already an approved room member') END;

    SELECT CASE WHEN NEW.status = 'approved' AND EXISTS (
        SELECT 1 FROM ROOM
        WHERE room_id = NEW.room_id AND status = 'inactive'
    ) THEN RAISE(ABORT, 'inactive room request cannot be approved') END;

    SELECT CASE WHEN NEW.status = 'approved' AND (
        SELECT 1 + COUNT(*)
        FROM ROOM_MEMBER
        WHERE room_id = NEW.room_id AND status = 'approved'
    ) >= (
        SELECT capacity FROM ROOM WHERE room_id = NEW.room_id
    ) THEN RAISE(ABORT, 'room capacity reached') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_room_member_validate_insert
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

CREATE TRIGGER IF NOT EXISTS trg_room_member_validate_reactivation
BEFORE UPDATE OF status ON ROOM_MEMBER
FOR EACH ROW
WHEN OLD.status <> 'approved' AND NEW.status = 'approved'
BEGIN
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM ROOM
        WHERE room_id = NEW.room_id AND owner_id = NEW.user_id
    ) THEN RAISE(ABORT, 'room owner is not stored as a room member') END;

    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM ROOM_REQUEST
        WHERE room_id = NEW.room_id
          AND user_id = NEW.user_id
          AND status = 'approved'
    ) THEN RAISE(ABORT, 'approved membership requires an approved request') END;

    SELECT CASE WHEN (
        SELECT 1 + COUNT(*)
        FROM ROOM_MEMBER
        WHERE room_id = NEW.room_id
          AND status = 'approved'
          AND user_id <> OLD.user_id
    ) >= (
        SELECT capacity FROM ROOM WHERE room_id = NEW.room_id
    ) THEN RAISE(ABORT, 'room capacity reached') END;
END;
