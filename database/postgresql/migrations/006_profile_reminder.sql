-- An account-level acknowledgement survives logout, browser storage resets and device changes.
ALTER TABLE USER ADD COLUMN profile_reminder_seen_at TIMESTAMPTZ;
