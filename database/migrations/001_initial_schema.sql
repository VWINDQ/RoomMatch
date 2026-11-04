PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS USER (
    user_id INTEGER PRIMARY KEY,
    first_name TEXT NOT NULL CHECK (length(trim(first_name)) > 0),
    last_name TEXT NOT NULL CHECK (length(trim(last_name)) > 0),
    phone TEXT,
    gender TEXT,
    date_of_birth TEXT,
    password_hash TEXT NOT NULL CHECK (length(password_hash) > 0),
    university TEXT,
    profile_image TEXT,
    bio TEXT,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE
        CHECK (length(trim(email)) > 3 AND instr(email, '@') > 1),
    instagram TEXT,
    line_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE IF NOT EXISTS LIFESTYLE (
    lifestyle_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE,
    lifestyle_name TEXT NOT NULL CHECK (length(trim(lifestyle_name)) > 0),
    FOREIGN KEY (user_id) REFERENCES USER(user_id) ON UPDATE CASCADE ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS PREFERENCE (
    preference_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE,
    preferred_gender TEXT,
    preferred_age_min INTEGER CHECK (
        preferred_age_min IS NULL OR preferred_age_min BETWEEN 18 AND 120
    ),
    preferred_age_max INTEGER CHECK (
        preferred_age_max IS NULL OR preferred_age_max BETWEEN 18 AND 120
    ),
    budget_min INTEGER CHECK (budget_min IS NULL OR budget_min >= 0),
    budget_max INTEGER CHECK (budget_max IS NULL OR budget_max >= 0),
    CHECK (
        preferred_age_min IS NULL OR preferred_age_max IS NULL
        OR preferred_age_min <= preferred_age_max
    ),
    CHECK (
        budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max
    ),
    FOREIGN KEY (user_id) REFERENCES USER(user_id) ON UPDATE CASCADE ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS ROOM (
    room_id INTEGER PRIMARY KEY,
    owner_id INTEGER NOT NULL,
    google_maps_url TEXT NOT NULL CHECK (length(trim(google_maps_url)) > 0),
    price INTEGER NOT NULL CHECK (price >= 0),
    capacity INTEGER NOT NULL CHECK (capacity >= 1),
    description TEXT NOT NULL CHECK (length(trim(description)) > 0),
    status TEXT NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'full', 'inactive')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (owner_id) REFERENCES USER(user_id) ON UPDATE CASCADE ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS ROOM_IMAGE (
    image_id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL,
    image_url TEXT NOT NULL CHECK (length(trim(image_url)) > 0),
    image_order INTEGER NOT NULL DEFAULT 0 CHECK (image_order >= 0),
    UNIQUE (room_id, image_order),
    FOREIGN KEY (room_id) REFERENCES ROOM(room_id) ON UPDATE CASCADE ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS ROOM_MEMBER (
    user_id INTEGER NOT NULL,
    room_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'left')),
    joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (user_id, room_id),
    FOREIGN KEY (user_id) REFERENCES USER(user_id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES ROOM(room_id) ON UPDATE CASCADE ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS ROOM_REQUEST (
    request_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    room_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    responded_at TEXT,
    CHECK (
        (status = 'pending' AND responded_at IS NULL)
        OR (status IN ('approved', 'rejected') AND responded_at IS NOT NULL)
    ),
    FOREIGN KEY (user_id) REFERENCES USER(user_id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES ROOM(room_id) ON UPDATE CASCADE ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS MATCHES (
    match_id INTEGER PRIMARY KEY,
    initiator_user_id INTEGER NOT NULL,
    completer_user_id INTEGER NOT NULL,
    room_id INTEGER NOT NULL,
    matched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (initiator_user_id <> completer_user_id),
    UNIQUE (room_id, completer_user_id),
    FOREIGN KEY (initiator_user_id) REFERENCES USER(user_id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (completer_user_id) REFERENCES USER(user_id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES ROOM(room_id) ON UPDATE CASCADE ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_room_owner ON ROOM(owner_id);
CREATE INDEX IF NOT EXISTS idx_room_status_price ON ROOM(status, price);
CREATE INDEX IF NOT EXISTS idx_room_image_room_order ON ROOM_IMAGE(room_id, image_order);
CREATE INDEX IF NOT EXISTS idx_room_member_room_status ON ROOM_MEMBER(room_id, status);
CREATE INDEX IF NOT EXISTS idx_room_request_room_status ON ROOM_REQUEST(room_id, status);
CREATE INDEX IF NOT EXISTS idx_room_request_user_status ON ROOM_REQUEST(user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_room_request_one_pending
    ON ROOM_REQUEST(user_id, room_id)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_matches_initiator ON MATCHES(initiator_user_id);
CREATE INDEX IF NOT EXISTS idx_matches_completer ON MATCHES(completer_user_id);

CREATE TRIGGER IF NOT EXISTS trg_user_touch_updated_at
AFTER UPDATE ON USER
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE USER
    SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE user_id = NEW.user_id;
END;

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

CREATE TRIGGER IF NOT EXISTS trg_room_member_mark_full_insert
AFTER INSERT ON ROOM_MEMBER
FOR EACH ROW
WHEN NEW.status = 'approved'
BEGIN
    UPDATE ROOM
    SET status = 'full'
    WHERE room_id = NEW.room_id
      AND status = 'available'
      AND 1 + (
          SELECT COUNT(*) FROM ROOM_MEMBER
          WHERE room_id = NEW.room_id AND status = 'approved'
      ) >= capacity;
END;

CREATE TRIGGER IF NOT EXISTS trg_room_member_refresh_status_update
AFTER UPDATE OF status ON ROOM_MEMBER
FOR EACH ROW
BEGIN
    UPDATE ROOM
    SET status = CASE
        WHEN 1 + (
            SELECT COUNT(*) FROM ROOM_MEMBER
            WHERE room_id = NEW.room_id AND status = 'approved'
        ) >= capacity THEN 'full'
        ELSE 'available'
    END
    WHERE room_id = NEW.room_id AND status <> 'inactive';
END;

CREATE TRIGGER IF NOT EXISTS trg_room_member_refresh_status_delete
AFTER DELETE ON ROOM_MEMBER
FOR EACH ROW
WHEN OLD.status = 'approved'
BEGIN
    UPDATE ROOM
    SET status = 'available'
    WHERE room_id = OLD.room_id
      AND status = 'full'
      AND 1 + (
          SELECT COUNT(*) FROM ROOM_MEMBER
          WHERE room_id = OLD.room_id AND status = 'approved'
      ) < capacity;
END;

CREATE TRIGGER IF NOT EXISTS trg_room_capacity_validate
BEFORE UPDATE OF capacity ON ROOM
FOR EACH ROW
BEGIN
    SELECT CASE WHEN NEW.capacity < 1 + (
        SELECT COUNT(*) FROM ROOM_MEMBER
        WHERE room_id = OLD.room_id AND status = 'approved'
    ) THEN RAISE(ABORT, 'capacity cannot be lower than current occupancy') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_room_capacity_refresh_status
AFTER UPDATE OF capacity ON ROOM
FOR EACH ROW
WHEN NEW.status <> 'inactive'
BEGIN
    UPDATE ROOM
    SET status = CASE
        WHEN 1 + (
            SELECT COUNT(*) FROM ROOM_MEMBER
            WHERE room_id = NEW.room_id AND status = 'approved'
        ) >= NEW.capacity THEN 'full'
        ELSE 'available'
    END
    WHERE room_id = NEW.room_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_matches_validate
BEFORE INSERT ON MATCHES
FOR EACH ROW
BEGIN
    SELECT CASE WHEN NEW.initiator_user_id = NEW.completer_user_id
        THEN RAISE(ABORT, 'cannot create a self-match') END;

    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM ROOM
        WHERE room_id = NEW.room_id AND owner_id = NEW.initiator_user_id
    ) THEN RAISE(ABORT, 'match initiator must own the room') END;

    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM ROOM_MEMBER
        WHERE room_id = NEW.room_id
          AND user_id = NEW.completer_user_id
          AND status = 'approved'
    ) THEN RAISE(ABORT, 'match completer must be an approved member') END;
END;
