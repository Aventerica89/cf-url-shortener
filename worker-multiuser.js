export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.slice(1);

    // Get user email from Cloudflare Access JWT
    const userEmail = await getUserEmail(request);

    // Public redirect - no auth needed
    if (path && !path.startsWith('admin') && !path.startsWith('api/')) {
      const link = await env.DB.prepare('SELECT destination FROM links WHERE code = ?').bind(path).first();
      if (link) {
        await env.DB.prepare('UPDATE links SET clicks = clicks + 1 WHERE code = ?').bind(path).run();
        return Response.redirect(link.destination, 302);
      }
      return new Response('Not found', { status: 404 });
    }

    // Protected routes require auth
    if (!userEmail) {
      return new Response('Unauthorized - Cloudflare Access required', { status: 401 });
    }

    // Admin page
    if (path === 'admin') {
      return new Response(getAdminHTML(userEmail), { headers: { 'Content-Type': 'text/html' } });
    }

    // === LINKS API ===

    // List user's links with categories and tags
    if (path === 'api/links' && request.method === 'GET') {
      const categoryFilter = url.searchParams.get('category');
      const tagFilter = url.searchParams.get('tag');
      const sort = url.searchParams.get('sort') || 'newest';

      let query = `
        SELECT l.*, c.name as category_name, c.slug as category_slug, c.color as category_color,
               GROUP_CONCAT(t.name) as tags
        FROM links l
        LEFT JOIN categories c ON l.category_id = c.id
        LEFT JOIN link_tags lt ON l.id = lt.link_id
        LEFT JOIN tags t ON lt.tag_id = t.id
        WHERE l.user_email = ?
      `;
      const params = [userEmail];

      if (categoryFilter) {
        query += ' AND c.slug = ?';
        params.push(categoryFilter);
      }

      if (tagFilter) {
        query += ' AND l.id IN (SELECT lt2.link_id FROM link_tags lt2 JOIN tags t2 ON lt2.tag_id = t2.id WHERE t2.name = ? AND t2.user_email = ?)';
        params.push(tagFilter, userEmail);
      }

      query += ' GROUP BY l.id';

      // Sorting
      switch (sort) {
        case 'oldest': query += ' ORDER BY l.created_at ASC'; break;
        case 'clicks': query += ' ORDER BY l.clicks DESC'; break;
        case 'alpha': query += ' ORDER BY l.code ASC'; break;
        default: query += ' ORDER BY l.created_at DESC';
      }

      const { results } = await env.DB.prepare(query).bind(...params).all();

      // Parse tags string into array
      const links = results.map(link => ({
        ...link,
        tags: link.tags ? link.tags.split(',') : []
      }));

      return Response.json(links);
    }

    // Search links
    if (path === 'api/search' && request.method === 'GET') {
      const q = url.searchParams.get('q') || '';
      if (q.length < 2) {
        return Response.json([]);
      }

      const searchTerm = `%${q}%`;
      const { results } = await env.DB.prepare(`
        SELECT l.*, c.name as category_name, c.slug as category_slug, c.color as category_color
        FROM links l
        LEFT JOIN categories c ON l.category_id = c.id
        WHERE l.user_email = ? AND (l.code LIKE ? OR l.destination LIKE ?)
        ORDER BY l.clicks DESC
        LIMIT 10
      `).bind(userEmail, searchTerm, searchTerm).all();

      return Response.json(results);
    }

    // Create new link
    if (path === 'api/links' && request.method === 'POST') {
      const { code, destination, category_id, tags } = await request.json();
      if (!code || !destination) {
        return Response.json({ error: 'Missing code or destination' }, { status: 400 });
      }

      // Check if code exists globally
      const existing = await env.DB.prepare('SELECT code FROM links WHERE code = ?').bind(code).first();
      if (existing) {
        return Response.json({ error: 'Code already taken' }, { status: 409 });
      }

      try {
        // Insert link
        const result = await env.DB.prepare(
          'INSERT INTO links (code, destination, user_email, category_id) VALUES (?, ?, ?, ?)'
        ).bind(code, destination, userEmail, category_id || null).run();

        const linkId = result.meta.last_row_id;

        // Handle tags
        if (tags && Array.isArray(tags) && tags.length > 0) {
          for (const tagName of tags) {
            // Get or create tag
            let tag = await env.DB.prepare('SELECT id FROM tags WHERE name = ? AND user_email = ?').bind(tagName.toLowerCase(), userEmail).first();
            if (!tag) {
              const tagResult = await env.DB.prepare('INSERT INTO tags (name, user_email) VALUES (?, ?)').bind(tagName.toLowerCase(), userEmail).run();
              tag = { id: tagResult.meta.last_row_id };
            }
            // Link tag to link
            await env.DB.prepare('INSERT OR IGNORE INTO link_tags (link_id, tag_id) VALUES (?, ?)').bind(linkId, tag.id).run();
          }
        }

        return Response.json({ success: true, code, destination, id: linkId });
      } catch (e) {
        return Response.json({ error: 'Failed to create link: ' + e.message }, { status: 500 });
      }
    }

    // Update link
    if (path.startsWith('api/links/') && request.method === 'PUT') {
      const code = path.replace('api/links/', '');
      const { destination, category_id, tags } = await request.json();

      // Get link
      const link = await env.DB.prepare('SELECT id FROM links WHERE code = ? AND user_email = ?').bind(code, userEmail).first();
      if (!link) {
        return Response.json({ error: 'Link not found' }, { status: 404 });
      }

      // Update link
      await env.DB.prepare('UPDATE links SET destination = ?, category_id = ? WHERE id = ?')
        .bind(destination, category_id || null, link.id).run();

      // Update tags
      if (tags !== undefined) {
        // Remove existing tags
        await env.DB.prepare('DELETE FROM link_tags WHERE link_id = ?').bind(link.id).run();

        // Add new tags
        if (Array.isArray(tags)) {
          for (const tagName of tags) {
            let tag = await env.DB.prepare('SELECT id FROM tags WHERE name = ? AND user_email = ?').bind(tagName.toLowerCase(), userEmail).first();
            if (!tag) {
              const tagResult = await env.DB.prepare('INSERT INTO tags (name, user_email) VALUES (?, ?)').bind(tagName.toLowerCase(), userEmail).run();
              tag = { id: tagResult.meta.last_row_id };
            }
            await env.DB.prepare('INSERT OR IGNORE INTO link_tags (link_id, tag_id) VALUES (?, ?)').bind(link.id, tag.id).run();
          }
        }
      }

      return Response.json({ success: true });
    }

    // Delete link
    if (path.startsWith('api/links/') && request.method === 'DELETE') {
      const code = path.replace('api/links/', '');
      await env.DB.prepare('DELETE FROM links WHERE code = ? AND user_email = ?').bind(code, userEmail).run();
      return Response.json({ success: true });
    }

    // === CATEGORIES API ===

    // List categories
    if (path === 'api/categories' && request.method === 'GET') {
      const { results } = await env.DB.prepare(`
        SELECT c.*, COUNT(l.id) as link_count
        FROM categories c
        LEFT JOIN links l ON c.id = l.category_id
        WHERE c.user_email = ?
        GROUP BY c.id
        ORDER BY c.name ASC
      `).bind(userEmail).all();
      return Response.json(results);
    }

    // Create category
    if (path === 'api/categories' && request.method === 'POST') {
      const { name, color } = await request.json();
      if (!name) {
        return Response.json({ error: 'Missing name' }, { status: 400 });
      }

      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

      try {
        await env.DB.prepare('INSERT INTO categories (name, slug, color, user_email) VALUES (?, ?, ?, ?)')
          .bind(name, slug, color || 'gray', userEmail).run();
        return Response.json({ success: true, name, slug });
      } catch (e) {
        return Response.json({ error: 'Category already exists' }, { status: 409 });
      }
    }

    // Delete category
    if (path.startsWith('api/categories/') && request.method === 'DELETE') {
      const slug = path.replace('api/categories/', '');
      await env.DB.prepare('DELETE FROM categories WHERE slug = ? AND user_email = ?').bind(slug, userEmail).run();
      return Response.json({ success: true });
    }

    // === TAGS API ===

    // List tags with usage count
    if (path === 'api/tags' && request.method === 'GET') {
      const { results } = await env.DB.prepare(`
        SELECT t.*, COUNT(lt.link_id) as link_count
        FROM tags t
        LEFT JOIN link_tags lt ON t.id = lt.tag_id
        WHERE t.user_email = ?
        GROUP BY t.id
        ORDER BY link_count DESC
      `).bind(userEmail).all();
      return Response.json(results);
    }

    // === STATS API ===

    if (path === 'api/stats' && request.method === 'GET') {
      const linksResult = await env.DB.prepare('SELECT COUNT(*) as count, SUM(clicks) as clicks FROM links WHERE user_email = ?').bind(userEmail).first();
      const categoriesResult = await env.DB.prepare('SELECT COUNT(*) as count FROM categories WHERE user_email = ?').bind(userEmail).first();
      const tagsResult = await env.DB.prepare('SELECT COUNT(DISTINCT t.id) as count FROM tags t JOIN link_tags lt ON t.id = lt.tag_id JOIN links l ON lt.link_id = l.id WHERE l.user_email = ?').bind(userEmail).first();

      return Response.json({
        links: linksResult?.count || 0,
        clicks: linksResult?.clicks || 0,
        categories: categoriesResult?.count || 0,
        tags: tagsResult?.count || 0
      });
    }

    // === EXPORT/IMPORT ===

    // Export
    if (path === 'api/export' && request.method === 'GET') {
      const { results: links } = await env.DB.prepare(`
        SELECT l.code, l.destination, l.clicks, l.created_at, c.slug as category,
               GROUP_CONCAT(t.name) as tags
        FROM links l
        LEFT JOIN categories c ON l.category_id = c.id
        LEFT JOIN link_tags lt ON l.id = lt.link_id
        LEFT JOIN tags t ON lt.tag_id = t.id
        WHERE l.user_email = ?
        GROUP BY l.id
        ORDER BY l.created_at DESC
      `).bind(userEmail).all();

      const { results: categories } = await env.DB.prepare('SELECT name, slug, color FROM categories WHERE user_email = ?').bind(userEmail).all();

      const exportData = {
        version: 2,
        exported_at: new Date().toISOString(),
        categories,
        links: links.map(l => ({ ...l, tags: l.tags ? l.tags.split(',') : [] }))
      };

      return new Response(JSON.stringify(exportData, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="links-export-${new Date().toISOString().split('T')[0]}.json"`
        }
      });
    }

    // Import
    if (path === 'api/import' && request.method === 'POST') {
      try {
        const data = await request.json();
        let imported = 0, skipped = 0;

        // Handle v2 format with categories
        if (data.version === 2 && data.categories) {
          for (const cat of data.categories) {
            try {
              await env.DB.prepare('INSERT OR IGNORE INTO categories (name, slug, color, user_email) VALUES (?, ?, ?, ?)')
                .bind(cat.name, cat.slug, cat.color || 'gray', userEmail).run();
            } catch (e) { /* ignore duplicates */ }
          }
        }

        const links = data.links || data; // Support both v1 and v2

        for (const link of links) {
          if (!link.code || !link.destination) continue;

          const existing = await env.DB.prepare('SELECT code FROM links WHERE code = ?').bind(link.code).first();
          if (existing) { skipped++; continue; }

          // Get category ID if specified
          let categoryId = null;
          if (link.category) {
            const cat = await env.DB.prepare('SELECT id FROM categories WHERE slug = ? AND user_email = ?').bind(link.category, userEmail).first();
            if (cat) categoryId = cat.id;
          }

          const result = await env.DB.prepare('INSERT INTO links (code, destination, user_email, clicks, category_id) VALUES (?, ?, ?, ?, ?)')
            .bind(link.code, link.destination, userEmail, link.clicks || 0, categoryId).run();

          // Handle tags
          if (link.tags && Array.isArray(link.tags)) {
            for (const tagName of link.tags) {
              let tag = await env.DB.prepare('SELECT id FROM tags WHERE name = ? AND user_email = ?').bind(tagName.toLowerCase(), userEmail).first();
              if (!tag) {
                const tagResult = await env.DB.prepare('INSERT INTO tags (name, user_email) VALUES (?, ?)').bind(tagName.toLowerCase(), userEmail).run();
                tag = { id: tagResult.meta.last_row_id };
              }
              await env.DB.prepare('INSERT OR IGNORE INTO link_tags (link_id, tag_id) VALUES (?, ?)').bind(result.meta.last_row_id, tag.id).run();
            }
          }

          imported++;
        }

        return Response.json({ success: true, imported, skipped });
      } catch (e) {
        return Response.json({ error: 'Invalid JSON format' }, { status: 400 });
      }
    }

    // Init default categories (one-time setup helper)
    if (path === 'api/init-categories' && request.method === 'POST') {
      const defaults = [
        { name: 'Work', slug: 'work', color: 'violet' },
        { name: 'Personal', slug: 'personal', color: 'pink' },
        { name: 'Social Media', slug: 'social', color: 'cyan' },
        { name: 'Marketing', slug: 'marketing', color: 'orange' },
        { name: 'Documentation', slug: 'docs', color: 'green' }
      ];

      for (const cat of defaults) {
        try {
          await env.DB.prepare('INSERT OR IGNORE INTO categories (name, slug, color, user_email) VALUES (?, ?, ?, ?)')
            .bind(cat.name, cat.slug, cat.color, userEmail).run();
        } catch (e) { /* ignore */ }
      }

      return Response.json({ success: true });
    }

    return new Response('Not found', { status: 404 });
  }
};

// Decode Cloudflare Access JWT to get user email
async function getUserEmail(request) {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) return null;

  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.email || null;
  } catch (e) {
    return null;
  }
}

function getAdminHTML(userEmail) {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LinkShort - Admin</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --background: 0 0% 3.9%;
      --foreground: 0 0% 98%;
      --card: 0 0% 3.9%;
      --card-foreground: 0 0% 98%;
      --popover: 0 0% 3.9%;
      --popover-foreground: 0 0% 98%;
      --primary: 0 0% 98%;
      --primary-foreground: 0 0% 9%;
      --secondary: 0 0% 14.9%;
      --secondary-foreground: 0 0% 98%;
      --muted: 0 0% 14.9%;
      --muted-foreground: 0 0% 63.9%;
      --accent: 0 0% 14.9%;
      --accent-foreground: 0 0% 98%;
      --destructive: 0 62.8% 30.6%;
      --destructive-foreground: 0 0% 98%;
      --border: 0 0% 14.9%;
      --input: 0 0% 14.9%;
      --ring: 0 0% 83.1%;
      --radius: 0.5rem;
      --indigo: 239 84% 67%;
      --cat-work: 271 91% 65%;
      --cat-personal: 330 81% 60%;
      --cat-social: 189 94% 43%;
      --cat-marketing: 25 95% 53%;
      --cat-docs: 160 84% 39%;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      background: hsl(var(--background));
      color: hsl(var(--foreground));
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }
    .app-layout { display: flex; min-height: 100vh; }

    /* Sidebar */
    .sidebar {
      width: 256px;
      background: hsl(var(--card));
      border-right: 1px solid hsl(var(--border));
      display: flex;
      flex-direction: column;
      position: fixed;
      top: 0; left: 0; bottom: 0;
      z-index: 40;
    }
    .sidebar-header {
      height: 56px;
      padding: 0 16px;
      display: flex;
      align-items: center;
      border-bottom: 1px solid hsl(var(--border));
    }
    .logo { display: flex; align-items: center; gap: 8px; }
    .logo-icon {
      width: 32px; height: 32px;
      background: linear-gradient(135deg, hsl(var(--indigo)) 0%, hsl(271 91% 65%) 100%);
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
    }
    .logo-icon svg { width: 18px; height: 18px; color: white; }
    .logo-text { font-size: 16px; font-weight: 600; letter-spacing: -0.025em; }
    .sidebar-content { flex: 1; padding: 16px 12px; overflow-y: auto; }
    .nav-group { margin-bottom: 24px; }
    .nav-group-label {
      padding: 0 12px; margin-bottom: 4px;
      font-size: 12px; font-weight: 500;
      color: hsl(var(--muted-foreground));
    }
    .nav-item {
      display: flex; align-items: center; gap: 12px;
      padding: 8px 12px;
      border-radius: calc(var(--radius) - 2px);
      color: hsl(var(--muted-foreground));
      font-size: 14px;
      cursor: pointer;
      transition: all 150ms;
    }
    .nav-item:hover { background: hsl(var(--accent)); color: hsl(var(--accent-foreground)); }
    .nav-item.active { background: hsl(var(--secondary)); color: hsl(var(--secondary-foreground)); }
    .nav-item-icon { width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; }
    .nav-item-icon svg { width: 16px; height: 16px; }
    .nav-item-badge { margin-left: auto; font-size: 12px; color: hsl(var(--muted-foreground)); }
    .cat-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .cat-dot.work, .cat-dot.violet { background: hsl(var(--cat-work)); }
    .cat-dot.personal, .cat-dot.pink { background: hsl(var(--cat-personal)); }
    .cat-dot.social, .cat-dot.cyan { background: hsl(var(--cat-social)); }
    .cat-dot.marketing, .cat-dot.orange { background: hsl(var(--cat-marketing)); }
    .cat-dot.docs, .cat-dot.green { background: hsl(var(--cat-docs)); }
    .cat-dot.gray { background: hsl(var(--muted-foreground)); }
    .sidebar-footer { padding: 12px; border-top: 1px solid hsl(var(--border)); }
    .user-button {
      display: flex; align-items: center; gap: 12px;
      width: 100%; padding: 8px 12px;
      border-radius: calc(var(--radius) - 2px);
      background: transparent; border: none;
      color: hsl(var(--foreground));
      cursor: pointer;
      transition: background 150ms;
      text-align: left;
    }
    .user-button:hover { background: hsl(var(--accent)); }
    .avatar {
      width: 32px; height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, hsl(var(--indigo)) 0%, hsl(271 91% 65%) 100%);
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 600; color: white;
    }
    .user-info { flex: 1; min-width: 0; }
    .user-name { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .user-email { font-size: 12px; color: hsl(var(--muted-foreground)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Main */
    .main { flex: 1; margin-left: 256px; display: flex; flex-direction: column; }
    .header {
      height: 56px;
      background: hsl(var(--background));
      border-bottom: 1px solid hsl(var(--border));
      display: flex; align-items: center;
      padding: 0 24px; gap: 16px;
      position: sticky; top: 0; z-index: 30;
    }

    /* Search */
    .search { flex: 1; max-width: 512px; position: relative; }
    .search-trigger {
      display: flex; align-items: center;
      width: 100%; height: 36px; padding: 0 12px;
      background: hsl(var(--secondary));
      border: 1px solid hsl(var(--border));
      border-radius: var(--radius);
      color: hsl(var(--muted-foreground));
      font-size: 14px;
      cursor: pointer;
      transition: all 150ms;
    }
    .search-trigger:hover { background: hsl(var(--accent)); }
    .search-trigger svg { width: 16px; height: 16px; margin-right: 8px; flex-shrink: 0; }
    .search-trigger span { flex: 1; text-align: left; }
    .search-kbd {
      display: inline-flex; align-items: center; gap: 2px;
      font-size: 11px; font-family: inherit;
      background: hsl(var(--muted));
      padding: 2px 6px; border-radius: 4px;
      color: hsl(var(--muted-foreground));
    }
    .search-dialog {
      position: absolute;
      top: calc(100% + 8px); left: 0; right: 0;
      background: hsl(var(--popover));
      border: 1px solid hsl(var(--border));
      border-radius: var(--radius);
      box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
      overflow: hidden;
      display: none;
      z-index: 50;
    }
    .search-dialog.open { display: block; animation: fadeIn 150ms ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    .search-input-wrapper {
      display: flex; align-items: center;
      padding: 12px;
      border-bottom: 1px solid hsl(var(--border));
    }
    .search-input-wrapper svg { width: 16px; height: 16px; color: hsl(var(--muted-foreground)); margin-right: 8px; flex-shrink: 0; }
    .search-input {
      flex: 1;
      background: transparent; border: none; outline: none;
      color: hsl(var(--foreground));
      font-size: 14px;
    }
    .search-input::placeholder { color: hsl(var(--muted-foreground)); }
    .search-spinner {
      width: 16px; height: 16px;
      border: 2px solid hsl(var(--muted));
      border-top-color: hsl(var(--foreground));
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      display: none;
    }
    .search-spinner.loading { display: block; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .search-results { max-height: 300px; overflow-y: auto; padding: 4px; }
    .search-group { padding: 8px 8px 4px; }
    .search-group-label { font-size: 12px; font-weight: 500; color: hsl(var(--muted-foreground)); padding: 0 8px 4px; }
    .search-item {
      display: flex; align-items: center; gap: 12px;
      padding: 8px 12px;
      border-radius: calc(var(--radius) - 2px);
      cursor: pointer;
      transition: background 150ms;
    }
    .search-item:hover { background: hsl(var(--accent)); }
    .search-item-code {
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 13px;
      color: hsl(var(--indigo));
      background: hsl(var(--indigo) / 0.1);
      padding: 2px 8px; border-radius: 4px;
    }
    .search-item-url {
      flex: 1; font-size: 13px;
      color: hsl(var(--muted-foreground));
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .search-empty { padding: 24px; text-align: center; color: hsl(var(--muted-foreground)); }
    .header-actions { display: flex; align-items: center; gap: 8px; }
    .page { flex: 1; padding: 24px; }

    /* Buttons */
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      height: 36px; padding: 0 16px;
      font-size: 14px; font-weight: 500;
      border-radius: var(--radius);
      border: none;
      cursor: pointer;
      transition: all 150ms;
      white-space: nowrap;
    }
    .btn svg { width: 16px; height: 16px; }
    .btn-default { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
    .btn-default:hover { background: hsl(var(--primary) / 0.9); }
    .btn-secondary { background: hsl(var(--secondary)); color: hsl(var(--secondary-foreground)); border: 1px solid hsl(var(--border)); }
    .btn-secondary:hover { background: hsl(var(--accent)); }
    .btn-outline { background: transparent; color: hsl(var(--foreground)); border: 1px solid hsl(var(--border)); }
    .btn-outline:hover { background: hsl(var(--accent)); }
    .btn-ghost { background: transparent; color: hsl(var(--foreground)); }
    .btn-ghost:hover { background: hsl(var(--accent)); }
    .btn-destructive { background: hsl(var(--destructive)); color: hsl(var(--destructive-foreground)); }
    .btn-destructive:hover { background: hsl(var(--destructive) / 0.9); }
    .btn-sm { height: 32px; padding: 0 12px; font-size: 13px; }
    .btn-icon { width: 36px; height: 36px; padding: 0; }
    .btn-icon.sm { width: 32px; height: 32px; }

    /* Card */
    .card { background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: var(--radius); }
    .card-header { display: flex; flex-direction: column; padding: 24px 24px 0; }
    .card-header.row { flex-direction: row; align-items: center; justify-content: space-between; }
    .card-title { font-size: 18px; font-weight: 600; letter-spacing: -0.025em; }
    .card-description { font-size: 14px; color: hsl(var(--muted-foreground)); margin-top: 4px; }
    .card-content { padding: 24px; }

    /* Form */
    .input {
      display: flex; height: 40px; width: 100%; padding: 0 12px;
      background: hsl(var(--background));
      border: 1px solid hsl(var(--input));
      border-radius: var(--radius);
      font-size: 14px; color: hsl(var(--foreground));
      transition: all 150ms;
    }
    .input:focus { outline: none; border-color: hsl(var(--ring)); box-shadow: 0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--ring) / 0.3); }
    .input::placeholder { color: hsl(var(--muted-foreground)); }
    .label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 8px; }
    .select {
      display: flex; height: 40px; width: 100%; padding: 0 12px;
      background: hsl(var(--background));
      border: 1px solid hsl(var(--input));
      border-radius: var(--radius);
      font-size: 14px; color: hsl(var(--foreground));
      cursor: pointer; appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      padding-right: 40px;
      transition: all 150ms;
    }
    .select:focus { outline: none; border-color: hsl(var(--ring)); box-shadow: 0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--ring) / 0.3); }
    .select.sm { height: 32px; font-size: 13px; }

    /* Tags */
    .badge {
      display: inline-flex; align-items: center;
      padding: 2px 10px;
      font-size: 12px; font-weight: 500;
      border-radius: 9999px;
      border: 1px solid transparent;
    }
    .badge-secondary { background: hsl(var(--secondary)); color: hsl(var(--secondary-foreground)); border-color: hsl(var(--border)); }
    .badge-outline { background: transparent; color: hsl(var(--foreground)); border-color: hsl(var(--border)); }
    .badge-cat {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px;
      font-size: 12px; font-weight: 500;
      border-radius: var(--radius);
    }
    .badge-cat.work, .badge-cat.violet { background: hsl(var(--cat-work) / 0.15); color: hsl(var(--cat-work)); }
    .badge-cat.personal, .badge-cat.pink { background: hsl(var(--cat-personal) / 0.15); color: hsl(var(--cat-personal)); }
    .badge-cat.social, .badge-cat.cyan { background: hsl(var(--cat-social) / 0.15); color: hsl(var(--cat-social)); }
    .badge-cat.marketing, .badge-cat.orange { background: hsl(var(--cat-marketing) / 0.15); color: hsl(var(--cat-marketing)); }
    .badge-cat.docs, .badge-cat.green { background: hsl(var(--cat-docs) / 0.15); color: hsl(var(--cat-docs)); }
    .badge-cat.gray { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
    .tag-input {
      display: flex; flex-wrap: wrap; gap: 6px;
      min-height: 40px; padding: 6px 8px;
      background: hsl(var(--background));
      border: 1px solid hsl(var(--input));
      border-radius: var(--radius);
      transition: all 150ms;
    }
    .tag-input:focus-within { border-color: hsl(var(--ring)); box-shadow: 0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--ring) / 0.3); }
    .tag-input input {
      flex: 1; min-width: 80px;
      background: transparent; border: none; outline: none;
      font-size: 14px; color: hsl(var(--foreground));
    }
    .tag-input input::placeholder { color: hsl(var(--muted-foreground)); }
    .tag {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px;
      background: hsl(var(--secondary));
      border-radius: var(--radius);
      font-size: 13px;
    }
    .tag-close {
      display: flex; width: 14px; height: 14px;
      align-items: center; justify-content: center;
      border-radius: 2px;
      color: hsl(var(--muted-foreground));
      cursor: pointer;
      transition: all 150ms;
    }
    .tag-close:hover { background: hsl(var(--destructive)); color: hsl(var(--destructive-foreground)); }

    /* Table */
    .table-wrapper { overflow-x: auto; }
    .table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .table th {
      height: 48px; padding: 0 16px;
      text-align: left; font-weight: 500;
      color: hsl(var(--muted-foreground));
      background: hsl(var(--muted) / 0.5);
      border-bottom: 1px solid hsl(var(--border));
    }
    .table td { height: 56px; padding: 0 16px; border-bottom: 1px solid hsl(var(--border)); vertical-align: middle; }
    .table tr:last-child td { border-bottom: none; }
    .table tr:hover td { background: hsl(var(--muted) / 0.3); }
    .cell-link { display: flex; align-items: center; gap: 8px; }
    .cell-link a {
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 13px;
      color: hsl(var(--indigo));
      background: hsl(var(--indigo) / 0.1);
      padding: 4px 10px;
      border-radius: var(--radius);
      text-decoration: none;
      transition: all 150ms;
    }
    .cell-link a:hover { background: hsl(var(--indigo)); color: white; }
    .cell-url { max-width: 280px; color: hsl(var(--muted-foreground)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-decoration: none; display: block; }
    .cell-url:hover { color: hsl(var(--foreground)); }
    .cell-tags { display: flex; flex-wrap: wrap; gap: 4px; }
    .cell-clicks { display: inline-flex; align-items: center; gap: 4px; color: hsl(142 76% 46%); }
    .cell-clicks svg { width: 14px; height: 14px; }
    .cell-date { color: hsl(var(--muted-foreground)); font-size: 13px; }
    .cell-actions { display: flex; gap: 4px; justify-content: flex-end; opacity: 0; transition: opacity 150ms; }
    .table tr:hover .cell-actions { opacity: 1; }

    /* Stats */
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
    .stat-card { padding: 24px; }
    .stat-label { font-size: 14px; color: hsl(var(--muted-foreground)); margin-bottom: 8px; }
    .stat-value { font-size: 32px; font-weight: 700; letter-spacing: -0.025em; line-height: 1; }

    /* Form Grid */
    .form-grid { display: grid; grid-template-columns: 1fr 2fr 1fr 1fr auto; gap: 16px; align-items: end; }
    .form-group { display: flex; flex-direction: column; gap: 8px; }

    /* Pagination */
    .pagination { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; border-top: 1px solid hsl(var(--border)); }
    .pagination-info { font-size: 14px; color: hsl(var(--muted-foreground)); }
    .pagination-controls { display: flex; gap: 4px; }
    .pagination-btn {
      width: 32px; height: 32px;
      display: flex; align-items: center; justify-content: center;
      background: transparent;
      border: 1px solid hsl(var(--border));
      border-radius: var(--radius);
      color: hsl(var(--foreground));
      font-size: 13px;
      cursor: pointer;
      transition: all 150ms;
    }
    .pagination-btn:hover:not(:disabled) { background: hsl(var(--accent)); }
    .pagination-btn.active { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border-color: hsl(var(--primary)); }
    .pagination-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Modal */
    .modal-overlay {
      position: fixed; inset: 0;
      background: rgb(0 0 0 / 0.8);
      display: flex; align-items: center; justify-content: center;
      z-index: 100;
      opacity: 0; visibility: hidden;
      transition: opacity 150ms, visibility 150ms;
    }
    .modal-overlay.open { opacity: 1; visibility: visible; }
    .modal {
      width: 100%; max-width: 500px;
      background: hsl(var(--card));
      border: 1px solid hsl(var(--border));
      border-radius: var(--radius);
      box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25);
      transform: scale(0.95);
      transition: transform 150ms;
    }
    .modal-overlay.open .modal { transform: scale(1); }
    .modal-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 24px;
      border-bottom: 1px solid hsl(var(--border));
    }
    .modal-title { font-size: 16px; font-weight: 600; }
    .modal-body { padding: 24px; }
    .modal-footer {
      display: flex; justify-content: flex-end; gap: 8px;
      padding: 16px 24px;
      border-top: 1px solid hsl(var(--border));
    }

    /* Toast */
    .toast-container { position: fixed; bottom: 24px; right: 24px; z-index: 100; display: flex; flex-direction: column; gap: 8px; }
    .toast {
      display: flex; align-items: center; gap: 12px;
      padding: 16px;
      background: hsl(var(--card));
      border: 1px solid hsl(var(--border));
      border-radius: var(--radius);
      box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
      min-width: 320px;
      animation: slideIn 200ms ease;
    }
    @keyframes slideIn { from { opacity: 0; transform: translateX(100%); } to { opacity: 1; transform: translateX(0); } }
    .toast-icon { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; }
    .toast-icon.success { color: hsl(142 76% 46%); }
    .toast-icon.error { color: hsl(0 84% 60%); }
    .toast-content { flex: 1; }
    .toast-title { font-weight: 500; }
    .toast-description { font-size: 13px; color: hsl(var(--muted-foreground)); }
    .toast-close { color: hsl(var(--muted-foreground)); cursor: pointer; background: none; border: none; }
    .toast-close:hover { color: hsl(var(--foreground)); }

    /* Responsive */
    @media (max-width: 1024px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .form-grid { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 768px) {
      .sidebar { transform: translateX(-100%); transition: transform 200ms; }
      .sidebar.open { transform: translateX(0); }
      .main { margin-left: 0; }
      .stats-grid { grid-template-columns: 1fr; }
      .form-grid { grid-template-columns: 1fr; }
      .mobile-menu { display: block; }
    }
  </style>
</head>
<body>
  <div class="app-layout">
    <!-- Sidebar -->
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <div class="logo">
          <div class="logo-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
          </div>
          <span class="logo-text">LinkShort</span>
        </div>
      </div>

      <div class="sidebar-content">
        <div class="nav-group">
          <div class="nav-item active" onclick="filterByCategory(null)">
            <span class="nav-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
            </span>
            <span>All Links</span>
            <span class="nav-item-badge" id="totalLinksNav">0</span>
          </div>
        </div>

        <div class="nav-group">
          <div class="nav-group-label">Categories</div>
          <div id="categoriesNav"></div>
          <div class="nav-item" style="color: hsl(var(--muted-foreground));" onclick="promptAddCategory()">
            <span class="nav-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                <path d="M5 12h14"/>
                <path d="M12 5v14"/>
              </svg>
            </span>
            <span>Add Category</span>
          </div>
        </div>

        <div class="nav-group">
          <div class="nav-group-label">Popular Tags</div>
          <div id="tagsNav" style="padding: 0 12px; display: flex; flex-wrap: wrap; gap: 6px;"></div>
        </div>
      </div>

      <div class="sidebar-footer">
        <button class="user-button" onclick="logout()">
          <div class="avatar">${userEmail.charAt(0).toUpperCase()}</div>
          <div class="user-info">
            <div class="user-name">${userEmail.split('@')[0]}</div>
            <div class="user-email">${userEmail}</div>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left: auto; opacity: 0.5;">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" x2="9" y1="12" y2="12"/>
          </svg>
        </button>
      </div>
    </aside>

    <!-- Main -->
    <main class="main">
      <header class="header">
        <div class="search">
          <button class="search-trigger" id="searchTrigger">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.3-4.3"/>
            </svg>
            <span>Search links...</span>
            <kbd class="search-kbd"><span style="font-size: 14px;">&#8984;</span>K</kbd>
          </button>
          <div class="search-dialog" id="searchDialog">
            <div class="search-input-wrapper">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.3-4.3"/>
              </svg>
              <input type="text" class="search-input" placeholder="Type to search..." id="searchInput">
              <div class="search-spinner" id="searchSpinner"></div>
            </div>
            <div class="search-results" id="searchResults">
              <div class="search-empty">Type to search your links</div>
            </div>
          </div>
        </div>
        <div class="header-actions">
          <button class="btn btn-outline btn-sm" onclick="exportLinks()">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" x2="12" y1="3" y2="15"/>
            </svg>
            Export
          </button>
          <button class="btn btn-outline btn-sm" onclick="document.getElementById('importFile').click()">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" x2="12" y1="15" y2="3"/>
            </svg>
            Import
          </button>
          <input type="file" id="importFile" accept=".json" onchange="importLinks(event)" style="display: none;">
        </div>
      </header>

      <div class="page">
        <!-- Stats -->
        <div class="stats-grid">
          <div class="card stat-card">
            <div class="stat-label">Total Links</div>
            <div class="stat-value" id="statLinks">0</div>
          </div>
          <div class="card stat-card">
            <div class="stat-label">Total Clicks</div>
            <div class="stat-value" id="statClicks">0</div>
          </div>
          <div class="card stat-card">
            <div class="stat-label">Categories</div>
            <div class="stat-value" id="statCategories">0</div>
          </div>
          <div class="card stat-card">
            <div class="stat-label">Unique Tags</div>
            <div class="stat-value" id="statTags">0</div>
          </div>
        </div>

        <!-- Create Form -->
        <div class="card" style="margin-bottom: 24px;">
          <div class="card-header">
            <h2 class="card-title">Create New Link</h2>
            <p class="card-description">Add a new shortened link with optional category and tags.</p>
          </div>
          <div class="card-content">
            <div class="form-grid">
              <div class="form-group">
                <label class="label">Short Code</label>
                <input type="text" class="input" id="newCode" placeholder="my-link">
              </div>
              <div class="form-group">
                <label class="label">Destination URL</label>
                <input type="url" class="input" id="newDestination" placeholder="https://example.com/your-long-url">
              </div>
              <div class="form-group">
                <label class="label">Category</label>
                <select class="select" id="newCategory">
                  <option value="">No category</option>
                </select>
              </div>
              <div class="form-group">
                <label class="label">Tags</label>
                <div class="tag-input" id="tagInput">
                  <input type="text" placeholder="Add tag..." id="newTagInput">
                </div>
              </div>
              <div class="form-group">
                <label class="label">&nbsp;</label>
                <button class="btn btn-default" style="height: 40px;" onclick="createLink()">Create Link</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Links Table -->
        <div class="card">
          <div class="card-header row">
            <div>
              <h2 class="card-title">Your Links</h2>
              <p class="card-description">Manage all your shortened URLs.</p>
            </div>
            <div style="display: flex; gap: 8px;">
              <select class="select sm" style="width: 150px;" id="filterCategory" onchange="loadLinks()">
                <option value="">All Categories</option>
              </select>
              <select class="select sm" style="width: 150px;" id="sortLinks" onchange="loadLinks()">
                <option value="newest">Sort: Newest</option>
                <option value="oldest">Sort: Oldest</option>
                <option value="clicks">Sort: Most Clicks</option>
                <option value="alpha">Sort: A-Z</option>
              </select>
            </div>
          </div>
          <div class="table-wrapper">
            <table class="table">
              <thead>
                <tr>
                  <th>Short Link</th>
                  <th>Destination</th>
                  <th>Category</th>
                  <th>Tags</th>
                  <th>Clicks</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="linksTable"></tbody>
            </table>
          </div>
          <div class="pagination" id="pagination" style="display: none;">
            <div class="pagination-info" id="paginationInfo"></div>
            <div class="pagination-controls" id="paginationControls"></div>
          </div>
        </div>
      </div>
    </main>
  </div>

  <div class="toast-container" id="toastContainer"></div>

  <!-- Edit Modal -->
  <div class="modal-overlay" id="editModal">
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title">Edit Link</h3>
        <button class="btn btn-ghost btn-icon sm" onclick="closeEditModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="editCode">
        <div class="form-group" style="margin-bottom: 16px;">
          <label class="label">Short Code</label>
          <input type="text" class="input" id="editCodeDisplay" disabled style="opacity: 0.6;">
        </div>
        <div class="form-group" style="margin-bottom: 16px;">
          <label class="label">Destination URL</label>
          <input type="url" class="input" id="editDestination" placeholder="https://example.com">
        </div>
        <div class="form-group" style="margin-bottom: 16px;">
          <label class="label">Category</label>
          <select class="select" id="editCategory">
            <option value="">No category</option>
          </select>
        </div>
        <div class="form-group">
          <label class="label">Tags</label>
          <div class="tag-input" id="editTagInput">
            <input type="text" placeholder="Add tag..." id="editTagInputField">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeEditModal()">Cancel</button>
        <button class="btn btn-default" onclick="saveEdit()">Save Changes</button>
      </div>
    </div>
  </div>

  <script>
    const baseUrl = window.location.origin;
    let allLinks = [];
    let allCategories = [];
    let allTags = [];
    let newTags = [];
    let currentPage = 1;
    const perPage = 10;
    let currentCategory = null;

    // Initialize
    async function init() {
      await Promise.all([loadStats(), loadCategories(), loadTags(), loadLinks()]);
      // Try to init default categories if none exist
      if (allCategories.length === 0) {
        await fetch('/api/init-categories', { method: 'POST' });
        await loadCategories();
      }
    }

    async function loadStats() {
      const res = await fetch('/api/stats');
      const stats = await res.json();
      document.getElementById('statLinks').textContent = stats.links.toLocaleString();
      document.getElementById('statClicks').textContent = stats.clicks.toLocaleString();
      document.getElementById('statCategories').textContent = stats.categories;
      document.getElementById('statTags').textContent = stats.tags;
      document.getElementById('totalLinksNav').textContent = stats.links;
    }

    async function loadCategories() {
      const res = await fetch('/api/categories');
      allCategories = await res.json();

      // Update sidebar
      const nav = document.getElementById('categoriesNav');
      nav.innerHTML = allCategories.map(cat => \`
        <div class="nav-item" onclick="filterByCategory('\${cat.slug}')">
          <span class="cat-dot \${cat.color}"></span>
          <span>\${cat.name}</span>
          <span class="nav-item-badge">\${cat.link_count}</span>
        </div>
      \`).join('');

      // Update form selects
      const options = '<option value="">No category</option>' + allCategories.map(cat => \`<option value="\${cat.id}">\${cat.name}</option>\`).join('');
      document.getElementById('newCategory').innerHTML = options;
      document.getElementById('filterCategory').innerHTML = '<option value="">All Categories</option>' + allCategories.map(cat => \`<option value="\${cat.slug}">\${cat.name}</option>\`).join('');
    }

    async function loadTags() {
      const res = await fetch('/api/tags');
      allTags = await res.json();

      const nav = document.getElementById('tagsNav');
      nav.innerHTML = allTags.slice(0, 8).map(tag => \`
        <span class="badge badge-secondary" style="cursor: pointer;" onclick="filterByTag('\${tag.name}')">\${tag.name}</span>
      \`).join('');
    }

    async function loadLinks() {
      const category = document.getElementById('filterCategory').value;
      const sort = document.getElementById('sortLinks').value;

      let url = '/api/links?sort=' + sort;
      if (category) url += '&category=' + category;

      const res = await fetch(url);
      allLinks = await res.json();
      renderLinks();
    }

    function renderLinks() {
      const tbody = document.getElementById('linksTable');
      const start = (currentPage - 1) * perPage;
      const pageLinks = allLinks.slice(start, start + perPage);

      if (pageLinks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 48px; color: hsl(var(--muted-foreground));">No links found. Create your first one above!</td></tr>';
        document.getElementById('pagination').style.display = 'none';
        return;
      }

      tbody.innerHTML = pageLinks.map(link => {
        const date = new Date(link.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const catBadge = link.category_name ? \`<span class="badge-cat \${link.category_color}"><span class="cat-dot \${link.category_color}"></span>\${link.category_name}</span>\` : '<span style="color: hsl(var(--muted-foreground))">-</span>';
        const tags = link.tags.length ? link.tags.map(t => \`<span class="badge badge-outline">\${t}</span>\`).join('') : '<span style="color: hsl(var(--muted-foreground))">-</span>';

        return \`
          <tr>
            <td>
              <div class="cell-link">
                <a href="\${baseUrl}/\${link.code}" target="_blank">/\${link.code}</a>
                <button class="btn btn-ghost btn-icon sm" onclick="copyLink('\${link.code}')" title="Copy">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                  </svg>
                </button>
              </div>
            </td>
            <td><a href="\${link.destination}" target="_blank" class="cell-url" title="\${link.destination}">\${link.destination}</a></td>
            <td>\${catBadge}</td>
            <td><div class="cell-tags">\${tags}</div></td>
            <td>
              <span class="cell-clicks">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
                  <polyline points="16 7 22 7 22 13"/>
                </svg>
                \${link.clicks.toLocaleString()}
              </span>
            </td>
            <td class="cell-date">\${date}</td>
            <td>
              <div class="cell-actions">
                <button class="btn btn-ghost btn-icon sm" onclick='openEditModal(\${JSON.stringify(link).replace(/'/g, "&#39;")})' title="Edit">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                    <path d="m15 5 4 4"/>
                  </svg>
                </button>
                <button class="btn btn-ghost btn-icon sm" onclick="deleteLink('\${link.code}')" title="Delete">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 6h18"/>
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                  </svg>
                </button>
              </div>
            </td>
          </tr>
        \`;
      }).join('');

      // Pagination
      const totalPages = Math.ceil(allLinks.length / perPage);
      if (totalPages > 1) {
        document.getElementById('pagination').style.display = 'flex';
        document.getElementById('paginationInfo').textContent = \`Showing \${start + 1}-\${Math.min(start + perPage, allLinks.length)} of \${allLinks.length} links\`;

        let controls = \`<button class="pagination-btn" \${currentPage === 1 ? 'disabled' : ''} onclick="goToPage(\${currentPage - 1})"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>\`;
        for (let i = 1; i <= totalPages; i++) {
          if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
            controls += \`<button class="pagination-btn \${i === currentPage ? 'active' : ''}" onclick="goToPage(\${i})">\${i}</button>\`;
          } else if (i === currentPage - 2 || i === currentPage + 2) {
            controls += '<button class="pagination-btn" disabled>...</button>';
          }
        }
        controls += \`<button class="pagination-btn" \${currentPage === totalPages ? 'disabled' : ''} onclick="goToPage(\${currentPage + 1})"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></button>\`;
        document.getElementById('paginationControls').innerHTML = controls;
      } else {
        document.getElementById('pagination').style.display = 'none';
      }
    }

    function goToPage(page) {
      currentPage = page;
      renderLinks();
    }

    function filterByCategory(slug) {
      document.getElementById('filterCategory').value = slug || '';
      currentPage = 1;
      loadLinks();

      // Update active state
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      if (!slug) {
        document.querySelector('.nav-item').classList.add('active');
      }
    }

    function filterByTag(tag) {
      // For now, just show toast - could add tag filtering
      showToast('Tag filtering coming soon!', 'Showing links tagged with: ' + tag);
    }

    async function createLink() {
      const code = document.getElementById('newCode').value.trim();
      const destination = document.getElementById('newDestination').value.trim();
      const category_id = document.getElementById('newCategory').value || null;

      if (!code || !destination) {
        showToast('Missing fields', 'Please enter both code and destination', 'error');
        return;
      }

      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, destination, category_id, tags: newTags })
      });

      if (res.ok) {
        document.getElementById('newCode').value = '';
        document.getElementById('newDestination').value = '';
        document.getElementById('newCategory').value = '';
        newTags = [];
        renderNewTags();
        showToast('Link created', 'Your new short link is ready to use');
        await Promise.all([loadLinks(), loadStats(), loadCategories(), loadTags()]);
      } else {
        const data = await res.json();
        showToast('Error', data.error || 'Failed to create link', 'error');
      }
    }

    async function deleteLink(code) {
      if (!confirm('Delete this link? This cannot be undone.')) return;

      await fetch('/api/links/' + code, { method: 'DELETE' });
      showToast('Link deleted', 'The link has been removed');
      await Promise.all([loadLinks(), loadStats(), loadCategories()]);
    }

    function copyLink(code) {
      navigator.clipboard.writeText(baseUrl + '/' + code);
      showToast('Copied!', 'Link copied to clipboard');
    }

    function exportLinks() {
      window.location.href = '/api/export';
      showToast('Exporting', 'Your links are being downloaded');
    }

    function logout() {
      window.location.href = '/cdn-cgi/access/logout';
    }

    async function importLinks(event) {
      const file = event.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        const res = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });

        const result = await res.json();
        if (res.ok) {
          showToast('Import complete', \`Imported \${result.imported} links (\${result.skipped} skipped)\`);
          await Promise.all([loadLinks(), loadStats(), loadCategories(), loadTags()]);
        } else {
          showToast('Import failed', result.error || 'Unknown error', 'error');
        }
      } catch (e) {
        showToast('Invalid file', 'Could not parse JSON file', 'error');
      }

      event.target.value = '';
    }

    function promptAddCategory() {
      const name = prompt('Enter category name:');
      if (!name) return;

      const colors = ['violet', 'pink', 'cyan', 'orange', 'green', 'gray'];
      const color = colors[Math.floor(Math.random() * colors.length)];

      fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color })
      }).then(() => {
        showToast('Category created', 'New category: ' + name);
        loadCategories();
      });
    }

    // Tag input handling
    const tagInputEl = document.getElementById('newTagInput');
    tagInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const tag = tagInputEl.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (tag && !newTags.includes(tag)) {
          newTags.push(tag);
          renderNewTags();
        }
        tagInputEl.value = '';
      } else if (e.key === 'Backspace' && !tagInputEl.value && newTags.length) {
        newTags.pop();
        renderNewTags();
      }
    });

    function renderNewTags() {
      const container = document.getElementById('tagInput');
      const input = document.getElementById('newTagInput');
      container.innerHTML = '';
      newTags.forEach((tag, i) => {
        const el = document.createElement('span');
        el.className = 'tag';
        el.innerHTML = tag + '<span class="tag-close" onclick="removeNewTag(' + i + ')"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></span>';
        container.appendChild(el);
      });
      container.appendChild(input);
    }

    function removeNewTag(index) {
      newTags.splice(index, 1);
      renderNewTags();
    }

    // Search
    const searchTrigger = document.getElementById('searchTrigger');
    const searchDialog = document.getElementById('searchDialog');
    const searchInput = document.getElementById('searchInput');
    const searchSpinner = document.getElementById('searchSpinner');
    const searchResults = document.getElementById('searchResults');
    let searchTimeout = null;

    searchTrigger.addEventListener('click', () => {
      searchDialog.classList.add('open');
      searchInput.focus();
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search')) searchDialog.classList.remove('open');
    });

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchDialog.classList.add('open');
        searchInput.focus();
      }
      if (e.key === 'Escape') searchDialog.classList.remove('open');
    });

    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      if (searchTimeout) clearTimeout(searchTimeout);

      if (q.length < 2) {
        searchResults.innerHTML = '<div class="search-empty">Type to search your links</div>';
        searchSpinner.classList.remove('loading');
        return;
      }

      searchSpinner.classList.add('loading');

      searchTimeout = setTimeout(async () => {
        try {
          const res = await fetch('/api/search?q=' + encodeURIComponent(q));
          const results = await res.json();

          if (results.length === 0) {
            searchResults.innerHTML = '<div class="search-empty">No results found</div>';
          } else {
            searchResults.innerHTML = '<div class="search-group"><div class="search-group-label">Results</div>' +
              results.map(link => \`
                <div class="search-item" onclick="window.open('\${baseUrl}/\${link.code}', '_blank')">
                  <span class="search-item-code">/\${link.code}</span>
                  <span class="search-item-url">\${link.destination}</span>
                </div>
              \`).join('') + '</div>';
          }
        } finally {
          searchSpinner.classList.remove('loading');
        }
      }, 300);
    });

    // Toast
    function showToast(title, description, type = 'success') {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.innerHTML = \`
        <div class="toast-icon \${type}">
          \${type === 'success' ? '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>'}
        </div>
        <div class="toast-content">
          <div class="toast-title">\${title}</div>
          <div class="toast-description">\${description}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      \`;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 5000);
    }

    // Keyboard shortcuts for form
    document.getElementById('newCode').addEventListener('keypress', e => {
      if (e.key === 'Enter') document.getElementById('newDestination').focus();
    });
    document.getElementById('newDestination').addEventListener('keypress', e => {
      if (e.key === 'Enter') createLink();
    });

    // Edit Modal
    let editTags = [];

    function openEditModal(link) {
      document.getElementById('editCode').value = link.code;
      document.getElementById('editCodeDisplay').value = '/' + link.code;
      document.getElementById('editDestination').value = link.destination;
      document.getElementById('editCategory').value = link.category_id || '';

      // Populate category dropdown
      const catSelect = document.getElementById('editCategory');
      catSelect.innerHTML = '<option value="">No category</option>' + allCategories.map(cat =>
        \`<option value="\${cat.id}" \${cat.id === link.category_id ? 'selected' : ''}>\${cat.name}</option>\`
      ).join('');

      // Set tags
      editTags = link.tags ? [...link.tags] : [];
      renderEditTags();

      document.getElementById('editModal').classList.add('open');
    }

    function closeEditModal() {
      document.getElementById('editModal').classList.remove('open');
      editTags = [];
    }

    async function saveEdit() {
      const code = document.getElementById('editCode').value;
      const destination = document.getElementById('editDestination').value.trim();
      const category_id = document.getElementById('editCategory').value || null;

      if (!destination) {
        showToast('Missing destination', 'Please enter a destination URL', 'error');
        return;
      }

      const res = await fetch('/api/links/' + code, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination, category_id, tags: editTags })
      });

      if (res.ok) {
        closeEditModal();
        showToast('Link updated', 'Your changes have been saved');
        await Promise.all([loadLinks(), loadStats(), loadCategories(), loadTags()]);
      } else {
        const data = await res.json();
        showToast('Error', data.error || 'Failed to update link', 'error');
      }
    }

    function renderEditTags() {
      const container = document.getElementById('editTagInput');
      const input = document.getElementById('editTagInputField');
      container.innerHTML = '';
      editTags.forEach((tag, i) => {
        const el = document.createElement('span');
        el.className = 'tag';
        el.innerHTML = tag + '<span class="tag-close" onclick="removeEditTag(' + i + ')"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></span>';
        container.appendChild(el);
      });
      container.appendChild(input);
    }

    function removeEditTag(index) {
      editTags.splice(index, 1);
      renderEditTags();
    }

    // Edit tag input handling
    document.getElementById('editTagInputField').addEventListener('keydown', (e) => {
      const input = e.target;
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const tag = input.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (tag && !editTags.includes(tag)) {
          editTags.push(tag);
          renderEditTags();
        }
        input.value = '';
      } else if (e.key === 'Backspace' && !input.value && editTags.length) {
        editTags.pop();
        renderEditTags();
      }
    });

    // Close modal on escape or backdrop click
    document.getElementById('editModal').addEventListener('click', (e) => {
      if (e.target.id === 'editModal') closeEditModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('editModal').classList.contains('open')) {
        closeEditModal();
      }
    });

    // Init
    init();
  </script>
</body>
</html>`;
}
