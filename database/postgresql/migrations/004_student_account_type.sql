ALTER TABLE USER DROP CONSTRAINT user_account_profile_check;

UPDATE USER SET account_type = 'student' WHERE account_type IN ('kmutt_student', 'other_student');

ALTER TABLE USER ADD CONSTRAINT user_account_profile_check CHECK (
    account_type IS NULL OR CASE account_type
        WHEN 'student' THEN university IS NOT NULL AND length(btrim(university)) BETWEEN 1 AND 255
        WHEN 'general' THEN university IS NULL
        ELSE FALSE
    END
);
