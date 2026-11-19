-- OAuth accounts have no local password. Existing password hashes are preserved.
ALTER TABLE USER ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE oauth_identity (
    provider TEXT NOT NULL CHECK (provider = 'google'),
    subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
    user_id BIGINT NOT NULL REFERENCES USER(user_id) ON UPDATE CASCADE ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (provider, subject),
    UNIQUE (provider, user_id)
);

CREATE TABLE oauth_attempt (
    state_hash TEXT PRIMARY KEY,
    browser_hash TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    nonce TEXT NOT NULL,
    return_to TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX oauth_attempt_expiry ON oauth_attempt(expires_at);

CREATE TABLE oauth_ticket (
    ticket_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES USER(user_id) ON UPDATE CASCADE ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX oauth_ticket_expiry ON oauth_ticket(expires_at);
