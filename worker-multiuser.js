// Favicon SVG with accessibility title and optimized grouped paths
const ADMIN_FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctitle%3ELinkShort Admin Icon%3C/title%3E%3Crect width='32' height='32' rx='6' fill='%2309090b'/%3E%3Cg stroke='%238b5cf6' stroke-width='2.5' stroke-linecap='round' fill='none'%3E%3Cpath d='M18.5 10.5a4 4 0 0 1 5.66 5.66l-2.83 2.83a4 4 0 0 1-5.66 0'/%3E%3Cpath d='M13.5 21.5a4 4 0 0 1-5.66-5.66l2.83-2.83a4 4 0 0 1 5.66 0'/%3E%3C/g%3E%3C/svg%3E";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.slice(1);

    // Get user email from Cloudflare Access JWT
    const userEmail = await getUserEmail(request);

    // Public redirect - no auth needed
    if (path && !path.startsWith('admin') && !path.startsWith('api/')) {
      const link = await env.DB.prepare('SELECT id, destination, expires_at, password_hash FROM links WHERE code = ?').bind(path).first();
      if (link) {
        // Rate limit check for redirects (by IP)
        const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
        const rateLimit = await checkRateLimit(env, clientIP, 'redirect');
        if (!rateLimit.allowed) {
          return new Response('Too many requests. Please try again later.', {
            status: 429,
            headers: { 'Retry-After': '60' }
          });
        }

        // Check if link has expired
        if (link.expires_at && new Date(link.expires_at) < new Date()) {
          return new Response(getExpiredHTML(), {
            status: 410,
            headers: { 'Content-Type': 'text/html' }
          });
        }

        // Check if link is password protected
        if (link.password_hash) {
          // Handle POST request with password
          if (request.method === 'POST') {
            const formData = await request.formData();
            const password = formData.get('password') || '';
            const isValid = await verifyPassword(password, link.password_hash);

            if (!isValid) {
              return new Response(getPasswordHTML(path, true), {
                status: 401,
                headers: { 'Content-Type': 'text/html' }
              });
            }
            // Password correct, continue to redirect
          } else {
            // Show password prompt
            return new Response(getPasswordHTML(path, false), {
              status: 401,
              headers: { 'Content-Type': 'text/html' }
            });
          }
        }

        // Update click count
        await env.DB.prepare('UPDATE links SET clicks = clicks + 1 WHERE code = ?').bind(path).run();

        // Log click event with details from Cloudflare headers
        const clickData = parseClickData(request);
        await env.DB.prepare(`
          INSERT INTO click_events (link_id, referrer, user_agent, country, city, device_type, browser)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          link.id,
          clickData.referrer,
          clickData.userAgent,
          clickData.country,
          clickData.city,
          clickData.deviceType,
          clickData.browser
        ).run();

        return new Response(null, {
          status: 302,
          headers: {
            'Location': link.destination,
            'Cache-Control': 'private, no-cache, no-store, must-revalidate'
          }
        });
      }
      return new Response(get404HTML(path), {
        status: 404,
        headers: { 'Content-Type': 'text/html' }
      });
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
        SELECT l.id, l.code, l.destination, l.clicks, l.user_email, l.category_id, l.created_at, l.expires_at,
               l.description, CASE WHEN l.password_hash IS NOT NULL THEN 1 ELSE 0 END as is_protected,
               c.name as category_name, c.slug as category_slug, c.color as category_color,
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
      // Rate limit check
      const rateLimit = await checkRateLimit(env, userEmail, 'api/search');
      if (!rateLimit.allowed) return rateLimitExceeded(rateLimit);

      const q = url.searchParams.get('q') || '';
      if (q.length < 2) {
        return Response.json([]);
      }

      const searchTerm = `%${q}%`;
      const { results } = await env.DB.prepare(`
        SELECT l.*, c.name as category_name, c.slug as category_slug, c.color as category_color
        FROM links l
        LEFT JOIN categories c ON l.category_id = c.id
        WHERE l.user_email = ? AND (l.code LIKE ? OR l.destination LIKE ? OR l.description LIKE ?)
        ORDER BY l.clicks DESC
        LIMIT 10
      `).bind(userEmail, searchTerm, searchTerm, searchTerm).all();

      return Response.json(results);
    }

    // Create new link
    if (path === 'api/links' && request.method === 'POST') {
      // Rate limit check
      const rateLimit = await checkRateLimit(env, userEmail, 'api/links:POST');
      if (!rateLimit.allowed) return rateLimitExceeded(rateLimit);

      const { code, destination, category_id, tags, expires_at, password, description } = await request.json();
      if (!code || !destination) {
        return Response.json({ error: 'Missing code or destination' }, { status: 400 });
      }

      // Validate short code
      const codeValidation = validateCode(code);
      if (!codeValidation.valid) {
        return Response.json({ error: codeValidation.error }, { status: 400 });
      }

      // Validate destination URL
      const urlValidation = validateUrl(destination);
      if (!urlValidation.valid) {
        return Response.json({ error: urlValidation.error }, { status: 400 });
      }

      // Check if code exists globally
      const existing = await env.DB.prepare('SELECT code FROM links WHERE code = ?').bind(codeValidation.code).first();
      if (existing) {
        return Response.json({ error: 'Code already taken' }, { status: 409 });
      }

      try {
        // Hash password if provided
        const passwordHash = password ? await hashPassword(password) : null;

        // Insert link with optional expiration, password, and description
        const result = await env.DB.prepare(
          'INSERT INTO links (code, destination, user_email, category_id, expires_at, password_hash, description) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(codeValidation.code, urlValidation.url, userEmail, category_id || null, expires_at || null, passwordHash, description || null).run();

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
      const { destination, category_id, tags, expires_at, password, remove_password, description } = await request.json();

      // Validate destination URL
      const urlValidation = validateUrl(destination);
      if (!urlValidation.valid) {
        return Response.json({ error: urlValidation.error }, { status: 400 });
      }

      // Get link
      const link = await env.DB.prepare('SELECT id FROM links WHERE code = ? AND user_email = ?').bind(code, userEmail).first();
      if (!link) {
        return Response.json({ error: 'Link not found' }, { status: 404 });
      }

      // Hash password if provided, or set to null if removing
      let passwordHash = undefined; // undefined means don't change
      if (remove_password) {
        passwordHash = null;
      } else if (password) {
        passwordHash = await hashPassword(password);
      }

      // Update link with expiration, optional password, and description
      if (passwordHash !== undefined) {
        await env.DB.prepare('UPDATE links SET destination = ?, category_id = ?, expires_at = ?, password_hash = ?, description = ? WHERE id = ?')
          .bind(urlValidation.url, category_id || null, expires_at || null, passwordHash, description || null, link.id).run();
      } else {
        await env.DB.prepare('UPDATE links SET destination = ?, category_id = ?, expires_at = ?, description = ? WHERE id = ?')
          .bind(urlValidation.url, category_id || null, expires_at || null, description || null, link.id).run();
      }

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
      // Rate limit check
      const rateLimit = await checkRateLimit(env, userEmail, 'api/links:DELETE');
      if (!rateLimit.allowed) return rateLimitExceeded(rateLimit);

      const code = path.replace('api/links/', '');
      await env.DB.prepare('DELETE FROM links WHERE code = ? AND user_email = ?').bind(code, userEmail).run();
      return Response.json({ success: true });
    }

    // Bulk delete links
    if (path === 'api/links/bulk-delete' && request.method === 'POST') {
      // Rate limit check
      const rateLimit = await checkRateLimit(env, userEmail, 'api/links:DELETE');
      if (!rateLimit.allowed) return rateLimitExceeded(rateLimit);

      const { codes } = await request.json();
      if (!codes || !Array.isArray(codes) || codes.length === 0) {
        return Response.json({ error: 'No links specified' }, { status: 400 });
      }

      // Limit bulk operations to 100 items
      if (codes.length > 100) {
        return Response.json({ error: 'Maximum 100 links per bulk operation' }, { status: 400 });
      }

      let deleted = 0;
      for (const code of codes) {
        const result = await env.DB.prepare('DELETE FROM links WHERE code = ? AND user_email = ?')
          .bind(code, userEmail).run();
        if (result.meta.changes > 0) deleted++;
      }

      return Response.json({ success: true, deleted });
    }

    // Bulk move links to category
    if (path === 'api/links/bulk-move' && request.method === 'POST') {
      const { codes, category_id } = await request.json();
      if (!codes || !Array.isArray(codes) || codes.length === 0) {
        return Response.json({ error: 'No links specified' }, { status: 400 });
      }

      // Verify category exists and belongs to user (or null to remove category)
      if (category_id) {
        const cat = await env.DB.prepare('SELECT id FROM categories WHERE id = ? AND user_email = ?')
          .bind(category_id, userEmail).first();
        if (!cat) {
          return Response.json({ error: 'Category not found' }, { status: 404 });
        }
      }

      let updated = 0;
      for (const code of codes) {
        const result = await env.DB.prepare('UPDATE links SET category_id = ? WHERE code = ? AND user_email = ?')
          .bind(category_id || null, code, userEmail).run();
        if (result.meta.changes > 0) updated++;
      }

      return Response.json({ success: true, updated });
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

    // === ANALYTICS API ===

    // Get analytics for a specific link
    if (path.startsWith('api/analytics/') && path !== 'api/analytics/overview' && request.method === 'GET') {
      const code = path.replace('api/analytics/', '');
      const days = parseInt(url.searchParams.get('days') || '30');

      // Get the link
      const link = await env.DB.prepare('SELECT id, code, destination, clicks FROM links WHERE code = ? AND user_email = ?')
        .bind(code, userEmail).first();

      if (!link) {
        return Response.json({ error: 'Link not found' }, { status: 404 });
      }

      // Get click events for this link
      const { results: clickEvents } = await env.DB.prepare(`
        SELECT clicked_at, referrer, country, city, device_type, browser
        FROM click_events
        WHERE link_id = ? AND clicked_at >= datetime('now', '-' || ? || ' days')
        ORDER BY clicked_at DESC
        LIMIT 1000
      `).bind(link.id, days).all();

      // Aggregate by day
      const { results: clicksByDay } = await env.DB.prepare(`
        SELECT DATE(clicked_at) as date, COUNT(*) as clicks
        FROM click_events
        WHERE link_id = ? AND clicked_at >= datetime('now', '-' || ? || ' days')
        GROUP BY DATE(clicked_at)
        ORDER BY date ASC
      `).bind(link.id, days).all();

      // Aggregate by country
      const { results: clicksByCountry } = await env.DB.prepare(`
        SELECT country, COUNT(*) as clicks
        FROM click_events
        WHERE link_id = ? AND clicked_at >= datetime('now', '-' || ? || ' days') AND country != ''
        GROUP BY country
        ORDER BY clicks DESC
        LIMIT 10
      `).bind(link.id, days).all();

      // Aggregate by device
      const { results: clicksByDevice } = await env.DB.prepare(`
        SELECT device_type, COUNT(*) as clicks
        FROM click_events
        WHERE link_id = ? AND clicked_at >= datetime('now', '-' || ? || ' days')
        GROUP BY device_type
        ORDER BY clicks DESC
      `).bind(link.id, days).all();

      // Aggregate by browser
      const { results: clicksByBrowser } = await env.DB.prepare(`
        SELECT browser, COUNT(*) as clicks
        FROM click_events
        WHERE link_id = ? AND clicked_at >= datetime('now', '-' || ? || ' days')
        GROUP BY browser
        ORDER BY clicks DESC
      `).bind(link.id, days).all();

      // Top referrers
      const { results: topReferrers } = await env.DB.prepare(`
        SELECT
          CASE WHEN referrer = '' THEN 'Direct' ELSE referrer END as referrer,
          COUNT(*) as clicks
        FROM click_events
        WHERE link_id = ? AND clicked_at >= datetime('now', '-' || ? || ' days')
        GROUP BY referrer
        ORDER BY clicks DESC
        LIMIT 10
      `).bind(link.id, days).all();

      return Response.json({
        link: { code: link.code, destination: link.destination, totalClicks: link.clicks },
        period: { days, from: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0] },
        clicksByDay,
        clicksByCountry,
        clicksByDevice,
        clicksByBrowser,
        topReferrers,
        recentClicks: clickEvents.slice(0, 50)
      });
    }

    // Get overview analytics for all links
    if (path === 'api/analytics/overview' && request.method === 'GET') {
      const days = parseInt(url.searchParams.get('days') || '30');

      // Total clicks in period
      const totalInPeriod = await env.DB.prepare(`
        SELECT COUNT(*) as clicks
        FROM click_events ce
        JOIN links l ON ce.link_id = l.id
        WHERE l.user_email = ? AND ce.clicked_at >= datetime('now', '-' || ? || ' days')
      `).bind(userEmail, days).first();

      // Clicks by day
      const { results: clicksByDay } = await env.DB.prepare(`
        SELECT DATE(ce.clicked_at) as date, COUNT(*) as clicks
        FROM click_events ce
        JOIN links l ON ce.link_id = l.id
        WHERE l.user_email = ? AND ce.clicked_at >= datetime('now', '-' || ? || ' days')
        GROUP BY DATE(ce.clicked_at)
        ORDER BY date ASC
      `).bind(userEmail, days).all();

      // Top performing links
      const { results: topLinks } = await env.DB.prepare(`
        SELECT l.code, l.destination, COUNT(ce.id) as recent_clicks, l.clicks as total_clicks
        FROM links l
        LEFT JOIN click_events ce ON l.id = ce.link_id AND ce.clicked_at >= datetime('now', '-' || ? || ' days')
        WHERE l.user_email = ?
        GROUP BY l.id
        ORDER BY recent_clicks DESC
        LIMIT 10
      `).bind(days, userEmail).all();

      // Clicks by country
      const { results: clicksByCountry } = await env.DB.prepare(`
        SELECT ce.country, COUNT(*) as clicks
        FROM click_events ce
        JOIN links l ON ce.link_id = l.id
        WHERE l.user_email = ? AND ce.clicked_at >= datetime('now', '-' || ? || ' days') AND ce.country != ''
        GROUP BY ce.country
        ORDER BY clicks DESC
        LIMIT 10
      `).bind(userEmail, days).all();

      // Clicks by device
      const { results: clicksByDevice } = await env.DB.prepare(`
        SELECT ce.device_type, COUNT(*) as clicks
        FROM click_events ce
        JOIN links l ON ce.link_id = l.id
        WHERE l.user_email = ? AND ce.clicked_at >= datetime('now', '-' || ? || ' days')
        GROUP BY ce.device_type
      `).bind(userEmail, days).all();

      return Response.json({
        period: { days },
        totalClicks: totalInPeriod?.clicks || 0,
        clicksByDay,
        topLinks,
        clicksByCountry,
        clicksByDevice
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
      // Rate limit check (stricter for imports)
      const rateLimit = await checkRateLimit(env, userEmail, 'api/import');
      if (!rateLimit.allowed) return rateLimitExceeded(rateLimit);

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

// Parse click data from request headers
function parseClickData(request) {
  const userAgent = request.headers.get('User-Agent') || '';
  const referrer = request.headers.get('Referer') || '';

  // Cloudflare provides geo data in headers
  const country = request.cf?.country || request.headers.get('CF-IPCountry') || '';
  const city = request.cf?.city || '';

  // Parse device type and browser from User-Agent
  const deviceType = parseDeviceType(userAgent);
  const browser = parseBrowser(userAgent);

  return { userAgent, referrer, country, city, deviceType, browser };
}

// Parse device type from User-Agent
function parseDeviceType(ua) {
  const lowerUA = ua.toLowerCase();
  if (/mobile|android|iphone|ipod|blackberry|opera mini|iemobile/i.test(lowerUA)) {
    return 'mobile';
  } else if (/tablet|ipad|playbook|silk/i.test(lowerUA)) {
    return 'tablet';
  } else if (/bot|crawler|spider|crawling/i.test(lowerUA)) {
    return 'bot';
  }
  return 'desktop';
}

// Parse browser from User-Agent
function parseBrowser(ua) {
  if (/edg/i.test(ua)) return 'Edge';
  if (/chrome/i.test(ua) && !/edg/i.test(ua)) return 'Chrome';
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'Safari';
  if (/firefox/i.test(ua)) return 'Firefox';
  if (/opera|opr/i.test(ua)) return 'Opera';
  if (/msie|trident/i.test(ua)) return 'IE';
  return 'Other';
}

// Rate limiting configuration
// These defaults can be overridden via environment variables in wrangler.toml:
//   [vars]
//   RATE_LIMIT_CREATE = "30"
//   RATE_LIMIT_DELETE = "30"
//   RATE_LIMIT_SEARCH = "60"
//   RATE_LIMIT_IMPORT = "5"
//   RATE_LIMIT_REDIRECT = "300"
//   RATE_LIMIT_DEFAULT = "100"
//   RATE_LIMIT_WINDOW = "60"
function getRateLimits(env) {
  const windowSeconds = parseInt(env?.RATE_LIMIT_WINDOW) || 60;
  return {
    'api/links:POST': { limit: parseInt(env?.RATE_LIMIT_CREATE) || 30, windowSeconds },
    'api/links:DELETE': { limit: parseInt(env?.RATE_LIMIT_DELETE) || 30, windowSeconds },
    'api/search': { limit: parseInt(env?.RATE_LIMIT_SEARCH) || 60, windowSeconds },
    'api/import': { limit: parseInt(env?.RATE_LIMIT_IMPORT) || 5, windowSeconds },
    'redirect': { limit: parseInt(env?.RATE_LIMIT_REDIRECT) || 300, windowSeconds },
    'default': { limit: parseInt(env?.RATE_LIMIT_DEFAULT) || 100, windowSeconds }
  };
}

// Check rate limit - returns { allowed: boolean, remaining: number, resetAt: Date }
async function checkRateLimit(env, identifier, endpoint) {
  const rateLimits = getRateLimits(env);
  const config = rateLimits[endpoint] || rateLimits['default'];
  const windowStart = new Date(Date.now() - config.windowSeconds * 1000).toISOString();

  // Clean up old entries (older than 5 minutes)
  await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < datetime("now", "-5 minutes")').run();

  // Get current count
  const existing = await env.DB.prepare(`
    SELECT request_count, window_start FROM rate_limits
    WHERE identifier = ? AND endpoint = ? AND window_start > ?
  `).bind(identifier, endpoint, windowStart).first();

  if (existing) {
    if (existing.request_count >= config.limit) {
      const resetAt = new Date(new Date(existing.window_start).getTime() + config.windowSeconds * 1000);
      return { allowed: false, remaining: 0, resetAt };
    }

    // Increment counter
    await env.DB.prepare(`
      UPDATE rate_limits SET request_count = request_count + 1
      WHERE identifier = ? AND endpoint = ?
    `).bind(identifier, endpoint).run();

    return { allowed: true, remaining: config.limit - existing.request_count - 1, resetAt: null };
  }

  // Create new entry
  await env.DB.prepare(`
    INSERT OR REPLACE INTO rate_limits (identifier, endpoint, request_count, window_start)
    VALUES (?, ?, 1, CURRENT_TIMESTAMP)
  `).bind(identifier, endpoint).run();

  return { allowed: true, remaining: config.limit - 1, resetAt: null };
}

// Get rate limit response headers
function getRateLimitHeaders(env, result, endpoint) {
  const rateLimits = getRateLimits(env);
  const config = rateLimits[endpoint] || rateLimits['default'];
  return {
    'X-RateLimit-Limit': config.limit.toString(),
    'X-RateLimit-Remaining': Math.max(0, result.remaining).toString(),
    'X-RateLimit-Reset': result.resetAt ? Math.floor(result.resetAt.getTime() / 1000).toString() : ''
  };
}

// Rate limit exceeded response
function rateLimitExceeded(result) {
  return new Response(JSON.stringify({
    error: 'Rate limit exceeded',
    retryAfter: result.resetAt ? Math.ceil((result.resetAt.getTime() - Date.now()) / 1000) : 60
  }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': result.resetAt ? Math.ceil((result.resetAt.getTime() - Date.now()) / 1000).toString() : '60'
    }
  });
}

// Validate URL format
function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL is required' };
  }

  // Trim whitespace
  url = url.trim();

  // Check for minimum length
  if (url.length < 10) {
    return { valid: false, error: 'URL is too short' };
  }

  // Check for maximum length
  if (url.length > 2048) {
    return { valid: false, error: 'URL is too long (max 2048 characters)' };
  }

  // Try to parse as URL
  try {
    const parsed = new URL(url);

    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'Only HTTP and HTTPS URLs are allowed' };
    }

    // Check for valid hostname
    if (!parsed.hostname || parsed.hostname.length < 3) {
      return { valid: false, error: 'Invalid hostname' };
    }

    // Block potentially dangerous patterns
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.startsWith('127.') || hostname.startsWith('0.')) {
      return { valid: false, error: 'Local URLs are not allowed' };
    }

    return { valid: true, url: parsed.href };
  } catch (e) {
    return { valid: false, error: 'Invalid URL format' };
  }
}

// Validate short code format
function validateCode(code) {
  if (!code || typeof code !== 'string') {
    return { valid: false, error: 'Short code is required' };
  }

  // Trim whitespace
  code = code.trim();

  // Check length
  if (code.length < 2) {
    return { valid: false, error: 'Short code must be at least 2 characters' };
  }
  if (code.length > 50) {
    return { valid: false, error: 'Short code must be at most 50 characters' };
  }

  // Only allow alphanumeric, hyphens, and underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(code)) {
    return { valid: false, error: 'Short code can only contain letters, numbers, hyphens, and underscores' };
  }

  // Reserved paths
  const reserved = ['admin', 'api', 'static', 'assets', 'favicon', 'robots', 'sitemap'];
  if (reserved.includes(code.toLowerCase())) {
    return { valid: false, error: 'This short code is reserved' };
  }

  return { valid: true, code };
}

// Hash password with random salt for security
async function hashPassword(password) {
  // Generate 16-byte random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');

  // Hash password with salt
  const encoder = new TextEncoder();
  const data = encoder.encode(saltHex + password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

  // Return salt:hash format
  return saltHex + ':' + hashHex;
}

// Verify password against stored salted hash
async function verifyPassword(password, storedHash) {
  // Parse salt and hash from stored value
  const [salt, hash] = storedHash.split(':');

  // If no salt separator found, it's an old unsalted hash - upgrade on next password change
  if (!hash) {
    // Legacy fallback for old hashes (will be replaced when user changes password)
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const computedHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    return computedHash === storedHash;
  }

  // Verify with salt
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const computedHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

  return computedHash === hash;
}

// Generate HTML for password prompt
function getPasswordHTML(code, error = false) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Required - LinkShort</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #09090b;
      color: #fafafa;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      padding: 40px;
      max-width: 400px;
    }
    .icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 24px;
      background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon svg { width: 40px; height: 40px; color: white; }
    h1 { font-size: 28px; margin-bottom: 12px; }
    p { color: #a1a1aa; font-size: 16px; margin-bottom: 24px; }
    form { display: flex; flex-direction: column; gap: 16px; }
    input {
      padding: 12px 16px;
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
      color: #fafafa;
      font-size: 16px;
    }
    input:focus { outline: none; border-color: #6366f1; }
    button {
      padding: 12px 24px;
      background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      border: none;
      border-radius: 8px;
      color: white;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
    }
    button:hover { opacity: 0.9; }
    .error { color: #f87171; font-size: 14px; margin-top: -8px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    </div>
    <h1>Password Required</h1>
    <p>This link is protected. Please enter the password to continue.</p>
    <form method="POST">
      <input type="password" name="password" placeholder="Enter password" required autofocus>
      ${error ? '<div class="error">Incorrect password. Please try again.</div>' : ''}
      <button type="submit">Unlock Link</button>
    </form>
  </div>
</body>
</html>`;
}

// Generate HTML for 404 page
function get404HTML(code) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Link Not Found - LinkShort</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #09090b;
      color: #fafafa;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      padding: 40px;
    }
    .icon {
      width: 100px;
      height: 100px;
      margin: 0 auto 24px;
      background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon svg { width: 50px; height: 50px; color: white; }
    .code-404 {
      font-size: 72px;
      font-weight: 700;
      background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      line-height: 1;
      margin-bottom: 16px;
    }
    h1 { font-size: 28px; margin-bottom: 12px; }
    p { color: #a1a1aa; font-size: 16px; max-width: 400px; margin: 0 auto 24px; }
    .code-display {
      display: inline-block;
      padding: 8px 16px;
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
      font-family: monospace;
      font-size: 14px;
      color: #a855f7;
      margin-bottom: 24px;
    }
    .home-link {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 24px;
      background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      border-radius: 8px;
      color: white;
      text-decoration: none;
      font-weight: 500;
      transition: opacity 0.2s;
    }
    .home-link:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="container">
    <div class="code-404">404</div>
    <h1>Link Not Found</h1>
    <p>The short link you're looking for doesn't exist or may have been removed.</p>
    <div class="code-display">/${code}</div>
    <div>
      <a href="/" class="home-link">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        Go Home
      </a>
    </div>
  </div>
</body>
</html>`;
}

// Generate HTML for expired links
function getExpiredHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Link Expired - LinkShort</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #09090b;
      color: #fafafa;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      padding: 40px;
    }
    .icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 24px;
      background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon svg { width: 40px; height: 40px; color: white; }
    h1 { font-size: 28px; margin-bottom: 12px; }
    p { color: #a1a1aa; font-size: 16px; max-width: 400px; margin: 0 auto; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
    </div>
    <h1>Link Expired</h1>
    <p>This short link is no longer active. It may have reached its expiration date.</p>
  </div>
</body>
</html>`;
}

function getAdminHTML(userEmail) {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LinkShort - Admin</title>
  <link rel="icon" type="image/svg+xml" href="${ADMIN_FAVICON}">
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
    /* Light mode variables */
    .light {
      --background: 0 0% 100%;
      --foreground: 0 0% 3.9%;
      --card: 0 0% 100%;
      --card-foreground: 0 0% 3.9%;
      --popover: 0 0% 100%;
      --popover-foreground: 0 0% 3.9%;
      --primary: 0 0% 9%;
      --primary-foreground: 0 0% 98%;
      --secondary: 0 0% 96.1%;
      --secondary-foreground: 0 0% 9%;
      --muted: 0 0% 96.1%;
      --muted-foreground: 0 0% 45.1%;
      --accent: 0 0% 96.1%;
      --accent-foreground: 0 0% 9%;
      --destructive: 0 84.2% 60.2%;
      --destructive-foreground: 0 0% 98%;
      --border: 0 0% 89.8%;
      --input: 0 0% 89.8%;
      --ring: 0 0% 3.9%;
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
    .user-button-icon { margin-left: auto; opacity: 0.5; }
    .hidden-input { display: none; }
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

    /* Analytics Styles */
    .analytics-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 24px; }
    .analytics-grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
    @media (max-width: 1024px) { .analytics-grid { grid-template-columns: 1fr; } }

    .chart-container { padding: 16px; height: 200px; position: relative; }
    .chart-bars { display: flex; align-items: flex-end; gap: 4px; height: 160px; padding-top: 20px; }
    .chart-bar {
      flex: 1;
      background: linear-gradient(180deg, hsl(var(--indigo)) 0%, hsl(271 91% 65%) 100%);
      border-radius: 4px 4px 0 0;
      min-width: 8px;
      position: relative;
      transition: all 150ms;
    }
    .chart-bar:hover { opacity: 0.8; }
    .chart-bar-label {
      position: absolute;
      bottom: -20px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 10px;
      color: hsl(var(--muted-foreground));
      white-space: nowrap;
    }
    .chart-bar-value {
      position: absolute;
      top: -18px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 11px;
      font-weight: 500;
      color: hsl(var(--foreground));
    }

    .pie-chart { display: flex; gap: 16px; align-items: center; }
    .pie-visual {
      width: 120px; height: 120px;
      border-radius: 50%;
      position: relative;
      flex-shrink: 0;
    }
    .pie-legend { flex: 1; }
    .pie-legend-item {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 0;
      font-size: 13px;
    }
    .pie-legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .pie-legend-value { margin-left: auto; color: hsl(var(--muted-foreground)); }

    .list-stat { padding: 16px; }
    .list-stat-item {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid hsl(var(--border));
    }
    .list-stat-item:last-child { border-bottom: none; }
    .list-stat-label { font-size: 13px; color: hsl(var(--foreground)); }
    .list-stat-value { font-size: 13px; font-weight: 500; color: hsl(var(--indigo)); }
    .list-stat-bar {
      height: 4px;
      background: hsl(var(--indigo));
      border-radius: 2px;
      margin-top: 4px;
    }

    .analytics-modal .modal { max-width: 900px; }
    .analytics-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 16px;
    }
    .analytics-period {
      display: flex; gap: 4px;
    }
    .period-btn {
      padding: 6px 12px;
      font-size: 13px;
      background: transparent;
      border: 1px solid hsl(var(--border));
      border-radius: var(--radius);
      color: hsl(var(--muted-foreground));
      cursor: pointer;
      transition: all 150ms;
    }
    .period-btn:hover { background: hsl(var(--accent)); }
    .period-btn.active { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border-color: hsl(var(--primary)); }

    .recent-clicks-table { max-height: 300px; overflow-y: auto; }
    .recent-clicks-table table { width: 100%; font-size: 12px; }
    .recent-clicks-table th, .recent-clicks-table td { padding: 8px; text-align: left; }
    .recent-clicks-table th { background: hsl(var(--muted) / 0.5); position: sticky; top: 0; }

    /* Analytics page view */
    .page-analytics { display: none; }
    .page-analytics.active { display: block; }
    .page-links { display: block; }
    .page-links.hidden { display: none; }

    /* Bulk actions */
    .bulk-actions {
      display: none;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: hsl(var(--indigo) / 0.1);
      border: 1px solid hsl(var(--indigo) / 0.3);
      border-radius: var(--radius);
      margin-bottom: 16px;
    }
    .bulk-actions.visible { display: flex; }
    .bulk-actions-count {
      font-size: 14px;
      font-weight: 500;
      color: hsl(var(--indigo));
    }
    .bulk-actions-buttons { display: flex; gap: 8px; margin-left: auto; }
    .cell-checkbox { width: 40px; text-align: center; }
    .cell-checkbox input { width: 16px; height: 16px; cursor: pointer; }
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
          <div class="nav-item active" onclick="filterByCategory(null)" data-nav="links">
            <span class="nav-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
            </span>
            <span>All Links</span>
            <span class="nav-item-badge" id="totalLinksNav">0</span>
          </div>
          <div class="nav-item" onclick="showAnalyticsOverview()" data-nav="analytics">
            <span class="nav-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 3v18h18"/>
                <path d="m19 9-5 5-4-4-3 3"/>
              </svg>
            </span>
            <span>Analytics</span>
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
        <button class="user-button" id="logoutBtn">
          <div class="avatar">${userEmail.charAt(0).toUpperCase()}</div>
          <div class="user-info">
            <div class="user-name">${userEmail.split('@')[0]}</div>
            <div class="user-email">${userEmail}</div>
          </div>
          <svg class="user-button-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
          <button class="btn btn-ghost btn-icon sm" onclick="toggleTheme()" title="Toggle theme" id="themeToggle">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="theme-icon-dark">
              <circle cx="12" cy="12" r="4"/>
              <path d="M12 2v2"/>
              <path d="M12 20v2"/>
              <path d="m4.93 4.93 1.41 1.41"/>
              <path d="m17.66 17.66 1.41 1.41"/>
              <path d="M2 12h2"/>
              <path d="M20 12h2"/>
              <path d="m6.34 17.66-1.41 1.41"/>
              <path d="m19.07 4.93-1.41 1.41"/>
            </svg>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="theme-icon-light" style="display: none;">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
            </svg>
          </button>
          <button class="btn btn-outline btn-sm" onclick="exportLinks()">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" x2="12" y1="3" y2="15"/>
            </svg>
            Export
          </button>
          <button class="btn btn-outline btn-sm" id="importBtn" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" x2="12" y1="15" y2="3"/>
            </svg>
            Import
          </button>
          <input type="file" id="importFile" accept=".json" class="hidden-input">
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
                <div style="display: flex; gap: 8px;">
                  <input type="url" class="input" id="newDestination" placeholder="https://example.com/your-long-url" style="flex: 1;">
                  <button type="button" class="btn btn-outline btn-sm" onclick="toggleUTMBuilder()" title="UTM Parameters">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                    UTM
                  </button>
                </div>
              </div>
              <div class="form-group" style="grid-column: span 2;">
                <label class="label">Description (optional)</label>
                <input type="text" class="input" id="newDescription" placeholder="Brief note about this link">
              </div>
              <!-- UTM Builder Panel -->
              <div id="utmBuilder" style="grid-column: 1 / -1; display: none; padding: 16px; background: hsl(var(--muted) / 0.3); border-radius: var(--radius); margin-top: -8px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                  <span style="font-size: 13px; font-weight: 500;">UTM Parameters</span>
                  <button type="button" class="btn btn-ghost btn-sm" onclick="toggleUTMBuilder()">Close</button>
                </div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
                  <div>
                    <label class="label" style="font-size: 12px;">Source *</label>
                    <input type="text" class="input" id="utmSource" placeholder="google, newsletter" style="height: 36px; font-size: 13px;">
                  </div>
                  <div>
                    <label class="label" style="font-size: 12px;">Medium *</label>
                    <input type="text" class="input" id="utmMedium" placeholder="cpc, email, social" style="height: 36px; font-size: 13px;">
                  </div>
                  <div>
                    <label class="label" style="font-size: 12px;">Campaign *</label>
                    <input type="text" class="input" id="utmCampaign" placeholder="spring_sale" style="height: 36px; font-size: 13px;">
                  </div>
                  <div>
                    <label class="label" style="font-size: 12px;">Term (optional)</label>
                    <input type="text" class="input" id="utmTerm" placeholder="running+shoes" style="height: 36px; font-size: 13px;">
                  </div>
                  <div>
                    <label class="label" style="font-size: 12px;">Content (optional)</label>
                    <input type="text" class="input" id="utmContent" placeholder="logolink" style="height: 36px; font-size: 13px;">
                  </div>
                  <div style="display: flex; align-items: flex-end;">
                    <button type="button" class="btn btn-default btn-sm" onclick="applyUTM()" style="width: 100%;">Apply UTM</button>
                  </div>
                </div>
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
                <label class="label">Expires</label>
                <select class="select" id="newExpires">
                  <option value="">Never</option>
                  <option value="1h">1 hour</option>
                  <option value="24h">24 hours</option>
                  <option value="7d">7 days</option>
                  <option value="30d">30 days</option>
                  <option value="90d">90 days</option>
                  <option value="custom">Custom date</option>
                </select>
              </div>
              <div class="form-group" id="customExpiryGroup" style="display: none;">
                <label class="label">Expiry Date</label>
                <input type="datetime-local" class="input" id="newExpiresCustom">
              </div>
              <div class="form-group">
                <label class="label">Password</label>
                <input type="password" class="input" id="newPassword" placeholder="Optional">
              </div>
              <div class="form-group">
                <label class="label">&nbsp;</label>
                <button class="btn btn-default" style="height: 40px;" onclick="createLink()">Create Link</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Bulk Actions Bar -->
        <div class="bulk-actions" id="bulkActions">
          <span class="bulk-actions-count"><span id="bulkCount">0</span> selected</span>
          <button class="btn btn-outline btn-sm" onclick="clearSelection()">Clear</button>
          <div class="bulk-actions-buttons">
            <select class="select sm" id="bulkMoveCategory" style="width: 150px;">
              <option value="">Move to category...</option>
            </select>
            <button class="btn btn-secondary btn-sm" onclick="bulkMove()">Move</button>
            <button class="btn btn-destructive btn-sm" onclick="bulkDelete()">Delete Selected</button>
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
                  <th class="cell-checkbox"><input type="checkbox" id="selectAll" onchange="toggleSelectAll()"></th>
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
          <label class="label">Description</label>
          <input type="text" class="input" id="editDescription" placeholder="Brief note about this link">
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
        <div class="form-group" style="margin-top: 16px;">
          <label class="label">Expires</label>
          <div style="display: flex; gap: 8px;">
            <select class="select" id="editExpires" style="flex: 1;">
              <option value="">Never</option>
              <option value="1h">1 hour from now</option>
              <option value="24h">24 hours from now</option>
              <option value="7d">7 days from now</option>
              <option value="30d">30 days from now</option>
              <option value="custom">Custom date</option>
            </select>
          </div>
        </div>
        <div class="form-group" id="editCustomExpiryGroup" style="display: none; margin-top: 8px;">
          <input type="datetime-local" class="input" id="editExpiresCustom">
        </div>
        <div id="currentExpiryInfo" style="margin-top: 8px; font-size: 12px; color: hsl(var(--muted-foreground));"></div>
        <div class="form-group" style="margin-top: 16px;">
          <label class="label">Password Protection</label>
          <div id="editPasswordInfo" style="font-size: 12px; color: hsl(var(--muted-foreground)); margin-bottom: 8px;"></div>
          <input type="password" class="input" id="editPassword" placeholder="New password (leave blank to keep current)">
          <label style="display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 13px; color: hsl(var(--muted-foreground)); cursor: pointer;">
            <input type="checkbox" id="editRemovePassword" style="width: 16px; height: 16px;">
            Remove password protection
          </label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeEditModal()">Cancel</button>
        <button class="btn btn-default" onclick="saveEdit()">Save Changes</button>
      </div>
    </div>
  </div>

  <!-- QR Code Modal -->
  <div class="modal-overlay" id="qrModal">
    <div class="modal" style="max-width: 400px;">
      <div class="modal-header">
        <h3 class="modal-title">QR Code</h3>
        <button class="btn btn-ghost btn-icon sm" onclick="closeQRModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <div class="modal-body" style="text-align: center;">
        <div id="qrCodeContainer" style="background: white; padding: 24px; border-radius: 8px; display: inline-block; margin-bottom: 16px;"></div>
        <div style="margin-bottom: 8px;">
          <code style="font-size: 14px; color: hsl(var(--indigo));" id="qrLinkUrl"></code>
        </div>
        <p style="font-size: 13px; color: hsl(var(--muted-foreground));">Scan to visit this link</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeQRModal()">Close</button>
        <button class="btn btn-default" onclick="downloadQR()">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" x2="12" y1="15" y2="3"/>
          </svg>
          Download PNG
        </button>
      </div>
    </div>
  </div>

  <!-- Analytics Modal -->
  <div class="modal-overlay analytics-modal" id="analyticsModal">
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title">Link Analytics: <span id="analyticsLinkCode"></span></h3>
        <button class="btn btn-ghost btn-icon sm" onclick="closeAnalyticsModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <div class="modal-body" style="max-height: 70vh; overflow-y: auto;">
        <div class="analytics-header">
          <div>
            <div style="font-size: 13px; color: hsl(var(--muted-foreground));">Total Clicks</div>
            <div style="font-size: 24px; font-weight: 700;" id="analyticsTotalClicks">0</div>
          </div>
          <div class="analytics-period">
            <button class="period-btn" onclick="loadLinkAnalytics(currentAnalyticsCode, 7)">7d</button>
            <button class="period-btn active" onclick="loadLinkAnalytics(currentAnalyticsCode, 30)">30d</button>
            <button class="period-btn" onclick="loadLinkAnalytics(currentAnalyticsCode, 90)">90d</button>
          </div>
        </div>

        <div class="card" style="margin-bottom: 16px;">
          <div class="card-header" style="padding: 12px 16px;">
            <h4 style="font-size: 14px; font-weight: 500;">Clicks Over Time</h4>
          </div>
          <div class="chart-container">
            <div class="chart-bars" id="analyticsClicksChart"></div>
          </div>
        </div>

        <div class="analytics-grid">
          <div class="card">
            <div class="card-header" style="padding: 12px 16px;">
              <h4 style="font-size: 14px; font-weight: 500;">By Country</h4>
            </div>
            <div class="list-stat" id="analyticsCountries"></div>
          </div>
          <div class="card">
            <div class="card-header" style="padding: 12px 16px;">
              <h4 style="font-size: 14px; font-weight: 500;">By Device</h4>
            </div>
            <div class="list-stat" id="analyticsDevices"></div>
          </div>
        </div>

        <div class="analytics-grid">
          <div class="card">
            <div class="card-header" style="padding: 12px 16px;">
              <h4 style="font-size: 14px; font-weight: 500;">By Browser</h4>
            </div>
            <div class="list-stat" id="analyticsBrowsers"></div>
          </div>
          <div class="card">
            <div class="card-header" style="padding: 12px 16px;">
              <h4 style="font-size: 14px; font-weight: 500;">Top Referrers</h4>
            </div>
            <div class="list-stat" id="analyticsReferrers"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header" style="padding: 12px 16px;">
            <h4 style="font-size: 14px; font-weight: 500;">Recent Clicks</h4>
          </div>
          <div class="recent-clicks-table">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Country</th>
                  <th>Device</th>
                  <th>Browser</th>
                  <th>Referrer</th>
                </tr>
              </thead>
              <tbody id="analyticsRecentClicks"></tbody>
            </table>
          </div>
        </div>
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
          <tr data-code="\${link.code}">
            <td class="cell-checkbox"><input type="checkbox" class="link-checkbox" value="\${link.code}" onchange="updateBulkSelection()"></td>
            <td>
              <div class="cell-link">
                \${link.is_protected ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: hsl(var(--indigo)); flex-shrink: 0;" title="Password protected"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' : ''}
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
            <td class="cell-date">
              \${date}
              \${link.expires_at ? getExpiryBadge(link.expires_at) : ''}
            </td>
            <td>
              <div class="cell-actions">
                <button class="btn btn-ghost btn-icon sm" onclick="showQRCode('\${link.code}')" title="QR Code">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect width="5" height="5" x="3" y="3" rx="1"/>
                    <rect width="5" height="5" x="16" y="3" rx="1"/>
                    <rect width="5" height="5" x="3" y="16" rx="1"/>
                    <path d="M21 16h-3a2 2 0 0 0-2 2v3"/>
                    <path d="M21 21v.01"/>
                    <path d="M12 7v3a2 2 0 0 1-2 2H7"/>
                    <path d="M3 12h.01"/>
                    <path d="M12 3h.01"/>
                    <path d="M12 16v.01"/>
                    <path d="M16 12h1"/>
                    <path d="M21 12v.01"/>
                    <path d="M12 21v-1"/>
                  </svg>
                </button>
                <button class="btn btn-ghost btn-icon sm" onclick="showLinkAnalytics('\${link.code}')" title="Analytics">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 3v18h18"/>
                    <path d="m19 9-5 5-4-4-3 3"/>
                  </svg>
                </button>
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
      const description = document.getElementById('newDescription').value.trim() || null;
      const category_id = document.getElementById('newCategory').value || null;
      const expires_at = getExpirationDate('newExpires', 'newExpiresCustom');
      const password = document.getElementById('newPassword').value || null;

      if (!code || !destination) {
        showToast('Missing fields', 'Please enter both code and destination', 'error');
        return;
      }

      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, destination, description, category_id, tags: newTags, expires_at, password })
      });

      if (res.ok) {
        document.getElementById('newCode').value = '';
        document.getElementById('newDestination').value = '';
        document.getElementById('newDescription').value = '';
        document.getElementById('newCategory').value = '';
        document.getElementById('newExpires').value = '';
        document.getElementById('newExpiresCustom').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('customExpiryGroup').style.display = 'none';
        newTags = [];
        renderNewTags();
        showToast('Link created', password ? 'Password-protected link created' : 'Your new short link is ready to use');
        await Promise.all([loadLinks(), loadStats(), loadCategories(), loadTags()]);
      } else {
        const data = await res.json();
        showToast('Error', data.error || 'Failed to create link', 'error');
      }
    }

    // Get expiration date from select and custom input
    function getExpirationDate(selectId, customId) {
      const select = document.getElementById(selectId);
      const custom = document.getElementById(customId);
      const value = select.value;

      if (!value) return null;
      if (value === 'custom') return custom.value ? new Date(custom.value).toISOString() : null;

      const now = new Date();
      switch (value) {
        case '1h': return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
        case '24h': return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
        case '7d': return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        case '30d': return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
        case '90d': return new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
        default: return null;
      }
    }

    // Toggle custom expiry input visibility
    document.getElementById('newExpires').addEventListener('change', (e) => {
      document.getElementById('customExpiryGroup').style.display = e.target.value === 'custom' ? 'block' : 'none';
    });
    document.getElementById('editExpires').addEventListener('change', (e) => {
      document.getElementById('editCustomExpiryGroup').style.display = e.target.value === 'custom' ? 'block' : 'none';
    });

    // UTM Builder functions
    function toggleUTMBuilder() {
      const builder = document.getElementById('utmBuilder');
      builder.style.display = builder.style.display === 'none' ? 'block' : 'none';
    }

    function applyUTM() {
      const source = document.getElementById('utmSource').value.trim();
      const medium = document.getElementById('utmMedium').value.trim();
      const campaign = document.getElementById('utmCampaign').value.trim();
      const term = document.getElementById('utmTerm').value.trim();
      const content = document.getElementById('utmContent').value.trim();

      if (!source || !medium || !campaign) {
        showToast('Missing UTM parameters', 'Source, Medium, and Campaign are required', 'error');
        return;
      }

      const destInput = document.getElementById('newDestination');
      let url = destInput.value.trim();

      if (!url) {
        showToast('Missing URL', 'Please enter a destination URL first', 'error');
        return;
      }

      try {
        const urlObj = new URL(url);

        // Add UTM parameters
        urlObj.searchParams.set('utm_source', source);
        urlObj.searchParams.set('utm_medium', medium);
        urlObj.searchParams.set('utm_campaign', campaign);
        if (term) urlObj.searchParams.set('utm_term', term);
        if (content) urlObj.searchParams.set('utm_content', content);

        destInput.value = urlObj.href;

        // Clear UTM fields and close builder
        document.getElementById('utmSource').value = '';
        document.getElementById('utmMedium').value = '';
        document.getElementById('utmCampaign').value = '';
        document.getElementById('utmTerm').value = '';
        document.getElementById('utmContent').value = '';
        toggleUTMBuilder();

        showToast('UTM Applied', 'UTM parameters added to destination URL');
      } catch (e) {
        showToast('Invalid URL', 'Please enter a valid URL first', 'error');
      }
    }

    // Get expiry badge HTML
    function getExpiryBadge(expiresAt) {
      const expiry = new Date(expiresAt);
      const now = new Date();
      const diffMs = expiry - now;
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (diffMs < 0) {
        return '<span style="display: inline-block; margin-left: 6px; padding: 2px 6px; font-size: 10px; background: hsl(0 84% 60% / 0.15); color: hsl(0 84% 60%); border-radius: 4px;">Expired</span>';
      } else if (diffDays <= 1) {
        return '<span style="display: inline-block; margin-left: 6px; padding: 2px 6px; font-size: 10px; background: hsl(38 92% 50% / 0.15); color: hsl(38 92% 50%); border-radius: 4px;">Expires soon</span>';
      } else if (diffDays <= 7) {
        return \`<span style="display: inline-block; margin-left: 6px; padding: 2px 6px; font-size: 10px; background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); border-radius: 4px;">\${diffDays}d left</span>\`;
      }
      return '';
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
      document.getElementById('editDescription').value = link.description || '';
      document.getElementById('editCategory').value = link.category_id || '';

      // Populate category dropdown
      const catSelect = document.getElementById('editCategory');
      catSelect.innerHTML = '<option value="">No category</option>' + allCategories.map(cat =>
        \`<option value="\${cat.id}" \${cat.id === link.category_id ? 'selected' : ''}>\${cat.name}</option>\`
      ).join('');

      // Set tags
      editTags = link.tags ? [...link.tags] : [];
      renderEditTags();

      // Set expiration info
      const expiryInfo = document.getElementById('currentExpiryInfo');
      const expiresSelect = document.getElementById('editExpires');
      const customGroup = document.getElementById('editCustomExpiryGroup');
      const customInput = document.getElementById('editExpiresCustom');

      expiresSelect.value = '';
      customGroup.style.display = 'none';
      customInput.value = '';

      if (link.expires_at) {
        const expiryDate = new Date(link.expires_at);
        const isExpired = expiryDate < new Date();
        expiryInfo.innerHTML = \`Current: \${expiryDate.toLocaleString()}\${isExpired ? ' <span style="color: hsl(0 84% 60%);">(Expired)</span>' : ''}\`;
        // Set to custom and populate the date
        expiresSelect.value = 'custom';
        customGroup.style.display = 'block';
        customInput.value = expiryDate.toISOString().slice(0, 16);
      } else {
        expiryInfo.textContent = 'Current: Never expires';
      }

      // Set password info
      const passwordInfo = document.getElementById('editPasswordInfo');
      document.getElementById('editPassword').value = '';
      document.getElementById('editRemovePassword').checked = false;
      if (link.is_protected) {
        passwordInfo.innerHTML = '<span style="color: hsl(var(--indigo));">This link is password protected</span>';
      } else {
        passwordInfo.textContent = 'No password set';
      }

      document.getElementById('editModal').classList.add('open');
    }

    function closeEditModal() {
      document.getElementById('editModal').classList.remove('open');
      editTags = [];
    }

    async function saveEdit() {
      const code = document.getElementById('editCode').value;
      const destination = document.getElementById('editDestination').value.trim();
      const description = document.getElementById('editDescription').value.trim() || null;
      const category_id = document.getElementById('editCategory').value || null;
      const expires_at = getExpirationDate('editExpires', 'editExpiresCustom');
      const password = document.getElementById('editPassword').value || null;
      const remove_password = document.getElementById('editRemovePassword').checked;

      if (!destination) {
        showToast('Missing destination', 'Please enter a destination URL', 'error');
        return;
      }

      const res = await fetch('/api/links/' + code, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination, description, category_id, tags: editTags, expires_at, password, remove_password })
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

    // Setup event listeners
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('importBtn').addEventListener('click', function() {
      document.getElementById('importFile').click();
    });
    document.getElementById('importFile').addEventListener('change', importLinks);

    // Analytics
    let currentAnalyticsCode = null;

    async function showLinkAnalytics(code) {
      currentAnalyticsCode = code;
      document.getElementById('analyticsLinkCode').textContent = '/' + code;
      document.getElementById('analyticsModal').classList.add('open');
      await loadLinkAnalytics(code, 30);
    }

    async function loadLinkAnalytics(code, days) {
      // Update period buttons
      document.querySelectorAll('.period-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent === days + 'd');
      });

      const res = await fetch('/api/analytics/' + code + '?days=' + days);
      const data = await res.json();

      // Total clicks
      document.getElementById('analyticsTotalClicks').textContent = data.link.totalClicks.toLocaleString();

      // Clicks chart
      renderClicksChart(data.clicksByDay, days);

      // Countries
      renderListStats('analyticsCountries', data.clicksByCountry, 'country');

      // Devices
      renderListStats('analyticsDevices', data.clicksByDevice, 'device_type');

      // Browsers
      renderListStats('analyticsBrowsers', data.clicksByBrowser, 'browser');

      // Referrers
      renderListStats('analyticsReferrers', data.topReferrers, 'referrer');

      // Recent clicks
      renderRecentClicks(data.recentClicks);
    }

    function renderClicksChart(clicksByDay, days) {
      const container = document.getElementById('analyticsClicksChart');

      if (!clicksByDay || clicksByDay.length === 0) {
        container.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: hsl(var(--muted-foreground));">No click data yet</div>';
        return;
      }

      // Fill in missing dates
      const dateMap = {};
      clicksByDay.forEach(d => { dateMap[d.date] = d.clicks; });

      const dates = [];
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        const dateStr = date.toISOString().split('T')[0];
        dates.push({ date: dateStr, clicks: dateMap[dateStr] || 0 });
      }

      const maxClicks = Math.max(...dates.map(d => d.clicks), 1);

      // Only show labels for some bars to avoid crowding
      const labelInterval = days <= 7 ? 1 : days <= 30 ? 5 : 10;

      container.innerHTML = dates.map((d, i) => {
        const height = (d.clicks / maxClicks) * 140;
        const showLabel = i % labelInterval === 0 || i === dates.length - 1;
        const dateLabel = new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        return \`
          <div class="chart-bar" style="height: \${Math.max(height, 4)}px;" title="\${dateLabel}: \${d.clicks} clicks">
            \${d.clicks > 0 ? \`<span class="chart-bar-value">\${d.clicks}</span>\` : ''}
            \${showLabel ? \`<span class="chart-bar-label">\${dateLabel}</span>\` : ''}
          </div>
        \`;
      }).join('');
    }

    function renderListStats(containerId, items, labelKey) {
      const container = document.getElementById(containerId);

      if (!items || items.length === 0) {
        container.innerHTML = '<div style="padding: 16px; text-align: center; color: hsl(var(--muted-foreground)); font-size: 13px;">No data</div>';
        return;
      }

      const maxClicks = Math.max(...items.map(i => i.clicks));

      container.innerHTML = items.slice(0, 5).map(item => {
        const label = item[labelKey] || 'Unknown';
        const barWidth = (item.clicks / maxClicks) * 100;

        return \`
          <div class="list-stat-item">
            <div style="flex: 1;">
              <div class="list-stat-label">\${label}</div>
              <div class="list-stat-bar" style="width: \${barWidth}%;"></div>
            </div>
            <span class="list-stat-value">\${item.clicks}</span>
          </div>
        \`;
      }).join('');
    }

    function renderRecentClicks(clicks) {
      const container = document.getElementById('analyticsRecentClicks');

      if (!clicks || clicks.length === 0) {
        container.innerHTML = '<tr><td colspan="5" style="text-align: center; color: hsl(var(--muted-foreground));">No recent clicks</td></tr>';
        return;
      }

      container.innerHTML = clicks.map(click => {
        const time = new Date(click.clicked_at).toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
        });
        const referrer = click.referrer ? new URL(click.referrer).hostname : 'Direct';

        return \`
          <tr>
            <td>\${time}</td>
            <td>\${click.country || '-'}</td>
            <td>\${click.device_type || '-'}</td>
            <td>\${click.browser || '-'}</td>
            <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis;">\${referrer}</td>
          </tr>
        \`;
      }).join('');
    }

    function closeAnalyticsModal() {
      document.getElementById('analyticsModal').classList.remove('open');
      currentAnalyticsCode = null;
    }

    // Analytics overview page
    async function showAnalyticsOverview() {
      // Update nav active state
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      document.querySelector('[data-nav="analytics"]').classList.add('active');

      // For now, show a toast - we could expand this to a full page
      showToast('Analytics Overview', 'Click on individual link analytics buttons to see detailed stats');
    }

    // Close analytics modal on escape or backdrop click
    document.getElementById('analyticsModal').addEventListener('click', (e) => {
      if (e.target.id === 'analyticsModal') closeAnalyticsModal();
    });

    // QR Code functionality
    let currentQRCode = null;

    function showQRCode(code) {
      const url = baseUrl + '/' + code;
      document.getElementById('qrLinkUrl').textContent = url;
      document.getElementById('qrModal').classList.add('open');

      // Generate QR code
      const container = document.getElementById('qrCodeContainer');
      container.innerHTML = '';

      try {
        const qr = generateQR(url);
        const svg = qrToSVG(qr, 200);
        container.innerHTML = svg;
        currentQRCode = { code, url, svg };
      } catch (e) {
        container.innerHTML = '<p style="color: #666;">Failed to generate QR code</p>';
      }
    }

    function closeQRModal() {
      document.getElementById('qrModal').classList.remove('open');
      currentQRCode = null;
    }

    async function downloadQR() {
      if (!currentQRCode) return;

      const svg = document.querySelector('#qrCodeContainer svg');
      if (!svg) return;

      // Convert SVG to PNG using canvas
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = 400;
      canvas.height = 400;

      // Create image from SVG
      const svgData = new XMLSerializer().serializeToString(svg);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 50, 50, 300, 300);
        URL.revokeObjectURL(svgUrl);

        // Download
        canvas.toBlob((blob) => {
          const link = document.createElement('a');
          link.download = 'qr-' + currentQRCode.code + '.png';
          link.href = URL.createObjectURL(blob);
          link.click();
          URL.revokeObjectURL(link.href);
        }, 'image/png');
      };
      img.src = svgUrl;

      showToast('Downloading', 'QR code is being downloaded');
    }

    // Close QR modal on escape or backdrop click
    document.getElementById('qrModal').addEventListener('click', (e) => {
      if (e.target.id === 'qrModal') closeQRModal();
    });

    // Bulk operations
    let selectedLinks = new Set();

    function toggleSelectAll() {
      const selectAll = document.getElementById('selectAll');
      const checkboxes = document.querySelectorAll('.link-checkbox');

      checkboxes.forEach(cb => {
        cb.checked = selectAll.checked;
        if (selectAll.checked) {
          selectedLinks.add(cb.value);
        } else {
          selectedLinks.delete(cb.value);
        }
      });

      updateBulkUI();
    }

    function updateBulkSelection() {
      selectedLinks.clear();
      document.querySelectorAll('.link-checkbox:checked').forEach(cb => {
        selectedLinks.add(cb.value);
      });
      updateBulkUI();
    }

    function updateBulkUI() {
      const bulkActions = document.getElementById('bulkActions');
      const bulkCount = document.getElementById('bulkCount');
      const selectAll = document.getElementById('selectAll');

      if (selectedLinks.size > 0) {
        bulkActions.classList.add('visible');
        bulkCount.textContent = selectedLinks.size;
      } else {
        bulkActions.classList.remove('visible');
      }

      // Update select all checkbox state
      const checkboxes = document.querySelectorAll('.link-checkbox');
      const checkedCount = document.querySelectorAll('.link-checkbox:checked').length;
      selectAll.checked = checkedCount > 0 && checkedCount === checkboxes.length;
      selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;

      // Update bulk move category dropdown
      const bulkMoveSelect = document.getElementById('bulkMoveCategory');
      bulkMoveSelect.innerHTML = '<option value="">Move to category...</option><option value="none">Remove category</option>' +
        allCategories.map(cat => \`<option value="\${cat.id}">\${cat.name}</option>\`).join('');
    }

    function clearSelection() {
      selectedLinks.clear();
      document.querySelectorAll('.link-checkbox').forEach(cb => cb.checked = false);
      document.getElementById('selectAll').checked = false;
      updateBulkUI();
    }

    async function bulkDelete() {
      if (selectedLinks.size === 0) return;

      if (!confirm(\`Delete \${selectedLinks.size} link(s)? This cannot be undone.\`)) return;

      const codes = Array.from(selectedLinks);
      const res = await fetch('/api/links/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes })
      });

      if (res.ok) {
        const data = await res.json();
        showToast('Links deleted', \`\${data.deleted} link(s) deleted successfully\`);
        clearSelection();
        await Promise.all([loadLinks(), loadStats(), loadCategories()]);
      } else {
        const data = await res.json();
        showToast('Error', data.error || 'Failed to delete links', 'error');
      }
    }

    async function bulkMove() {
      if (selectedLinks.size === 0) return;

      const categoryId = document.getElementById('bulkMoveCategory').value;
      if (!categoryId) {
        showToast('Select category', 'Please select a category to move links to', 'error');
        return;
      }

      const codes = Array.from(selectedLinks);
      const res = await fetch('/api/links/bulk-move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes, category_id: categoryId === 'none' ? null : categoryId })
      });

      if (res.ok) {
        const data = await res.json();
        showToast('Links moved', \`\${data.updated} link(s) moved successfully\`);
        clearSelection();
        document.getElementById('bulkMoveCategory').value = '';
        await Promise.all([loadLinks(), loadCategories()]);
      } else {
        const data = await res.json();
        showToast('Error', data.error || 'Failed to move links', 'error');
      }
    }

    // Minimal QR Code Generator
    // Note: Custom implementation used because Cloudflare Workers doesn't natively support
    // npm packages without a bundler. This self-contained implementation handles URL encoding
    // with byte mode for versions 1-10. For production deployments requiring extensive QR
    // features, consider adding a build step with Wrangler and using a library like 'qrcode-svg'.
    // See: https://developers.cloudflare.com/workers/wrangler/bundling/
    function generateQR(text) {
      // Use a simple approach: encode as binary/byte mode
      const data = encodeData(text);
      const version = getMinVersion(data.length);
      const size = version * 4 + 17;

      // Create matrix
      const matrix = Array(size).fill(null).map(() => Array(size).fill(null));

      // Add finder patterns
      addFinderPattern(matrix, 0, 0);
      addFinderPattern(matrix, size - 7, 0);
      addFinderPattern(matrix, 0, size - 7);

      // Add alignment patterns (for version >= 2)
      if (version >= 2) {
        const alignPos = getAlignmentPositions(version);
        for (const row of alignPos) {
          for (const col of alignPos) {
            if (matrix[row]?.[col] === null) {
              addAlignmentPattern(matrix, row, col);
            }
          }
        }
      }

      // Add timing patterns
      for (let i = 8; i < size - 8; i++) {
        matrix[6][i] = i % 2 === 0;
        matrix[i][6] = i % 2 === 0;
      }

      // Dark module
      matrix[size - 8][8] = true;

      // Reserve format info areas
      for (let i = 0; i < 9; i++) {
        if (matrix[8][i] === null) matrix[8][i] = false;
        if (matrix[i][8] === null) matrix[i][8] = false;
        if (matrix[8][size - 1 - i] === null) matrix[8][size - 1 - i] = false;
        if (matrix[size - 1 - i][8] === null) matrix[size - 1 - i][8] = false;
      }

      // Place data
      placeData(matrix, data, version);

      // Apply mask (using mask 0 for simplicity)
      applyMask(matrix);

      // Add format info
      addFormatInfo(matrix, size);

      return matrix;
    }

    function encodeData(text) {
      // Byte mode encoding (mode indicator: 0100)
      const bytes = new TextEncoder().encode(text);
      const bits = [0, 1, 0, 0]; // Mode indicator for byte

      // Character count (8 bits for version 1-9)
      const countBits = bytes.length.toString(2).padStart(8, '0').split('').map(Number);
      bits.push(...countBits);

      // Data
      for (const byte of bytes) {
        const byteBits = byte.toString(2).padStart(8, '0').split('').map(Number);
        bits.push(...byteBits);
      }

      // Terminator
      bits.push(0, 0, 0, 0);

      // Pad to byte boundary
      while (bits.length % 8 !== 0) bits.push(0);

      // Add padding codewords
      const padBytes = [236, 17];
      let padIndex = 0;
      const capacity = getDataCapacity(getMinVersion(bytes.length));
      while (bits.length < capacity * 8) {
        const padBits = padBytes[padIndex % 2].toString(2).padStart(8, '0').split('').map(Number);
        bits.push(...padBits);
        padIndex++;
      }

      return bits;
    }

    function getMinVersion(dataLength) {
      // Simplified version selection (byte mode, L error correction)
      const capacities = [17, 32, 53, 78, 106, 134, 154, 192, 230, 271];
      for (let v = 1; v <= 10; v++) {
        if (dataLength <= capacities[v - 1]) return v;
      }
      return 10;
    }

    function getDataCapacity(version) {
      const capacities = [19, 34, 55, 80, 108, 136, 156, 194, 232, 274];
      return capacities[version - 1] || capacities[0];
    }

    function getAlignmentPositions(version) {
      if (version === 1) return [];
      const positions = [6];
      const step = Math.floor((version * 4 + 10) / (Math.floor(version / 7) + 1));
      let pos = version * 4 + 10;
      while (pos > 10) {
        positions.unshift(pos);
        pos -= step;
      }
      return positions;
    }

    function addFinderPattern(matrix, row, col) {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const mr = row + r, mc = col + c;
          if (mr < 0 || mc < 0 || mr >= matrix.length || mc >= matrix.length) continue;
          if (r === -1 || r === 7 || c === -1 || c === 7) {
            matrix[mr][mc] = false; // Separator
          } else if (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
            matrix[mr][mc] = true;
          } else {
            matrix[mr][mc] = false;
          }
        }
      }
    }

    function addAlignmentPattern(matrix, row, col) {
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const mr = row + r, mc = col + c;
          if (mr < 0 || mc < 0 || mr >= matrix.length || mc >= matrix.length) continue;
          if (matrix[mr][mc] !== null) continue;
          if (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0)) {
            matrix[mr][mc] = true;
          } else {
            matrix[mr][mc] = false;
          }
        }
      }
    }

    function placeData(matrix, data, version) {
      const size = matrix.length;
      let dataIndex = 0;
      let upward = true;

      for (let col = size - 1; col >= 1; col -= 2) {
        if (col === 6) col = 5; // Skip timing pattern column

        for (let row = upward ? size - 1 : 0; upward ? row >= 0 : row < size; upward ? row-- : row++) {
          for (let c = 0; c < 2; c++) {
            const currentCol = col - c;
            if (matrix[row][currentCol] === null) {
              matrix[row][currentCol] = dataIndex < data.length ? data[dataIndex++] === 1 : false;
            }
          }
        }
        upward = !upward;
      }
    }

    function applyMask(matrix) {
      const size = matrix.length;
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          if (isDataModule(matrix, row, col, size)) {
            // Mask pattern 0: (row + col) % 2 === 0
            if ((row + col) % 2 === 0) {
              matrix[row][col] = !matrix[row][col];
            }
          }
        }
      }
    }

    function isDataModule(matrix, row, col, size) {
      // Check if this is a data module (not a function pattern)
      if (row < 9 && col < 9) return false; // Top-left finder
      if (row < 9 && col >= size - 8) return false; // Top-right finder
      if (row >= size - 8 && col < 9) return false; // Bottom-left finder
      if (row === 6 || col === 6) return false; // Timing patterns
      return true;
    }

    function addFormatInfo(matrix, size) {
      // Format string for mask 0, error correction L
      const formatBits = [1,1,1,0,1,1,1,1,1,0,0,0,1,0,0];

      // Place format info
      for (let i = 0; i < 6; i++) {
        matrix[8][i] = formatBits[i] === 1;
        matrix[i][8] = formatBits[14 - i] === 1;
      }
      matrix[8][7] = formatBits[6] === 1;
      matrix[8][8] = formatBits[7] === 1;
      matrix[7][8] = formatBits[8] === 1;

      for (let i = 0; i < 7; i++) {
        matrix[8][size - 1 - i] = formatBits[14 - i] === 1;
        matrix[size - 1 - i][8] = formatBits[i] === 1;
      }
      matrix[size - 8][8] = true; // Always dark
    }

    function qrToSVG(matrix, size) {
      const moduleCount = matrix.length;
      const moduleSize = size / moduleCount;

      let svg = \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 \${size} \${size}" width="\${size}" height="\${size}">\`;
      svg += \`<rect width="\${size}" height="\${size}" fill="white"/>\`;

      for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
          if (matrix[row][col]) {
            svg += \`<rect x="\${col * moduleSize}" y="\${row * moduleSize}" width="\${moduleSize}" height="\${moduleSize}" fill="black"/>\`;
          }
        }
      }

      svg += '</svg>';
      return svg;
    }

    // Theme toggle
    function toggleTheme() {
      const html = document.documentElement;
      const isDark = html.classList.contains('dark');

      if (isDark) {
        html.classList.remove('dark');
        html.classList.add('light');
        localStorage.setItem('theme', 'light');
      } else {
        html.classList.remove('light');
        html.classList.add('dark');
        localStorage.setItem('theme', 'dark');
      }
      updateThemeIcon();
    }

    function updateThemeIcon() {
      const isDark = document.documentElement.classList.contains('dark');
      document.querySelector('.theme-icon-dark').style.display = isDark ? 'block' : 'none';
      document.querySelector('.theme-icon-light').style.display = isDark ? 'none' : 'block';
    }

    // Initialize theme from localStorage
    function initTheme() {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme === 'light') {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
      }
      updateThemeIcon();
    }
    initTheme();

    // Init
    init();
  </script>
</body>
</html>`;
}
