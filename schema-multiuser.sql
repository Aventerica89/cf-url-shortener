-- URL Shortener Database Schema (Multi-user version)
-- Run this to initialize or migrate the D1 database

-- For fresh install:
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  destination TEXT NOT NULL,
  clicks INTEGER DEFAULT 0,
  user_email TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster user queries
CREATE INDEX IF NOT EXISTS idx_links_user_email ON links(user_email);

-- Migration from single-user to multi-user:
-- If you have existing links without user_email, run:
-- ALTER TABLE links ADD COLUMN user_email TEXT DEFAULT 'admin@yourdomain.com';
-- UPDATE links SET user_email = 'admin@yourdomain.com' WHERE user_email IS NULL;
