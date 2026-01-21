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
    
    // List user's links
    if (path === 'api/links' && request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM links WHERE user_email = ? ORDER BY created_at DESC').bind(userEmail).all();
      return Response.json(results);
    }
    
    // Create new link
    if (path === 'api/links' && request.method === 'POST') {
      const { code, destination } = await request.json();
      if (!code || !destination) {
        return Response.json({ error: 'Missing code or destination' }, { status: 400 });
      }
      // Check if code exists globally (short codes must be unique across all users)
      const existing = await env.DB.prepare('SELECT code FROM links WHERE code = ?').bind(code).first();
      if (existing) {
        return Response.json({ error: 'Code already taken' }, { status: 409 });
      }
      try {
        await env.DB.prepare('INSERT INTO links (code, destination, user_email) VALUES (?, ?, ?)').bind(code, destination, userEmail).run();
        return Response.json({ success: true, code, destination });
      } catch (e) {
        return Response.json({ error: 'Failed to create link' }, { status: 500 });
      }
    }
    
    // Delete link (only own links)
    if (path.startsWith('api/links/') && request.method === 'DELETE') {
      const code = path.replace('api/links/', '');
      await env.DB.prepare('DELETE FROM links WHERE code = ? AND user_email = ?').bind(code, userEmail).run();
      return Response.json({ success: true });
    }
    
    // Export user's links
    if (path === 'api/export' && request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT code, destination, clicks, created_at FROM links WHERE user_email = ? ORDER BY created_at DESC').bind(userEmail).all();
      return new Response(JSON.stringify(results, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="links-export-${new Date().toISOString().split('T')[0]}.json"`
        }
      });
    }
    
    // Import links
    if (path === 'api/import' && request.method === 'POST') {
      try {
        const links = await request.json();
        let imported = 0;
        let skipped = 0;
        
        for (const link of links) {
          if (!link.code || !link.destination) continue;
          
          // Check if code exists
          const existing = await env.DB.prepare('SELECT code FROM links WHERE code = ?').bind(link.code).first();
          if (existing) {
            skipped++;
            continue;
          }
          
          await env.DB.prepare('INSERT INTO links (code, destination, user_email, clicks) VALUES (?, ?, ?, ?)').bind(link.code, link.destination, userEmail, link.clicks || 0).run();
          imported++;
        }
        
        return Response.json({ success: true, imported, skipped });
      } catch (e) {
        return Response.json({ error: 'Invalid JSON format' }, { status: 400 });
      }
    }
    
    return new Response('Not found', { status: 404 });
  }
};

// Decode Cloudflare Access JWT to get user email
async function getUserEmail(request) {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) return null;
  
  try {
    // JWT is base64url encoded: header.payload.signature
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    
    // Decode payload (middle part)
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.email || null;
  } catch (e) {
    return null;
  }
}

function getAdminHTML(userEmail) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Link Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; padding: 2rem; }
    .container { max-width: 900px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; flex-wrap: wrap; gap: 1rem; }
    h1 { color: #fff; }
    .user-info { color: #94a3b8; font-size: 0.875rem; }
    .user-email { color: #3b82f6; }
    .toolbar { display: flex; gap: 0.5rem; }
    .form-row { display: flex; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap; }
    input { flex: 1; min-width: 200px; padding: 0.75rem 1rem; border: 1px solid #334155; border-radius: 8px; background: #1e293b; color: #fff; font-size: 1rem; }
    input:focus { outline: none; border-color: #3b82f6; }
    input::placeholder { color: #64748b; }
    button { padding: 0.75rem 1.5rem; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; transition: background 0.2s; white-space: nowrap; }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-primary:hover { background: #2563eb; }
    .btn-secondary { background: #334155; color: #e2e8f0; }
    .btn-secondary:hover { background: #475569; }
    .btn-danger { background: #ef4444; color: #fff; padding: 0.5rem 1rem; font-size: 0.875rem; }
    .btn-danger:hover { background: #dc2626; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { text-align: left; padding: 1rem; border-bottom: 1px solid #334155; }
    th { color: #94a3b8; font-weight: 500; font-size: 0.875rem; text-transform: uppercase; }
    td { color: #e2e8f0; }
    a { color: #3b82f6; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .clicks { color: #94a3b8; }
    .empty { text-align: center; padding: 3rem; color: #64748b; }
    .toast { position: fixed; bottom: 2rem; right: 2rem; padding: 1rem 1.5rem; border-radius: 8px; color: #fff; opacity: 0; transition: opacity 0.3s; z-index: 100; }
    .toast.success { background: #22c55e; }
    .toast.error { background: #ef4444; }
    .toast.show { opacity: 1; }
    .short-link { font-family: monospace; background: #334155; padding: 0.25rem 0.5rem; border-radius: 4px; }
    .stats { display: flex; gap: 2rem; margin-bottom: 2rem; }
    .stat { background: #1e293b; padding: 1rem 1.5rem; border-radius: 8px; }
    .stat-value { font-size: 1.5rem; font-weight: 600; color: #fff; }
    .stat-label { font-size: 0.875rem; color: #94a3b8; }
    input[type="file"] { display: none; }
    @media (max-width: 640px) {
      .form-row { flex-direction: column; }
      input { min-width: 100%; }
      table { font-size: 0.875rem; }
      th, td { padding: 0.75rem 0.5rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🔗 Link Admin</h1>
      <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
        <span class="user-info">Logged in as <span class="user-email">${userEmail}</span></span>
        <div class="toolbar">
          <button class="btn-secondary" onclick="exportLinks()">Export</button>
          <label class="btn-secondary" style="cursor: pointer;">
            Import
            <input type="file" id="importFile" accept=".json" onchange="importLinks(event)">
          </label>
        </div>
      </div>
    </header>
    
    <div class="stats">
      <div class="stat">
        <div class="stat-value" id="totalLinks">-</div>
        <div class="stat-label">Total Links</div>
      </div>
      <div class="stat">
        <div class="stat-value" id="totalClicks">-</div>
        <div class="stat-label">Total Clicks</div>
      </div>
    </div>
    
    <div class="form-row">
      <input type="text" id="code" placeholder="Short code (e.g. portfolio)">
      <input type="url" id="destination" placeholder="Destination URL (e.g. https://example.com)">
      <button class="btn-primary" onclick="addLink()">Add Link</button>
    </div>
    
    <table>
      <thead>
        <tr>
          <th>Short Link</th>
          <th>Destination</th>
          <th>Clicks</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="links"></tbody>
    </table>
  </div>
  
  <div class="toast" id="toast"></div>

  <script>
    const baseUrl = window.location.origin;
    
    async function loadLinks() {
      const res = await fetch('/api/links');
      const links = await res.json();
      const tbody = document.getElementById('links');
      
      // Update stats
      document.getElementById('totalLinks').textContent = links.length;
      document.getElementById('totalClicks').textContent = links.reduce((sum, l) => sum + (l.clicks || 0), 0);
      
      if (links.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty">No links yet. Add your first one above!</td></tr>';
        return;
      }
      
      tbody.innerHTML = links.map(link => \`
        <tr>
          <td><a href="\${baseUrl}/\${link.code}" target="_blank" class="short-link">/\${link.code}</a></td>
          <td><a href="\${link.destination}" target="_blank">\${link.destination.length > 40 ? link.destination.substring(0, 40) + '...' : link.destination}</a></td>
          <td class="clicks">\${link.clicks}</td>
          <td><button class="btn-danger" onclick="deleteLink('\${link.code}')">Delete</button></td>
        </tr>
      \`).join('');
    }
    
    async function addLink() {
      const code = document.getElementById('code').value.trim();
      const destination = document.getElementById('destination').value.trim();
      
      if (!code || !destination) {
        showToast('Please fill in both fields', 'error');
        return;
      }
      
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, destination })
      });
      
      if (res.ok) {
        document.getElementById('code').value = '';
        document.getElementById('destination').value = '';
        showToast('Link created!', 'success');
        loadLinks();
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed to create link', 'error');
      }
    }
    
    async function deleteLink(code) {
      if (!confirm('Delete this link?')) return;
      
      await fetch(\`/api/links/\${code}\`, { method: 'DELETE' });
      showToast('Link deleted', 'success');
      loadLinks();
    }
    
    function exportLinks() {
      window.location.href = '/api/export';
      showToast('Downloading export...', 'success');
    }
    
    async function importLinks(event) {
      const file = event.target.files[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const links = JSON.parse(text);
        
        const res = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(links)
        });
        
        const data = await res.json();
        if (res.ok) {
          showToast(\`Imported \${data.imported} links (\${data.skipped} skipped)\`, 'success');
          loadLinks();
        } else {
          showToast(data.error || 'Import failed', 'error');
        }
      } catch (e) {
        showToast('Invalid JSON file', 'error');
      }
      
      event.target.value = '';
    }
    
    function showToast(message, type) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = \`toast \${type} show\`;
      setTimeout(() => toast.classList.remove('show'), 3000);
    }
    
    document.getElementById('code').addEventListener('keypress', e => {
      if (e.key === 'Enter') document.getElementById('destination').focus();
    });
    
    document.getElementById('destination').addEventListener('keypress', e => {
      if (e.key === 'Enter') addLink();
    });
    
    loadLinks();
  </script>
</body>
</html>`;
}
