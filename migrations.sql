-- URL Shortener Migrations (safe to run multiple times)
-- This file runs automatically on every deploy via GitHub Actions

-- Create categories table
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  color TEXT DEFAULT 'gray',
  user_email TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(slug, user_email)
);

-- Create tags table
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(name, user_email)
);

-- Create link_tags junction table
CREATE TABLE IF NOT EXISTS link_tags (
  link_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (link_id, tag_id),
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Create indexes (IF NOT EXISTS handles re-runs)
CREATE INDEX IF NOT EXISTS idx_links_user_email ON links(user_email);
CREATE INDEX IF NOT EXISTS idx_links_category ON links(category_id);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_email);
CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_email);
CREATE INDEX IF NOT EXISTS idx_link_tags_link ON link_tags(link_id);
CREATE INDEX IF NOT EXISTS idx_link_tags_tag ON link_tags(tag_id);
