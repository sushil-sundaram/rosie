-- Corrections Rosie remembers from scans. When someone changes a scanned
-- item's name or unit before saving ("Sabudana - Medium" -> "Sabudana"), the
-- text as it was read is kept here with their version, and later scans that
-- read the same text use it automatically.
CREATE TABLE item_corrections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    -- What the scan read, normalised (lower case, plain words): the invoice
    -- line, or the name the AI gave for a photo.
    source     TEXT    NOT NULL UNIQUE CHECK (length(source) > 0),
    -- As written when it was corrected, for showing in Settings.
    source_text TEXT   NOT NULL,
    name       TEXT    NOT NULL CHECK (length(trim(name)) > 0),
    unit       TEXT,
    -- How many scans it has been applied to.
    uses       INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
) STRICT;
