const categories = {
  custom: 'Custom Flight Cases', instruments: 'Musical Instrument Cases',
  audio: 'DJ & Audio Equipment Cases', displays: 'LED & LCD Display Cases',
  industrial: 'Industrial Equipment Cases', tools: 'Tool Cases',
  trolleys: 'Trolley Cases', other: 'Not sure yet'
};
const fields = ['name', 'phone', 'email', 'caseType', 'message', 'submittedAt'];
const labels = ['Name', 'Phone', 'Email', 'Case type', 'Project details', 'Submitted (UTC)'];
const cookieName = '__Host-raman_admin';
const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};
const error = (status, message) => Object.assign(new Error(message), { status });
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);
const hex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const token = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const hash = async (value) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
async function matches(a, b) {
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
function response(body, status = 200, type = 'text/html; charset=utf-8', extra = {}) {
  return new Response(body, { status, headers: { ...securityHeaders, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra } });
}
const json = (body, status = 200) => response(JSON.stringify(body), status, 'application/json; charset=utf-8');
const wantsJson = (request) => request.headers.get('accept')?.includes('application/json');
const html = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${escape(title)} | Raman Flight Case</title><link rel="stylesheet" href="/styles.css"></head>
<body><main class="wrap admin"><h1>${escape(title)}</h1>${body}</main></body></html>`;
const redirect = (cookie) => response(null, 303, undefined, { Location: '/admin', ...(cookie && { 'Set-Cookie': cookie }) });
const cookie = (value, age) => `${cookieName}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Strict`;

async function form(request) {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if ((origin && origin !== new URL(request.url).origin) || (site && !['same-origin', 'none'].includes(site))) {
    throw error(403, 'This request must come from this website.');
  }
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') {
    throw error(415, 'Unsupported form format.');
  }
  const max = 30000;
  if (Number(request.headers.get('content-length')) > max) throw error(413, 'This request is too large.');
  const reader = request.body?.getReader();
  if (!reader) return new URLSearchParams();
  let size = 0, body = '';
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw error(413, 'This request is too large.'); }
    body += decoder.decode(value, { stream: true });
  }
  return new URLSearchParams(body + decoder.decode());
}
async function limit(db, request, scope, cap) {
  const window = Math.floor(Date.now() / 900000);
  const address = request.headers.get('CF-Connecting-IP') || 'local';
  const key = await hash(`${scope}:${window}:${address}`);
  const { count } = await db.prepare(`INSERT INTO rate_limits (key, period, count) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count`).bind(key, window, cap).first() || {};
  if (!count) throw error(429, 'Too many attempts. Please try again later.');
  if (count === 1 && Math.random() < 0.03) await db.prepare('DELETE FROM rate_limits WHERE period < ?').bind(window - 1).run();
}
const success = 'We received your quote request. Raman Flight Case will use the contact details you provided to follow up.';
function quoteResult(request, status, message) {
  return wantsJson(request) ? json({ message }, status) : response(html(status < 400 ? 'Quote request received' : 'Quote request could not be sent',
    `<p>${escape(message)}</p><a href="/contact#quote">Back to the contact page</a>`), status);
}
function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\t\r\n]|^\s*[=+@\-＝＋＠－]/u.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}
function fieldValue(row, field) {
  return field === 'caseType' ? (Object.hasOwn(categories, row[field]) ? categories[row[field]] : '—') : row[field];
}
function adminPage(rows, csrf) {
  const content = rows.map((row) => '<tr>' + fields.map((field) => `<td>${escape(fieldValue(row, field))}</td>`).join('') + '</tr>').join('');
  return html('Quote requests', `<p>Showing the most recent ${rows.length} request(s). Export a CSV for more.</p>
<div class="actions"><a class="button" href="/download-csv">Download CSV</a><a class="button outline" href="/">View website</a></div>
<div class="table-wrap" tabindex="0" role="region" aria-label="Quote request records"><table><thead><tr>${labels.map((label) => `<th scope="col">${label}</th>`).join('')}</tr></thead>
<tbody>${content || '<tr><td colspan="6">No requests yet.</td></tr>'}</tbody></table></div>
<form method="post" action="/admin/logout"><input type="hidden" name="csrf" value="${csrf}"><button class="button outline">Sign out</button></form>`);
}
const login = html('Admin sign in', `<form method="post" action="/admin/login">
<label>Password <input type="password" name="password" autocomplete="current-password" maxlength="512" required></label>
<p><button class="button">Sign in</button></p></form><a href="/">Return to the website</a>`);

export async function handle(request, env) {
  const path = new URL(request.url).pathname.replace(/\/$/, '') || '/';
  const method = request.method;
  const db = env.QUOTES_DB;
  try {
    if (path === '/submit') {
      if (method !== 'POST') return response(null, 405, undefined, { Allow: 'POST' });
      const values = await form(request);
      if (!db) throw error(503, 'Quote requests are temporarily unavailable. Please contact us on WhatsApp.');
      await limit(db, request, 'quote', 12);
      if (values.get('website')) return quoteResult(request, 201, success);
      const row = fields.slice(0, 5).map((field) => (values.get(field) || '').trim());
      const [name, phone, email, type, message] = row;
      if (!name || name.length > 100 || !/^[+\d ().-]{7,30}$/.test(phone) || phone.replace(/\D/g, '').length < 7
          || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
          || !Object.hasOwn(categories, type) || !message || message.length > 2000) {
        throw error(400, 'Please provide a name, valid phone and email, case type, and project details.');
      }
      await db.prepare('INSERT INTO quotes (name, phone, email, caseType, message, submittedAt) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(...row, new Date().toISOString()).run();
      return quoteResult(request, 201, success);
    }
    if (path === '/admin' || path.startsWith('/admin/') || path === '/download-csv') {
      if (!db || (env.ADMIN_PASS?.length ?? 0) < 16) throw error(404, 'Page not found.');
      const id = request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-raman_admin=([a-f0-9]{64})(?:;|$)/)?.[1];
      const session = id ? await db.prepare('SELECT csrf FROM admin_sessions WHERE id = ? AND expires > ?')
        .bind(await hash(id), Date.now()).first() : null;
      if (method === 'POST' && path === '/admin/login') {
        const values = await form(request);
        await limit(db, request, 'login', 6);
        if (!(await matches(values.get('password') || '', env.ADMIN_PASS))) throw error(401, 'Invalid password.');
        const fresh = token();
        const now = Date.now();
        await db.batch([
          db.prepare('DELETE FROM admin_sessions WHERE expires <= ? OR id = ?').bind(now, id ? await hash(id) : ''),
          db.prepare('INSERT INTO admin_sessions (id, csrf, expires) VALUES (?, ?, ?)').bind(await hash(fresh), token(), now + 28800000)
        ]);
        return redirect(cookie(fresh, 28800));
      }
      if (method === 'GET' && path === '/admin') {
        if (!session) return response(login);
        const { results } = await db.prepare('SELECT name, phone, email, caseType, message, submittedAt FROM quotes ORDER BY id DESC LIMIT 100').all();
        return response(adminPage(results, session.csrf));
      }
      if (!session) throw error(401, 'Please sign in at /admin.');
      if (method === 'GET' && (path === '/admin/data' || path === '/download-csv')) {
        const { results } = await db.prepare('SELECT name, phone, email, caseType, message, submittedAt FROM quotes ORDER BY id DESC LIMIT 1000').all();
        if (path === '/admin/data') return json({ submissions: results });
        const lines = [labels.map(csvCell).join(','), ...results.map((row) => fields.map((field) => csvCell(fieldValue(row, field))).join(','))];
        return response(lines.join('\r\n') + '\r\n', 200, 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="quote-requests.csv"' });
      }
      if (method === 'POST' && path === '/admin/logout') {
        const values = await form(request);
        if (!(await matches(values.get('csrf') || '', session.csrf))) throw error(403, 'Invalid form token.');
        await db.prepare('DELETE FROM admin_sessions WHERE id = ?').bind(await hash(id)).run();
        return redirect(cookie('', 0));
      }
      throw error(404, 'Page not found.');
    }
    return env.ASSETS.fetch(request);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error('Pages request failed:', path === '/submit' ? 'quote' : 'admin', err.name);
    const message = status === 500 ? 'Something went wrong. Please try again or contact us on WhatsApp.' : err.message;
    if (path === '/submit') return quoteResult(request, status, message);
    return response(html(message, '<a href="/admin">Admin sign in</a> · <a href="/">Return to the website</a>'), status);
  }
}
export default { fetch: handle };
