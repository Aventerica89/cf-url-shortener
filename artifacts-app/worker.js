// Artifact Management App for Claude.ai Artifacts
// Cloudflare Worker with D1 Database
// Tracks published artifacts (claude.site URLs) and downloaded artifacts

// CORS headers for Chrome extension support
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://claude.ai',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Cf-Access-Jwt-Assertion',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Max-Age': '86400'
};

// Helper to add CORS headers to a response
function corsResponse(response) {
  const cloned = response.clone();
  const newHeaders = new Headers(cloned.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    newHeaders.set(key, value);
  }
  return new Response(cloned.body, {
    status: cloned.status,
    statusText: cloned.statusText,
    headers: newHeaders
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.slice(1);

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    // Get authenticated user
    const userEmail = await getUserEmail(request);

    // API routes require authentication
    if (path.startsWith('api/')) {
      if (!userEmail) {
        return corsResponse(Response.json({ error: 'Unauthorized' }, { status: 401 }));
      }

      // Process API request and wrap response with CORS headers
      const apiResponse = await handleApiRequest(path, request, env, userEmail, url);
      if (apiResponse) {
        return corsResponse(apiResponse);
      }

      return corsResponse(Response.json({ error: 'Not found' }, { status: 404 }));
    }

    // ============ MAIN APP UI ============

    if (!path || path === 'admin' || path === '') {
      if (!userEmail) {
        return new Response('Unauthorized', { status: 401 });
      }
      return new Response(getAppHtml(userEmail), {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    return new Response('Not found', { status: 404 });
  }
};

// Handle API requests (separated for CORS wrapping)
async function handleApiRequest(path, request, env, userEmail, url) {

      // ============ ARTIFACTS API ============

      // GET /api/artifacts - List all artifacts with filters
      if (path === 'api/artifacts' && request.method === 'GET') {
        const collection = url.searchParams.get('collection');
        const tag = url.searchParams.get('tag');
        const type = url.searchParams.get('type');
        const source = url.searchParams.get('source');
        const favorite = url.searchParams.get('favorite');
        const sort = url.searchParams.get('sort') || 'newest';
        const search = url.searchParams.get('search');

        let query = `
          SELECT
            a.*,
            c.name as collection_name,
            c.slug as collection_slug,
            c.color as collection_color,
            GROUP_CONCAT(t.name) as tag_names
          FROM artifacts a
          LEFT JOIN collections c ON a.collection_id = c.id
          LEFT JOIN artifact_tags at ON a.id = at.artifact_id
          LEFT JOIN tags t ON at.tag_id = t.id
          WHERE a.user_email = ?
        `;
        const params = [userEmail];

        if (collection) {
          query += ' AND c.slug = ?';
          params.push(collection);
        }
        if (type) {
          query += ' AND a.artifact_type = ?';
          params.push(type);
        }
        if (source) {
          query += ' AND a.source_type = ?';
          params.push(source);
        }
        if (favorite === 'true') {
          query += ' AND a.is_favorite = 1';
        }
        if (search) {
          query += ' AND (a.name LIKE ? OR a.description LIKE ? OR a.notes LIKE ?)';
          const searchTerm = `%${search}%`;
          params.push(searchTerm, searchTerm, searchTerm);
        }
        if (tag) {
          query += ' AND a.id IN (SELECT artifact_id FROM artifact_tags at2 JOIN tags t2 ON at2.tag_id = t2.id WHERE t2.name = ? AND t2.user_email = ?)';
          params.push(tag, userEmail);
        }

        query += ' GROUP BY a.id';

        // Sorting
        const sortMap = {
          newest: 'a.created_at DESC',
          oldest: 'a.created_at ASC',
          name: 'a.name ASC',
          updated: 'a.updated_at DESC',
          type: 'a.artifact_type ASC, a.name ASC'
        };
        query += ` ORDER BY a.is_favorite DESC, ${sortMap[sort] || sortMap.newest}`;

        const { results } = await env.DB.prepare(query).bind(...params).all();

        // Parse tags from comma-separated string
        const artifacts = results.map(a => ({
          ...a,
          tags: a.tag_names ? a.tag_names.split(',') : []
        }));

        return Response.json(artifacts);
      }

      // GET /api/artifacts/:id - Get single artifact
      if (path.match(/^api\/artifacts\/\d+$/) && request.method === 'GET') {
        const id = path.split('/')[2];
        const artifact = await env.DB.prepare(`
          SELECT a.*, c.name as collection_name, c.slug as collection_slug, c.color as collection_color
          FROM artifacts a
          LEFT JOIN collections c ON a.collection_id = c.id
          WHERE a.id = ? AND a.user_email = ?
        `).bind(id, userEmail).first();

        if (!artifact) {
          return Response.json({ error: 'Artifact not found' }, { status: 404 });
        }

        // Get tags
        const { results: tags } = await env.DB.prepare(`
          SELECT t.name FROM tags t
          JOIN artifact_tags at ON t.id = at.tag_id
          WHERE at.artifact_id = ?
        `).bind(id).all();

        artifact.tags = tags.map(t => t.name);
        return Response.json(artifact);
      }

      // POST /api/artifacts - Create new artifact
      if (path === 'api/artifacts' && request.method === 'POST') {
        const body = await request.json();
        const {
          name, description, artifact_type, source_type,
          published_url, artifact_id, file_name, file_size, file_content,
          language, framework, claude_model, conversation_url, notes,
          collection_id, tags, is_favorite, artifact_created_at
        } = body;

        if (!name) {
          return Response.json({ error: 'Name is required' }, { status: 400 });
        }

        const result = await env.DB.prepare(`
          INSERT INTO artifacts (
            name, description, artifact_type, source_type,
            published_url, artifact_id, file_name, file_size, file_content,
            language, framework, claude_model, conversation_url, notes,
            collection_id, user_email, is_favorite, artifact_created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          name, description || null, artifact_type || 'code', source_type || 'published',
          published_url || null, artifact_id || null, file_name || null, file_size || null, file_content || null,
          language || null, framework || null, claude_model || null, conversation_url || null, notes || null,
          collection_id || null, userEmail, is_favorite ? 1 : 0, artifact_created_at || null
        ).run();

        const newId = result.meta.last_row_id;

        // Handle tags
        if (tags && tags.length > 0) {
          for (const tagName of tags) {
            // Get or create tag
            let tag = await env.DB.prepare(
              'SELECT id FROM tags WHERE name = ? AND user_email = ?'
            ).bind(tagName.trim(), userEmail).first();

            if (!tag) {
              const tagResult = await env.DB.prepare(
                'INSERT INTO tags (name, user_email) VALUES (?, ?)'
              ).bind(tagName.trim(), userEmail).run();
              tag = { id: tagResult.meta.last_row_id };
            }

            // Link tag to artifact
            await env.DB.prepare(
              'INSERT OR IGNORE INTO artifact_tags (artifact_id, tag_id) VALUES (?, ?)'
            ).bind(newId, tag.id).run();
          }
        }

        return Response.json({ success: true, id: newId });
      }

      // PUT /api/artifacts/:id - Update artifact
      if (path.match(/^api\/artifacts\/\d+$/) && request.method === 'PUT') {
        const id = path.split('/')[2];
        const body = await request.json();
        const {
          name, description, artifact_type, source_type,
          published_url, artifact_id, file_name, file_size, file_content,
          language, framework, claude_model, conversation_url, notes,
          collection_id, tags, is_favorite
        } = body;

        await env.DB.prepare(`
          UPDATE artifacts SET
            name = ?, description = ?, artifact_type = ?, source_type = ?,
            published_url = ?, artifact_id = ?, file_name = ?, file_size = ?, file_content = ?,
            language = ?, framework = ?, claude_model = ?, conversation_url = ?, notes = ?,
            collection_id = ?, is_favorite = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_email = ?
        `).bind(
          name, description || null, artifact_type || 'code', source_type || 'published',
          published_url || null, artifact_id || null, file_name || null, file_size || null, file_content || null,
          language || null, framework || null, claude_model || null, conversation_url || null, notes || null,
          collection_id || null, is_favorite ? 1 : 0, id, userEmail
        ).run();

        // Update tags - delete all and re-add
        await env.DB.prepare('DELETE FROM artifact_tags WHERE artifact_id = ?').bind(id).run();

        if (tags && tags.length > 0) {
          for (const tagName of tags) {
            let tag = await env.DB.prepare(
              'SELECT id FROM tags WHERE name = ? AND user_email = ?'
            ).bind(tagName.trim(), userEmail).first();

            if (!tag) {
              const tagResult = await env.DB.prepare(
                'INSERT INTO tags (name, user_email) VALUES (?, ?)'
              ).bind(tagName.trim(), userEmail).run();
              tag = { id: tagResult.meta.last_row_id };
            }

            await env.DB.prepare(
              'INSERT OR IGNORE INTO artifact_tags (artifact_id, tag_id) VALUES (?, ?)'
            ).bind(id, tag.id).run();
          }
        }

        return Response.json({ success: true });
      }

      // DELETE /api/artifacts/:id
      if (path.match(/^api\/artifacts\/\d+$/) && request.method === 'DELETE') {
        const id = path.split('/')[2];
        await env.DB.prepare('DELETE FROM artifacts WHERE id = ? AND user_email = ?').bind(id, userEmail).run();
        return Response.json({ success: true });
      }

      // POST /api/artifacts/:id/favorite - Toggle favorite
      if (path.match(/^api\/artifacts\/\d+\/favorite$/) && request.method === 'POST') {
        const id = path.split('/')[2];
        await env.DB.prepare(`
          UPDATE artifacts SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_email = ?
        `).bind(id, userEmail).run();
        return Response.json({ success: true });
      }

      // ============ COLLECTIONS API ============

      // GET /api/collections
      if (path === 'api/collections' && request.method === 'GET') {
        const { results } = await env.DB.prepare(`
          SELECT c.*, COUNT(a.id) as artifact_count
          FROM collections c
          LEFT JOIN artifacts a ON c.id = a.collection_id
          WHERE c.user_email = ?
          GROUP BY c.id
          ORDER BY c.name ASC
        `).bind(userEmail).all();
        return Response.json(results);
      }

      // POST /api/collections
      if (path === 'api/collections' && request.method === 'POST') {
        const { name, description, color, icon } = await request.json();
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        try {
          const result = await env.DB.prepare(
            'INSERT INTO collections (name, slug, description, color, icon, user_email) VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(name, slug, description || null, color || '#6366f1', icon || 'folder', userEmail).run();
          return Response.json({ success: true, id: result.meta.last_row_id, slug });
        } catch (e) {
          return Response.json({ error: 'Collection with this name already exists' }, { status: 400 });
        }
      }

      // PUT /api/collections/:slug
      if (path.match(/^api\/collections\/[a-z0-9-]+$/) && request.method === 'PUT') {
        const slug = path.split('/')[2];
        const { name, description, color, icon } = await request.json();
        const newSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        await env.DB.prepare(`
          UPDATE collections SET name = ?, slug = ?, description = ?, color = ?, icon = ?
          WHERE slug = ? AND user_email = ?
        `).bind(name, newSlug, description || null, color || '#6366f1', icon || 'folder', slug, userEmail).run();

        return Response.json({ success: true, slug: newSlug });
      }

      // DELETE /api/collections/:slug
      if (path.match(/^api\/collections\/[a-z0-9-]+$/) && request.method === 'DELETE') {
        const slug = path.split('/')[2];
        await env.DB.prepare('DELETE FROM collections WHERE slug = ? AND user_email = ?').bind(slug, userEmail).run();
        return Response.json({ success: true });
      }

      // ============ TAGS API ============

      // GET /api/tags
      if (path === 'api/tags' && request.method === 'GET') {
        const { results } = await env.DB.prepare(`
          SELECT t.*, COUNT(at.artifact_id) as usage_count
          FROM tags t
          LEFT JOIN artifact_tags at ON t.id = at.tag_id
          WHERE t.user_email = ?
          GROUP BY t.id
          ORDER BY usage_count DESC, t.name ASC
        `).bind(userEmail).all();
        return Response.json(results);
      }

      // DELETE /api/tags/:name
      if (path.match(/^api\/tags\/.+$/) && request.method === 'DELETE') {
        const name = decodeURIComponent(path.split('/')[2]);
        await env.DB.prepare('DELETE FROM tags WHERE name = ? AND user_email = ?').bind(name, userEmail).run();
        return Response.json({ success: true });
      }

      // ============ STATS API ============

      if (path === 'api/stats' && request.method === 'GET') {
        const stats = await env.DB.prepare(`
          SELECT
            (SELECT COUNT(*) FROM artifacts WHERE user_email = ?) as total_artifacts,
            (SELECT COUNT(*) FROM artifacts WHERE user_email = ? AND source_type = 'published') as published_count,
            (SELECT COUNT(*) FROM artifacts WHERE user_email = ? AND source_type = 'downloaded') as downloaded_count,
            (SELECT COUNT(*) FROM artifacts WHERE user_email = ? AND is_favorite = 1) as favorites_count,
            (SELECT COUNT(*) FROM collections WHERE user_email = ?) as total_collections,
            (SELECT COUNT(DISTINCT t.id) FROM tags t JOIN artifact_tags at ON t.id = at.tag_id JOIN artifacts a ON at.artifact_id = a.id WHERE a.user_email = ?) as total_tags
        `).bind(userEmail, userEmail, userEmail, userEmail, userEmail, userEmail).first();
        return Response.json(stats);
      }

      // ============ EXPORT/IMPORT API ============

      // GET /api/export
      if (path === 'api/export' && request.method === 'GET') {
        const { results: collections } = await env.DB.prepare(
          'SELECT name, slug, description, color, icon FROM collections WHERE user_email = ?'
        ).bind(userEmail).all();

        const { results: artifacts } = await env.DB.prepare(`
          SELECT
            a.name, a.description, a.artifact_type, a.source_type,
            a.published_url, a.artifact_id, a.file_name, a.file_size, a.file_content,
            a.language, a.framework, a.claude_model, a.conversation_url, a.notes,
            a.is_favorite, a.artifact_created_at, a.created_at,
            c.slug as collection_slug,
            GROUP_CONCAT(t.name) as tag_names
          FROM artifacts a
          LEFT JOIN collections c ON a.collection_id = c.id
          LEFT JOIN artifact_tags at ON a.id = at.artifact_id
          LEFT JOIN tags t ON at.tag_id = t.id
          WHERE a.user_email = ?
          GROUP BY a.id
        `).bind(userEmail).all();

        const exportData = {
          version: 1,
          exported_at: new Date().toISOString(),
          collections,
          artifacts: artifacts.map(a => ({
            ...a,
            tags: a.tag_names ? a.tag_names.split(',') : []
          }))
        };

        return new Response(JSON.stringify(exportData, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="artifacts-export-${new Date().toISOString().split('T')[0]}.json"`
          }
        });
      }

      // POST /api/import
      if (path === 'api/import' && request.method === 'POST') {
        const data = await request.json();
        let imported = 0, skipped = 0;

        // Import collections first
        if (data.collections) {
          for (const col of data.collections) {
            try {
              await env.DB.prepare(
                'INSERT INTO collections (name, slug, description, color, icon, user_email) VALUES (?, ?, ?, ?, ?, ?)'
              ).bind(col.name, col.slug, col.description, col.color || '#6366f1', col.icon || 'folder', userEmail).run();
            } catch (e) {
              // Collection exists, skip
            }
          }
        }

        // Get collection mapping
        const { results: cols } = await env.DB.prepare(
          'SELECT id, slug FROM collections WHERE user_email = ?'
        ).bind(userEmail).all();
        const colMap = Object.fromEntries(cols.map(c => [c.slug, c.id]));

        // Import artifacts
        if (data.artifacts) {
          for (const artifact of data.artifacts) {
            try {
              const collectionId = artifact.collection_slug ? colMap[artifact.collection_slug] : null;

              const result = await env.DB.prepare(`
                INSERT INTO artifacts (
                  name, description, artifact_type, source_type,
                  published_url, artifact_id, file_name, file_size, file_content,
                  language, framework, claude_model, conversation_url, notes,
                  collection_id, user_email, is_favorite, artifact_created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).bind(
                artifact.name, artifact.description, artifact.artifact_type || 'code', artifact.source_type || 'published',
                artifact.published_url, artifact.artifact_id, artifact.file_name, artifact.file_size, artifact.file_content,
                artifact.language, artifact.framework, artifact.claude_model, artifact.conversation_url, artifact.notes,
                collectionId, userEmail, artifact.is_favorite ? 1 : 0, artifact.artifact_created_at
              ).run();

              // Handle tags
              if (artifact.tags && artifact.tags.length > 0) {
                for (const tagName of artifact.tags) {
                  let tag = await env.DB.prepare(
                    'SELECT id FROM tags WHERE name = ? AND user_email = ?'
                  ).bind(tagName.trim(), userEmail).first();

                  if (!tag) {
                    const tagResult = await env.DB.prepare(
                      'INSERT INTO tags (name, user_email) VALUES (?, ?)'
                    ).bind(tagName.trim(), userEmail).run();
                    tag = { id: tagResult.meta.last_row_id };
                  }

                  await env.DB.prepare(
                    'INSERT OR IGNORE INTO artifact_tags (artifact_id, tag_id) VALUES (?, ?)'
                  ).bind(result.meta.last_row_id, tag.id).run();
                }
              }

              imported++;
            } catch (e) {
              skipped++;
            }
          }
        }

        return Response.json({ success: true, imported, skipped });
      }

      // ============ INIT DEFAULT COLLECTIONS ============

      if (path === 'api/init' && request.method === 'POST') {
        const { results: existing } = await env.DB.prepare(
          'SELECT COUNT(*) as count FROM collections WHERE user_email = ?'
        ).bind(userEmail).all();

        if (existing[0].count === 0) {
          const defaults = [
            { name: 'Code Snippets', slug: 'code-snippets', color: '#10b981', icon: 'code' },
            { name: 'Web Apps', slug: 'web-apps', color: '#6366f1', icon: 'globe' },
            { name: 'Documents', slug: 'documents', color: '#f59e0b', icon: 'file-text' },
            { name: 'Data & Analysis', slug: 'data-analysis', color: '#ec4899', icon: 'bar-chart' },
            { name: 'Experiments', slug: 'experiments', color: '#8b5cf6', icon: 'flask' }
          ];

          for (const col of defaults) {
            await env.DB.prepare(
              'INSERT INTO collections (name, slug, color, icon, user_email) VALUES (?, ?, ?, ?, ?)'
            ).bind(col.name, col.slug, col.color, col.icon, userEmail).run();
          }
        }

        return Response.json({ success: true });
      }

      // No matching API route
      return null;
}

// ============ AUTHENTICATION ============

async function getUserEmail(request) {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) return null;
  try {
    const parts = jwt.split('.');
    const payload = JSON.parse(atob(parts[1]));
    return payload.email;
  } catch (e) {
    return null;
  }
}

// Server-side HTML escaping
function escapeHtmlServer(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============ APP HTML ============

function getAppHtml(userEmail) {
  const safeEmail = escapeHtmlServer(userEmail);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Artifact Manager - Claude Artifacts</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --background: #09090b;
      --foreground: #fafafa;
      --card: #18181b;
      --card-foreground: #fafafa;
      --popover: #18181b;
      --popover-foreground: #fafafa;
      --primary: #fafafa;
      --primary-foreground: #18181b;
      --secondary: #27272a;
      --secondary-foreground: #fafafa;
      --muted: #27272a;
      --muted-foreground: #a1a1aa;
      --accent: #27272a;
      --accent-foreground: #fafafa;
      --destructive: #7f1d1d;
      --destructive-foreground: #fafafa;
      --border: #27272a;
      --input: #27272a;
      --ring: #d4d4d8;
      --radius: 0.5rem;

      --indigo: #6366f1;
      --emerald: #10b981;
      --amber: #f59e0b;
      --rose: #f43f5e;
      --violet: #8b5cf6;
      --pink: #ec4899;
      --cyan: #06b6d4;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--background);
      color: var(--foreground);
      min-height: 100vh;
      display: flex;
    }

    /* Sidebar */
    .sidebar {
      width: 280px;
      background: var(--card);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      height: 100vh;
      position: fixed;
      left: 0;
      top: 0;
    }

    .sidebar-header {
      padding: 1.5rem;
      border-bottom: 1px solid var(--border);
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 1.25rem;
      font-weight: 600;
    }

    .logo-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, var(--indigo), var(--violet));
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .sidebar-nav {
      flex: 1;
      overflow-y: auto;
      padding: 1rem 0;
    }

    .nav-section {
      margin-bottom: 1.5rem;
    }

    .nav-section-title {
      padding: 0.5rem 1.5rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--muted-foreground);
      letter-spacing: 0.05em;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.625rem 1.5rem;
      color: var(--muted-foreground);
      cursor: pointer;
      transition: all 0.15s;
      font-size: 0.875rem;
    }

    .nav-item:hover {
      background: var(--accent);
      color: var(--foreground);
    }

    .nav-item.active {
      background: var(--accent);
      color: var(--foreground);
    }

    .nav-item-count {
      margin-left: auto;
      font-size: 0.75rem;
      background: var(--muted);
      padding: 0.125rem 0.5rem;
      border-radius: 9999px;
    }

    .collection-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .sidebar-footer {
      padding: 1rem 1.5rem;
      border-top: 1px solid var(--border);
      font-size: 0.75rem;
      color: var(--muted-foreground);
    }

    .logout-button {
      width: 100%;
      justify-content: flex-start;
      gap: 0.75rem;
    }

    .logout-avatar {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, var(--indigo), var(--violet));
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
    }

    .logout-user-info {
      flex: 1;
      text-align: left;
      min-width: 0;
    }

    .logout-username {
      font-size: 14px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .logout-email {
      font-size: 11px;
      color: var(--muted-foreground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .logout-icon {
      opacity: 0.5;
    }

    .hidden-input {
      display: none;
    }

    /* Main Content */
    .main {
      margin-left: 280px;
      flex: 1;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .header {
      padding: 1rem 2rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 1rem;
      background: var(--card);
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .search-box {
      flex: 1;
      max-width: 400px;
      position: relative;
    }

    .search-box input {
      width: 100%;
      padding: 0.5rem 1rem 0.5rem 2.5rem;
      background: var(--secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--foreground);
      font-size: 0.875rem;
    }

    .search-box input:focus {
      outline: none;
      border-color: var(--indigo);
    }

    .search-box svg {
      position: absolute;
      left: 0.75rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--muted-foreground);
    }

    .header-actions {
      display: flex;
      gap: 0.5rem;
      margin-left: auto;
    }

    .btn {
      padding: 0.5rem 1rem;
      border-radius: var(--radius);
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
      border: none;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
    }

    .btn-primary {
      background: var(--indigo);
      color: white;
    }

    .btn-primary:hover {
      background: #4f46e5;
    }

    .btn-secondary {
      background: var(--secondary);
      color: var(--foreground);
      border: 1px solid var(--border);
    }

    .btn-secondary:hover {
      background: var(--accent);
    }

    .btn-ghost {
      background: transparent;
      color: var(--muted-foreground);
    }

    .btn-ghost:hover {
      background: var(--accent);
      color: var(--foreground);
    }

    .btn-sm {
      padding: 0.375rem 0.75rem;
      font-size: 0.75rem;
    }

    .btn-icon {
      padding: 0.5rem;
      width: 36px;
      height: 36px;
      justify-content: center;
    }

    /* Content Area */
    .content {
      flex: 1;
      padding: 2rem;
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .stat-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.25rem;
    }

    .stat-label {
      font-size: 0.75rem;
      color: var(--muted-foreground);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .stat-value {
      font-size: 2rem;
      font-weight: 700;
      margin-top: 0.25rem;
    }

    /* Create Form */
    .create-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.5rem;
      margin-bottom: 2rem;
    }

    .create-card h3 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 1rem;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }

    .form-group.full-width {
      grid-column: 1 / -1;
    }

    .form-group label {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--muted-foreground);
    }

    .form-group input,
    .form-group select,
    .form-group textarea {
      padding: 0.5rem 0.75rem;
      background: var(--secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--foreground);
      font-size: 0.875rem;
    }

    .form-group input:focus,
    .form-group select:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: var(--indigo);
    }

    .form-group textarea {
      resize: vertical;
      min-height: 80px;
    }

    /* Tags Input */
    .tags-input-container {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
      padding: 0.375rem;
      background: var(--secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      min-height: 38px;
    }

    .tags-input-container:focus-within {
      border-color: var(--indigo);
    }

    .tags-input-container input {
      flex: 1;
      min-width: 100px;
      padding: 0.25rem;
      background: transparent;
      border: none;
      color: var(--foreground);
      font-size: 0.875rem;
    }

    .tags-input-container input:focus {
      outline: none;
    }

    .tag-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.125rem 0.5rem;
      background: var(--indigo);
      color: white;
      border-radius: 9999px;
      font-size: 0.75rem;
    }

    .tag-badge button {
      background: none;
      border: none;
      color: white;
      cursor: pointer;
      padding: 0;
      display: flex;
      opacity: 0.7;
    }

    .tag-badge button:hover {
      opacity: 1;
    }

    /* Artifacts Grid */
    .artifacts-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1rem;
    }

    .artifacts-header h2 {
      font-size: 1.25rem;
      font-weight: 600;
    }

    .view-toggle {
      display: flex;
      background: var(--secondary);
      border-radius: var(--radius);
      padding: 0.25rem;
    }

    .view-toggle button {
      padding: 0.375rem 0.75rem;
      background: transparent;
      border: none;
      color: var(--muted-foreground);
      cursor: pointer;
      border-radius: calc(var(--radius) - 2px);
    }

    .view-toggle button.active {
      background: var(--card);
      color: var(--foreground);
    }

    .artifacts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 1rem;
    }

    .artifact-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      transition: all 0.15s;
    }

    .artifact-card:hover {
      border-color: var(--indigo);
    }

    .artifact-card-header {
      padding: 1rem;
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
    }

    .artifact-icon {
      width: 40px;
      height: 40px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .artifact-icon.code { background: rgba(16, 185, 129, 0.15); color: var(--emerald); }
    .artifact-icon.html { background: rgba(99, 102, 241, 0.15); color: var(--indigo); }
    .artifact-icon.document { background: rgba(245, 158, 11, 0.15); color: var(--amber); }
    .artifact-icon.image { background: rgba(236, 72, 153, 0.15); color: var(--pink); }
    .artifact-icon.data { background: rgba(6, 182, 212, 0.15); color: var(--cyan); }
    .artifact-icon.other { background: rgba(139, 92, 246, 0.15); color: var(--violet); }

    .artifact-info {
      flex: 1;
      min-width: 0;
    }

    .artifact-name {
      font-weight: 600;
      font-size: 0.9375rem;
      margin-bottom: 0.25rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .artifact-meta {
      font-size: 0.75rem;
      color: var(--muted-foreground);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .artifact-actions {
      display: flex;
      gap: 0.25rem;
    }

    .artifact-card-body {
      padding: 0 1rem 1rem;
    }

    .artifact-description {
      font-size: 0.8125rem;
      color: var(--muted-foreground);
      margin-bottom: 0.75rem;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .artifact-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
    }

    .artifact-tag {
      padding: 0.125rem 0.5rem;
      background: var(--secondary);
      border-radius: 9999px;
      font-size: 0.6875rem;
      color: var(--muted-foreground);
    }

    .artifact-card-actions {
      padding: 0.75rem 1rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      border-top: 1px solid var(--border);
    }

    .artifact-card-actions .btn {
      flex: 1;
      min-width: fit-content;
      justify-content: center;
    }

    .artifact-card-footer {
      padding: 0.75rem 1rem;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.75rem;
      color: var(--muted-foreground);
    }

    .collection-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.25rem 0.5rem;
      background: var(--secondary);
      border-radius: var(--radius);
    }

    .favorite-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--muted-foreground);
      padding: 0.25rem;
      display: flex;
    }

    .favorite-btn.active {
      color: var(--amber);
    }

    /* Source Badge */
    .source-badge {
      padding: 0.125rem 0.5rem;
      border-radius: 9999px;
      font-size: 0.6875rem;
      font-weight: 500;
    }

    .source-badge.published {
      background: rgba(99, 102, 241, 0.15);
      color: var(--indigo);
    }

    .source-badge.downloaded {
      background: rgba(16, 185, 129, 0.15);
      color: var(--emerald);
    }

    /* Modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      opacity: 0;
      visibility: hidden;
      transition: all 0.2s;
    }

    .modal-overlay.active {
      opacity: 1;
      visibility: visible;
    }

    .modal {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      width: 90%;
      max-width: 600px;
      max-height: 90vh;
      overflow-y: auto;
      transform: scale(0.95);
      transition: transform 0.2s;
    }

    .modal-overlay.active .modal {
      transform: scale(1);
    }

    .modal-header {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .modal-header h3 {
      font-size: 1.125rem;
      font-weight: 600;
    }

    .modal-body {
      padding: 1.5rem;
    }

    .modal-footer {
      padding: 1rem 1.5rem;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
    }

    /* Toast */
    .toast-container {
      position: fixed;
      bottom: 1.5rem;
      right: 1.5rem;
      z-index: 200;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .toast {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
      animation: slideIn 0.2s ease;
    }

    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    .toast.success { border-left: 3px solid var(--emerald); }
    .toast.error { border-left: 3px solid var(--rose); }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      color: var(--muted-foreground);
    }

    .empty-state svg {
      width: 64px;
      height: 64px;
      margin-bottom: 1rem;
      opacity: 0.5;
    }

    .empty-state h3 {
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--foreground);
      margin-bottom: 0.5rem;
    }

    /* Pagination */
    .pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      margin-top: 2rem;
    }

    .pagination button {
      padding: 0.5rem 0.75rem;
      background: var(--secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--foreground);
      cursor: pointer;
      font-size: 0.875rem;
    }

    .pagination button:hover:not(:disabled) {
      background: var(--accent);
    }

    .pagination button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .pagination button.active {
      background: var(--indigo);
      border-color: var(--indigo);
    }

    /* Filter Pills */
    .filter-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .filter-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.375rem 0.75rem;
      background: var(--secondary);
      border: 1px solid var(--border);
      border-radius: 9999px;
      font-size: 0.75rem;
      color: var(--muted-foreground);
    }

    .filter-pill button {
      background: none;
      border: none;
      color: var(--muted-foreground);
      cursor: pointer;
      padding: 0;
      display: flex;
    }

    .filter-pill button:hover {
      color: var(--foreground);
    }

    /* Responsive */
    @media (max-width: 768px) {
      .sidebar {
        transform: translateX(-100%);
        z-index: 50;
      }

      .sidebar.open {
        transform: translateX(0);
      }

      .main {
        margin-left: 0;
      }

      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
      }

      .artifacts-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="logo">
        <div class="logo-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="7.5 4.21 12 6.81 16.5 4.21"/>
            <polyline points="7.5 19.79 7.5 14.6 3 12"/>
            <polyline points="21 12 16.5 14.6 16.5 19.79"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
        </div>
        Artifact Manager
      </div>
    </div>

    <nav class="sidebar-nav">
      <div class="nav-section">
        <div class="nav-section-title">Library</div>
        <div class="nav-item active" data-filter="all" onclick="setFilter('all')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7"/>
            <rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/>
          </svg>
          All Artifacts
          <span class="nav-item-count" id="count-all">0</span>
        </div>
        <div class="nav-item" data-filter="favorites" onclick="setFilter('favorites')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          Favorites
          <span class="nav-item-count" id="count-favorites">0</span>
        </div>
        <div class="nav-item" data-filter="published" onclick="setFilter('published')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          Published
          <span class="nav-item-count" id="count-published">0</span>
        </div>
        <div class="nav-item" data-filter="downloaded" onclick="setFilter('downloaded')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Downloaded
          <span class="nav-item-count" id="count-downloaded">0</span>
        </div>
      </div>

      <div class="nav-section">
        <div class="nav-section-title">Collections</div>
        <div id="collections-nav"></div>
      </div>

      <div class="nav-section">
        <div class="nav-section-title">Popular Tags</div>
        <div id="tags-nav"></div>
      </div>
    </nav>

    <div class="sidebar-footer">
      <button class="btn btn-ghost logout-button" id="logoutBtn">
        <div class="logout-avatar">${safeEmail.charAt(0).toUpperCase()}</div>
        <div class="logout-user-info">
          <div class="logout-username">${safeEmail.split('@')[0]}</div>
          <div class="logout-email">${safeEmail}</div>
        </div>
        <svg class="logout-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" x2="9" y1="12" y2="12"/>
        </svg>
      </button>
    </div>
  </aside>

  <!-- Main Content -->
  <main class="main">
    <header class="header">
      <div class="search-box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input type="text" placeholder="Search artifacts... (Cmd+K)" id="search-input">
      </div>
      <div class="header-actions">
        <button class="btn btn-secondary" id="exportBtn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Export
        </button>
        <button class="btn btn-secondary" id="importBtn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Import
        </button>
        <input type="file" id="import-input" accept=".json" class="hidden-input">
        <button class="btn btn-primary" id="addArtifactBtn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Artifact
        </button>
      </div>
    </header>

    <div class="content">
      <!-- Stats -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Artifacts</div>
          <div class="stat-value" id="stat-total">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Published</div>
          <div class="stat-value" id="stat-published">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Downloaded</div>
          <div class="stat-value" id="stat-downloaded">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Collections</div>
          <div class="stat-value" id="stat-collections">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Tags</div>
          <div class="stat-value" id="stat-tags">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Favorites</div>
          <div class="stat-value" id="stat-favorites">0</div>
        </div>
      </div>

      <!-- Active Filters -->
      <div class="filter-pills" id="active-filters"></div>

      <!-- Artifacts -->
      <div class="artifacts-header">
        <h2 id="artifacts-title">All Artifacts</h2>
        <select id="sort-select" onchange="loadArtifacts()">
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="name">Name (A-Z)</option>
          <option value="updated">Recently Updated</option>
          <option value="type">By Type</option>
        </select>
      </div>

      <div class="artifacts-grid" id="artifacts-grid"></div>

      <div class="pagination" id="pagination"></div>
    </div>
  </main>

  <!-- Create/Edit Modal -->
  <div class="modal-overlay" id="artifact-modal">
    <div class="modal">
      <div class="modal-header">
        <h3 id="modal-title">Add New Artifact</h3>
        <button class="btn btn-ghost btn-icon" onclick="closeModal()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <form id="artifact-form">
          <input type="hidden" id="edit-id">
          <div class="form-grid">
            <div class="form-group full-width">
              <label>Name *</label>
              <input type="text" id="artifact-name" required placeholder="My Awesome Artifact">
            </div>

            <div class="form-group">
              <label>Source Type</label>
              <select id="artifact-source">
                <option value="published">Published (URL)</option>
                <option value="downloaded">Downloaded (Local)</option>
              </select>
            </div>

            <div class="form-group">
              <label>Artifact Type</label>
              <select id="artifact-type">
                <option value="code">Code</option>
                <option value="html">HTML/Web App</option>
                <option value="document">Document</option>
                <option value="image">Image</option>
                <option value="data">Data/Analysis</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div class="form-group full-width" id="url-group">
              <label>Published URL</label>
              <input type="url" id="artifact-url" placeholder="https://claude.site/artifacts/...">
            </div>

            <div class="form-group" id="filename-group" style="display: none;">
              <label>File Name</label>
              <input type="text" id="artifact-filename" placeholder="component.tsx">
            </div>

            <div class="form-group full-width">
              <label>Description</label>
              <textarea id="artifact-description" placeholder="What does this artifact do?"></textarea>
            </div>

            <div class="form-group">
              <label>Collection</label>
              <select id="artifact-collection">
                <option value="">No Collection</option>
              </select>
            </div>

            <div class="form-group">
              <label>Language/Framework</label>
              <input type="text" id="artifact-language" placeholder="React, Python, etc.">
            </div>

            <div class="form-group full-width">
              <label>Tags (press Enter to add)</label>
              <div class="tags-input-container" id="tags-container">
                <input type="text" id="tags-input" placeholder="Add tags...">
              </div>
            </div>

            <div class="form-group full-width">
              <label>Conversation URL</label>
              <input type="url" id="artifact-conversation" placeholder="https://claude.ai/chat/...">
            </div>

            <div class="form-group full-width">
              <label>Notes</label>
              <textarea id="artifact-notes" placeholder="Personal notes about this artifact..."></textarea>
            </div>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveArtifact()">Save Artifact</button>
      </div>
    </div>
  </div>

  <!-- Collection Modal -->
  <div class="modal-overlay" id="collection-modal">
    <div class="modal" style="max-width: 400px;">
      <div class="modal-header">
        <h3>Create Collection</h3>
        <button class="btn btn-ghost btn-icon" onclick="closeCollectionModal()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Collection Name</label>
          <input type="text" id="collection-name" placeholder="My Collection">
        </div>
        <div class="form-group" style="margin-top: 1rem;">
          <label>Color</label>
          <input type="color" id="collection-color" value="#6366f1" style="width: 100%; height: 40px; cursor: pointer;">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeCollectionModal()">Cancel</button>
        <button class="btn btn-primary" onclick="createCollection()">Create</button>
      </div>
    </div>
  </div>

  <!-- Content Viewer Modal -->
  <div class="modal-overlay" id="content-modal">
    <div class="modal" style="max-width: 900px; max-height: 90vh;">
      <div class="modal-header">
        <h3 id="content-modal-title">View Artifact</h3>
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <button class="btn btn-secondary btn-sm" onclick="copyContent()" title="Copy to clipboard">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Copy
          </button>
          <button class="btn btn-ghost btn-icon" onclick="closeContentModal()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="modal-body" style="padding: 0; overflow: hidden;">
        <div id="content-viewer-info" style="padding: 1rem; background: var(--secondary); border-bottom: 1px solid var(--border);">
          <div style="display: flex; gap: 1rem; flex-wrap: wrap; font-size: 0.875rem;">
            <span id="content-viewer-type"></span>
            <span id="content-viewer-language"></span>
            <a id="content-viewer-claude" href="#" target="_blank" style="color: var(--indigo); text-decoration: none;">Open in Claude</a>
            <a id="content-viewer-published" href="#" target="_blank" style="color: var(--emerald); text-decoration: none;">View Published</a>
          </div>
        </div>
        <div id="content-viewer-preview" style="display: none; height: 400px; border-bottom: 1px solid var(--border);">
          <iframe id="content-preview-iframe" sandbox="allow-scripts" style="width: 100%; height: 100%; border: none; background: white;"></iframe>
        </div>
        <pre id="content-viewer-code" style="margin: 0; padding: 1rem; overflow: auto; max-height: 500px; background: var(--background); font-size: 0.8125rem; line-height: 1.5;"><code id="content-viewer-text"></code></pre>
      </div>
      <div class="modal-footer">
        <div style="display: flex; gap: 0.5rem;">
          <button class="btn btn-secondary" id="toggle-preview-btn" onclick="togglePreview()" style="display: none;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            Toggle Preview
          </button>
        </div>
        <button class="btn btn-primary" onclick="closeContentModal()">Close</button>
      </div>
    </div>
  </div>

  <!-- Toast Container -->
  <div class="toast-container" id="toast-container"></div>

  <script>
    // State
    let allArtifacts = [];
    let allCollections = [];
    let allTags = [];
    let currentTags = [];
    let currentPage = 1;
    const perPage = 12;

    let currentFilter = { type: 'all', value: null };

    // Initialize
    document.addEventListener('DOMContentLoaded', init);

    async function init() {
      await fetch('/api/init', { method: 'POST' });
      await Promise.all([
        loadStats(),
        loadCollections(),
        loadTags(),
        loadArtifacts()
      ]);

      // Search shortcut
      document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          document.getElementById('search-input').focus();
        }
      });

      // Search debounce
      let searchTimeout;
      document.getElementById('search-input').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          loadArtifacts();
        }, 300);
      });

      // Source type toggle
      document.getElementById('artifact-source').addEventListener('change', (e) => {
        const isPublished = e.target.value === 'published';
        document.getElementById('url-group').style.display = isPublished ? 'block' : 'none';
        document.getElementById('filename-group').style.display = isPublished ? 'none' : 'block';
      });

      // Tags input
      setupTagsInput();

      // Logout button
      document.getElementById('logoutBtn').addEventListener('click', function() {
        window.location.href = '/cdn-cgi/access/logout';
      });

      // Header action buttons
      document.getElementById('exportBtn').addEventListener('click', exportData);
      document.getElementById('importBtn').addEventListener('click', function() {
        document.getElementById('import-input').click();
      });
      document.getElementById('import-input').addEventListener('change', importData);
      document.getElementById('addArtifactBtn').addEventListener('click', openCreateModal);
    }

    async function loadStats() {
      const stats = await fetch('/api/stats').then(r => r.json());
      document.getElementById('stat-total').textContent = stats.total_artifacts || 0;
      document.getElementById('stat-published').textContent = stats.published_count || 0;
      document.getElementById('stat-downloaded').textContent = stats.downloaded_count || 0;
      document.getElementById('stat-collections').textContent = stats.total_collections || 0;
      document.getElementById('stat-tags').textContent = stats.total_tags || 0;
      document.getElementById('stat-favorites').textContent = stats.favorites_count || 0;

      document.getElementById('count-all').textContent = stats.total_artifacts || 0;
      document.getElementById('count-favorites').textContent = stats.favorites_count || 0;
      document.getElementById('count-published').textContent = stats.published_count || 0;
      document.getElementById('count-downloaded').textContent = stats.downloaded_count || 0;
    }

    async function loadCollections() {
      allCollections = await fetch('/api/collections').then(r => r.json());
      renderCollectionsNav();
      renderCollectionsSelect();
    }

    function renderCollectionsNav() {
      const nav = document.getElementById('collections-nav');
      nav.innerHTML = allCollections.map(c => \`
        <div class="nav-item" data-filter="collection" data-value="\${escapeAttr(c.slug)}" onclick="setFilter('collection', '\${escapeAttr(c.slug)}')">
          <div class="collection-dot" style="background: \${safeColor(c.color)}"></div>
          \${escapeHtml(c.name)}
          <span class="nav-item-count">\${c.artifact_count || 0}</span>
        </div>
      \`).join('') + \`
        <div class="nav-item" onclick="openCollectionModal()" style="color: var(--indigo);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Collection
        </div>
      \`;
    }

    function renderCollectionsSelect() {
      const select = document.getElementById('artifact-collection');
      select.innerHTML = '<option value="">No Collection</option>' +
        allCollections.map(c => \`<option value="\${escapeAttr(c.id)}">\${escapeHtml(c.name)}</option>\`).join('');
    }

    async function loadTags() {
      allTags = await fetch('/api/tags').then(r => r.json());
      renderTagsNav();
    }

    function renderTagsNav() {
      const nav = document.getElementById('tags-nav');
      const topTags = allTags.slice(0, 8);
      nav.innerHTML = topTags.map(t => \`
        <div class="nav-item" data-filter="tag" data-value="\${escapeAttr(t.name)}" onclick="setFilter('tag', '\${escapeAttr(t.name)}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
            <line x1="7" y1="7" x2="7.01" y2="7"/>
          </svg>
          \${escapeHtml(t.name)}
          <span class="nav-item-count">\${t.usage_count || 0}</span>
        </div>
      \`).join('');
    }

    async function loadArtifacts() {
      const sort = document.getElementById('sort-select').value;
      const search = document.getElementById('search-input').value;

      let url = \`/api/artifacts?sort=\${sort}\`;

      if (search) url += \`&search=\${encodeURIComponent(search)}\`;

      if (currentFilter.type === 'collection') {
        url += \`&collection=\${currentFilter.value}\`;
      } else if (currentFilter.type === 'tag') {
        url += \`&tag=\${encodeURIComponent(currentFilter.value)}\`;
      } else if (currentFilter.type === 'published') {
        url += '&source=published';
      } else if (currentFilter.type === 'downloaded') {
        url += '&source=downloaded';
      } else if (currentFilter.type === 'favorites') {
        url += '&favorite=true';
      }

      allArtifacts = await fetch(url).then(r => r.json());
      currentPage = 1;
      renderArtifacts();
      updateActiveFilters();
    }

    function renderArtifacts() {
      const grid = document.getElementById('artifacts-grid');
      const start = (currentPage - 1) * perPage;
      const pageArtifacts = allArtifacts.slice(start, start + perPage);

      if (allArtifacts.length === 0) {
        grid.innerHTML = \`
          <div class="empty-state" style="grid-column: 1 / -1;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            </svg>
            <h3>No artifacts yet</h3>
            <p>Add your first artifact to get started</p>
          </div>
        \`;
        document.getElementById('pagination').innerHTML = '';
        return;
      }

      grid.innerHTML = pageArtifacts.map(a => \`
        <div class="artifact-card">
          <div class="artifact-card-header">
            <div class="artifact-icon \${a.artifact_type}">
              \${getTypeIcon(a.artifact_type)}
            </div>
            <div class="artifact-info">
              <div class="artifact-name">\${escapeHtml(a.name)}</div>
              <div class="artifact-meta">
                <span class="source-badge \${a.source_type}">\${a.source_type}</span>
                \${a.language ? \`<span>\${escapeHtml(a.language)}</span>\` : ''}
              </div>
            </div>
            <div class="artifact-actions">
              <button class="favorite-btn \${a.is_favorite ? 'active' : ''}" onclick="toggleFavorite(\${a.id})">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="\${a.is_favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="artifact-card-body">
            \${a.description ? \`<div class="artifact-description">\${escapeHtml(a.description)}</div>\` : ''}
            \${a.tags && a.tags.length > 0 ? \`
              <div class="artifact-tags">
                \${a.tags.map(t => \`<span class="artifact-tag">\${escapeHtml(t)}</span>\`).join('')}
              </div>
            \` : ''}
          </div>
          <div class="artifact-card-actions">
            \${a.conversation_url ? \`
              <a href="\${escapeAttr(a.conversation_url)}" target="_blank" class="btn btn-secondary btn-sm" title="Open conversation in Claude">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                Claude
              </a>
            \` : ''}
            \${a.published_url ? \`
              <a href="\${escapeAttr(a.published_url)}" target="_blank" class="btn btn-secondary btn-sm" title="View published artifact">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="2" y1="12" x2="22" y2="12"/>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                Published
              </a>
            \` : ''}
            \${a.file_content ? \`
              <button class="btn btn-primary btn-sm" onclick="viewContent(\${a.id})" title="View artifact content">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                View
              </button>
            \` : ''}
          </div>
          <div class="artifact-card-footer">
            <div>
              \${a.collection_name ? \`
                <span class="collection-badge">
                  <span class="collection-dot" style="background: \${safeColor(a.collection_color)}; width: 6px; height: 6px;"></span>
                  \${escapeHtml(a.collection_name)}
                </span>
              \` : '<span style="color: var(--muted-foreground)">No collection</span>'}
            </div>
            <div style="display: flex; gap: 0.5rem;">
              <button class="btn btn-ghost btn-sm" onclick="openEditModal(\${a.id})">Edit</button>
              <button class="btn btn-ghost btn-sm" onclick="deleteArtifact(\${a.id})" style="color: var(--rose);">Delete</button>
            </div>
          </div>
        </div>
      \`).join('');

      renderPagination();
    }

    function renderPagination() {
      const totalPages = Math.ceil(allArtifacts.length / perPage);
      if (totalPages <= 1) {
        document.getElementById('pagination').innerHTML = '';
        return;
      }

      let html = \`<button \${currentPage === 1 ? 'disabled' : ''} onclick="goToPage(\${currentPage - 1})">Prev</button>\`;

      for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
          html += \`<button class="\${i === currentPage ? 'active' : ''}" onclick="goToPage(\${i})">\${i}</button>\`;
        } else if (i === currentPage - 2 || i === currentPage + 2) {
          html += '<span style="padding: 0 0.5rem;">...</span>';
        }
      }

      html += \`<button \${currentPage === totalPages ? 'disabled' : ''} onclick="goToPage(\${currentPage + 1})">Next</button>\`;

      document.getElementById('pagination').innerHTML = html;
    }

    function goToPage(page) {
      currentPage = page;
      renderArtifacts();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function setFilter(type, value = null) {
      currentFilter = { type, value };

      // Update nav active state
      document.querySelectorAll('.nav-item').forEach(item => {
        const itemFilter = item.dataset.filter;
        const itemValue = item.dataset.value;
        if (itemFilter === type && (!value || itemValue === value)) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });

      // Update title
      const titles = {
        all: 'All Artifacts',
        favorites: 'Favorites',
        published: 'Published Artifacts',
        downloaded: 'Downloaded Artifacts',
        collection: \`Collection: \${value}\`,
        tag: \`Tag: \${value}\`
      };
      document.getElementById('artifacts-title').textContent = titles[type] || 'Artifacts';

      loadArtifacts();
    }

    function updateActiveFilters() {
      const container = document.getElementById('active-filters');

      if (currentFilter.type === 'all') {
        container.innerHTML = '';
        return;
      }

      container.innerHTML = \`
        <div class="filter-pill">
          \${escapeHtml(currentFilter.type)}: \${escapeHtml(currentFilter.value || currentFilter.type)}
          <button onclick="setFilter('all')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      \`;
    }

    function getTypeIcon(type) {
      const icons = {
        code: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
        html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
        document: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
        image: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
        data: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
        other: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>'
      };
      return icons[type] || icons.other;
    }

    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Escape for use in JavaScript string literals (onclick handlers, etc.)
    function escapeAttr(text) {
      if (!text) return '';
      return String(text)
        .replace(/\\\\/g, '\\\\\\\\')
        .replace(/'/g, "\\\\'")
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    // Validate and sanitize color values (prevents CSS injection)
    function safeColor(color) {
      if (!color) return '#6366f1';
      // Only allow valid hex colors
      const hexPattern = /^#([0-9a-fA-F]{3}){1,2}$/;
      return hexPattern.test(color) ? color : '#6366f1';
    }

    // Tags Input
    function setupTagsInput() {
      const input = document.getElementById('tags-input');
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          const tag = input.value.trim().replace(',', '');
          if (tag && !currentTags.includes(tag)) {
            currentTags.push(tag);
            renderCurrentTags();
          }
          input.value = '';
        } else if (e.key === 'Backspace' && !input.value && currentTags.length > 0) {
          currentTags.pop();
          renderCurrentTags();
        }
      });
    }

    function renderCurrentTags() {
      const container = document.getElementById('tags-container');
      const input = document.getElementById('tags-input');
      container.innerHTML = currentTags.map(tag => \`
        <span class="tag-badge">
          \${escapeHtml(tag)}
          <button type="button" onclick="removeTag('\${escapeAttr(tag)}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </span>
      \`).join('');
      container.appendChild(input);
      input.focus();
    }

    function removeTag(tag) {
      currentTags = currentTags.filter(t => t !== tag);
      renderCurrentTags();
    }

    // Modal Functions
    function openCreateModal() {
      document.getElementById('modal-title').textContent = 'Add New Artifact';
      document.getElementById('artifact-form').reset();
      document.getElementById('edit-id').value = '';
      document.getElementById('url-group').style.display = 'block';
      document.getElementById('filename-group').style.display = 'none';
      currentTags = [];
      renderCurrentTags();
      document.getElementById('artifact-modal').classList.add('active');
    }

    async function openEditModal(id) {
      const artifact = await fetch(\`/api/artifacts/\${id}\`).then(r => r.json());

      document.getElementById('modal-title').textContent = 'Edit Artifact';
      document.getElementById('edit-id').value = id;
      document.getElementById('artifact-name').value = artifact.name || '';
      document.getElementById('artifact-source').value = artifact.source_type || 'published';
      document.getElementById('artifact-type').value = artifact.artifact_type || 'code';
      document.getElementById('artifact-url').value = artifact.published_url || '';
      document.getElementById('artifact-filename').value = artifact.file_name || '';
      document.getElementById('artifact-description').value = artifact.description || '';
      document.getElementById('artifact-collection').value = artifact.collection_id || '';
      document.getElementById('artifact-language').value = artifact.language || '';
      document.getElementById('artifact-conversation').value = artifact.conversation_url || '';
      document.getElementById('artifact-notes').value = artifact.notes || '';

      const isPublished = artifact.source_type === 'published';
      document.getElementById('url-group').style.display = isPublished ? 'block' : 'none';
      document.getElementById('filename-group').style.display = isPublished ? 'none' : 'block';

      currentTags = artifact.tags || [];
      renderCurrentTags();

      document.getElementById('artifact-modal').classList.add('active');
    }

    function closeModal() {
      document.getElementById('artifact-modal').classList.remove('active');
    }

    async function saveArtifact() {
      const id = document.getElementById('edit-id').value;
      const data = {
        name: document.getElementById('artifact-name').value,
        source_type: document.getElementById('artifact-source').value,
        artifact_type: document.getElementById('artifact-type').value,
        published_url: document.getElementById('artifact-url').value || null,
        file_name: document.getElementById('artifact-filename').value || null,
        description: document.getElementById('artifact-description').value || null,
        collection_id: document.getElementById('artifact-collection').value || null,
        language: document.getElementById('artifact-language').value || null,
        conversation_url: document.getElementById('artifact-conversation').value || null,
        notes: document.getElementById('artifact-notes').value || null,
        tags: currentTags
      };

      const url = id ? \`/api/artifacts/\${id}\` : '/api/artifacts';
      const method = id ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (res.ok) {
        closeModal();
        showToast(\`Artifact \${id ? 'updated' : 'created'} successfully\`, 'success');
        await Promise.all([loadStats(), loadCollections(), loadTags(), loadArtifacts()]);
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to save artifact', 'error');
      }
    }

    async function deleteArtifact(id) {
      if (!confirm('Are you sure you want to delete this artifact?')) return;

      const res = await fetch(\`/api/artifacts/\${id}\`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Artifact deleted', 'success');
        await Promise.all([loadStats(), loadArtifacts()]);
      }
    }

    async function toggleFavorite(id) {
      await fetch(\`/api/artifacts/\${id}/favorite\`, { method: 'POST' });
      await Promise.all([loadStats(), loadArtifacts()]);
    }

    // Collection Modal
    function openCollectionModal() {
      document.getElementById('collection-modal').classList.add('active');
    }

    function closeCollectionModal() {
      document.getElementById('collection-modal').classList.remove('active');
      document.getElementById('collection-name').value = '';
    }

    // Content Viewer Modal
    let currentViewingArtifact = null;
    let showingPreview = false;

    async function viewContent(id) {
      try {
        const response = await fetch(\`/api/artifacts/\${id}\`);
        if (!response.ok) {
          throw new Error(\`Failed to load artifact (HTTP \${response.status})\`);
        }
        const artifact = await response.json();
        if (artifact.error) {
          throw new Error(artifact.error);
        }
        currentViewingArtifact = artifact;
        showingPreview = false;

        // Set title
        document.getElementById('content-modal-title').textContent = artifact.name || 'View Artifact';

      // Set info
      document.getElementById('content-viewer-type').textContent = \`Type: \${artifact.artifact_type || 'unknown'}\`;
      document.getElementById('content-viewer-language').textContent = artifact.language ? \`Language: \${artifact.language}\` : '';

      // Set links
      const claudeLink = document.getElementById('content-viewer-claude');
      const publishedLink = document.getElementById('content-viewer-published');

      if (artifact.conversation_url) {
        claudeLink.href = artifact.conversation_url;
        claudeLink.style.display = 'inline';
      } else {
        claudeLink.style.display = 'none';
      }

      if (artifact.published_url) {
        publishedLink.href = artifact.published_url;
        publishedLink.style.display = 'inline';
      } else {
        publishedLink.style.display = 'none';
      }

      // Set content
      const content = artifact.file_content || 'No content available';
      document.getElementById('content-viewer-text').textContent = content;

      // Show/hide preview toggle for HTML
      const previewBtn = document.getElementById('toggle-preview-btn');
      const previewContainer = document.getElementById('content-viewer-preview');
      const codeContainer = document.getElementById('content-viewer-code');

      if (artifact.artifact_type === 'html' || (content.includes('<html') || content.includes('<!DOCTYPE'))) {
        previewBtn.style.display = 'inline-flex';
      } else {
        previewBtn.style.display = 'none';
      }

      previewContainer.style.display = 'none';
      codeContainer.style.display = 'block';

      document.getElementById('content-modal').classList.add('active');
      } catch (error) {
        console.error('Error loading artifact:', error);
        showToast(error.message || 'Failed to load artifact content', 'error');
      }
    }

    function closeContentModal() {
      document.getElementById('content-modal').classList.remove('active');
      currentViewingArtifact = null;
      // Clear iframe
      document.getElementById('content-preview-iframe').srcdoc = '';
    }

    function copyContent() {
      const content = currentViewingArtifact?.file_content || '';
      navigator.clipboard.writeText(content).then(() => {
        showToast('Content copied to clipboard', 'success');
      }).catch(() => {
        showToast('Failed to copy content', 'error');
      });
    }

    function togglePreview() {
      if (!currentViewingArtifact) return;

      const previewContainer = document.getElementById('content-viewer-preview');
      const codeContainer = document.getElementById('content-viewer-code');
      const iframe = document.getElementById('content-preview-iframe');

      showingPreview = !showingPreview;

      if (showingPreview) {
        // Show preview
        iframe.srcdoc = currentViewingArtifact.file_content || '';
        previewContainer.style.display = 'block';
        codeContainer.style.display = 'none';
      } else {
        // Show code
        previewContainer.style.display = 'none';
        codeContainer.style.display = 'block';
      }
    }

    async function createCollection() {
      const name = document.getElementById('collection-name').value;
      const color = document.getElementById('collection-color').value;

      if (!name) return;

      const res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color })
      });

      if (res.ok) {
        closeCollectionModal();
        showToast('Collection created', 'success');
        await loadCollections();
        await loadStats();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to create collection', 'error');
      }
    }

    // Export/Import
    async function exportData() {
      window.location.href = '/api/export';
    }

    async function importData(event) {
      const file = event.target.files[0];
      if (!file) return;

      const text = await file.text();
      const data = JSON.parse(text);

      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const result = await res.json();
      showToast(\`Imported \${result.imported} artifacts (\${result.skipped} skipped)\`, 'success');
      await Promise.all([loadStats(), loadCollections(), loadTags(), loadArtifacts()]);
      event.target.value = '';
    }

    // Toast
    function showToast(message, type = 'success') {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = \`toast \${type}\`;
      toast.innerHTML = \`
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          \${type === 'success'
            ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'
            : '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'}
        </svg>
        <span>\${escapeHtml(message)}</span>
      \`;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 5000);
    }
  </script>
</body>
</html>`;
}
