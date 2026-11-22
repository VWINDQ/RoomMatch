ALTER TABLE oauth_ticket
    ALTER COLUMN user_id DROP NOT NULL,
    ADD COLUMN registration JSONB,
    ADD CONSTRAINT oauth_ticket_purpose_check CHECK (
        (user_id IS NOT NULL AND registration IS NULL)
        OR (user_id IS NULL AND registration IS NOT NULL)
    );
