ALTER TABLE USER
    ADD COLUMN account_type TEXT,
    ADD COLUMN profile_setup_pending BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT user_account_profile_check CHECK (
        account_type IS NULL OR CASE account_type
            WHEN 'kmutt_student' THEN university IS NOT NULL AND university = 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี'
            WHEN 'other_student' THEN university IS NOT NULL AND length(btrim(university)) BETWEEN 1 AND 255
            WHEN 'general' THEN university IS NULL
            ELSE FALSE
        END
    ),
    ADD CONSTRAINT user_pending_profile_check CHECK (NOT profile_setup_pending OR account_type IS NULL);
