-- Artifact Management App Schema
-- Auto-runs on deploy via GitHub Actions

-- Collections (like folders/categories for organizing artifacts)
CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#6366f1',
    icon TEXT DEFAULT 'folder',
    user_email TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(slug, user_email)
);

CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_email);

-- Artifacts table - stores both published URLs and downloaded file references
CREATE TABLE IF NOT EXISTS artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    artifact_type TEXT NOT NULL DEFAULT 'code',  -- code, document, html, image, data, other
    source_type TEXT NOT NULL DEFAULT 'published',  -- published (URL) or downloaded (local)

    -- For published artifacts (claude.site URLs)
    published_url TEXT,
    artifact_id TEXT,  -- The ID from claude.site/artifacts/{id}

    -- For downloaded artifacts
    file_name TEXT,
    file_size INTEGER,
    file_content TEXT,  -- Optional: store small text files directly

    -- Metadata
    language TEXT,  -- For code: javascript, python, etc.
    framework TEXT,  -- React, Vue, etc.
    claude_model TEXT,  -- Which Claude model created it
    conversation_url TEXT,  -- Link back to the conversation
    notes TEXT,  -- Personal notes about the artifact

    -- Organization
    collection_id INTEGER,
    user_email TEXT NOT NULL,
    is_favorite INTEGER DEFAULT 0,

    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    artifact_created_at DATETIME,  -- When the artifact was originally created in Claude

    FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_user ON artifacts(user_email);
CREATE INDEX IF NOT EXISTS idx_artifacts_collection ON artifacts(collection_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(artifact_type);
CREATE INDEX IF NOT EXISTS idx_artifacts_source ON artifacts(source_type);
CREATE INDEX IF NOT EXISTS idx_artifacts_favorite ON artifacts(is_favorite);
CREATE INDEX IF NOT EXISTS idx_artifacts_created ON artifacts(created_at DESC);

-- Tags for flexible categorization
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_email TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, user_email)
);

CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_email);

-- Junction table for artifact-tag relationships
CREATE TABLE IF NOT EXISTS artifact_tags (
    artifact_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (artifact_id, tag_id),
    FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Default collections (will be created per-user on first access)
-- These are inserted via the app, not here, to respect user_email isolation
