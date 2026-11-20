-- Existing listings counted their owner as a resident. Preserve their vacancies;
-- new listings are rentals unless the owner explicitly chooses to live there.
ALTER TABLE ROOM ADD COLUMN owner_is_resident BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE ROOM ALTER COLUMN owner_is_resident SET DEFAULT FALSE;

CREATE OR REPLACE FUNCTION room_request_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target ROOM%ROWTYPE; occupancy BIGINT;
BEGIN
  SELECT * INTO target FROM ROOM WHERE room_id = NEW.room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT (CASE WHEN target.owner_is_resident THEN 1 ELSE 0 END) + COUNT(*) INTO occupancy
    FROM ROOM_MEMBER WHERE room_id = NEW.room_id AND status = 'approved';
  IF TG_OP = 'INSERT' THEN
    IF target.status <> 'available' THEN RAISE EXCEPTION 'room is not available for requests'; END IF;
    IF target.owner_id = NEW.user_id THEN RAISE EXCEPTION 'room owner cannot request own room'; END IF;
    IF EXISTS (SELECT 1 FROM ROOM_MEMBER WHERE room_id = NEW.room_id AND user_id = NEW.user_id AND status = 'approved') THEN
      RAISE EXCEPTION 'approved member cannot request the same room';
    END IF;
    IF occupancy >= target.capacity THEN RAISE EXCEPTION 'room capacity reached'; END IF;
  ELSIF NEW.status <> OLD.status THEN
    IF OLD.status <> 'pending' THEN RAISE EXCEPTION 'request decision is final'; END IF;
    IF NEW.status = 'approved' THEN
      IF target.status = 'inactive' THEN RAISE EXCEPTION 'inactive room request cannot be approved'; END IF;
      IF EXISTS (SELECT 1 FROM ROOM_MEMBER WHERE room_id = NEW.room_id AND user_id = NEW.user_id AND status = 'approved') THEN
        RAISE EXCEPTION 'user is already an approved room member';
      END IF;
      IF occupancy >= target.capacity THEN RAISE EXCEPTION 'room capacity reached'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION room_member_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target ROOM%ROWTYPE; occupancy BIGINT;
BEGIN
  SELECT * INTO target FROM ROOM WHERE room_id = NEW.room_id FOR UPDATE;
  IF target.owner_id = NEW.user_id THEN RAISE EXCEPTION 'room owner is not stored as a room member'; END IF;
  IF NEW.status = 'approved' THEN
    IF NOT EXISTS (SELECT 1 FROM ROOM_REQUEST WHERE room_id = NEW.room_id AND user_id = NEW.user_id AND status = 'approved') THEN
      RAISE EXCEPTION 'approved membership requires an approved request';
    END IF;
    SELECT (CASE WHEN target.owner_is_resident THEN 1 ELSE 0 END) + COUNT(*) INTO occupancy
      FROM ROOM_MEMBER WHERE room_id = NEW.room_id AND status = 'approved' AND user_id <> NEW.user_id;
    IF occupancy >= target.capacity THEN RAISE EXCEPTION 'room capacity reached'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION room_member_refresh_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN target_id := OLD.room_id; ELSE target_id := NEW.room_id; END IF;
  UPDATE ROOM SET status = CASE WHEN (CASE WHEN owner_is_resident THEN 1 ELSE 0 END)
    + (SELECT COUNT(*) FROM ROOM_MEMBER WHERE room_id = target_id AND status = 'approved') >= capacity THEN 'full' ELSE 'available' END
    WHERE room_id = target_id AND status <> 'inactive';
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION room_capacity_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE occupancy BIGINT;
BEGIN
  SELECT (CASE WHEN NEW.owner_is_resident THEN 1 ELSE 0 END) + COUNT(*) INTO occupancy
    FROM ROOM_MEMBER WHERE room_id = NEW.room_id AND status = 'approved';
  IF NEW.capacity < occupancy THEN RAISE EXCEPTION 'capacity cannot be lower than current occupancy'; END IF;
  IF NEW.status <> 'inactive' THEN NEW.status := CASE WHEN occupancy >= NEW.capacity THEN 'full' ELSE 'available' END; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER trg_room_capacity_validate ON ROOM;
CREATE TRIGGER trg_room_capacity_validate BEFORE INSERT OR UPDATE OF capacity, owner_is_resident, status ON ROOM
  FOR EACH ROW EXECUTE FUNCTION room_capacity_validate();
