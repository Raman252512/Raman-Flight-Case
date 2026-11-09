'use strict';

const http = require('node:http');
const { readFile, writeFile, rename, mkdir } = require('node:fs/promises');
const { resolve, dirname, join } = require('node:path');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const production = process.env.NODE_ENV === 'production';
const adminPassword = process.env.ADMIN_PASS || '';
const adminEnabled = adminPassword.length >= 16;
const dataFile = resolve(process.env.SUBMISSIONS_FILE || join(__dirname, '.data', 'contact-submissions.json'));
const sessionAge = 8 * 60 * 60 * 1000;
const sessions = new Map();
const limits = new Map();
const categories = {
  custom: 'Custom Flight Cases',
  instruments: 'Musical Instrument Cases',
  audio: 'DJ & Audio Equipment Cases',
  displays: 'LED & LCD Display Cases',
  industrial: 'Industrial Equipment Cases',
  tools: 'Tool Cases',
  trolleys: 'Trolley Cases',
  other: 'Not sure yet'
};
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/contact', ['contact.html', 'text/html; charset=utf-8']],
  ['/contact.html', ['contact.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/script.js', ['script.js', 'text/javascript; charset=utf-8']],
  ['/assets/favicon.svg', ['assets/favicon.svg', 'image/svg+xml']],
  ['/assets/road-case.jpg', ['assets/road-case.jpg', 'image/jpeg']],
  ['/assets/foam-case.jpg', ['assets/foam-case.jpg', 'image/jpeg']],
  ['/assets/raman-logo.jpg', ['assets/raman-logo.jpg', 'image/jpeg']],
  ['/assets/whatsapp.png', ['assets/whatsapp.png', 'image/png']]
]);

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);
const hash = (value) => createHash('sha256').update(value).digest();
const matches = (a, b) => timingSafeEqual(hash(a), hash(b));
const token = () => randomBytes(32).toString('hex');
const error = (status, message) => Object.assign(new Error(message), { status });
const html = (title, content) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} | Raman Flight Case</title><link rel="stylesheet" href="/styles.css"></head>
<body><main class="wrap admin"><h1>${esc(title)}</h1>${content}</main></body></html>`;

function send(res, status, body, type = 'text/html; charset=utf-8', headers = {}) {
  res.writeHead(status, {
    'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body),
    'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...(production && { 'Strict-Transport-Security': 'max-age=31536000' }),
    ...headers
  });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}
const json = (res, status, payload) => send(res, status, JSON.stringify(payload), 'application/json; charset=utf-8');
const redirect = (res, location, headers = {}) => send(res, 303, '', undefined, { Location: location, ...headers });

function checkSource(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) throw error(403, 'This request must come from this website.');
  const origin = req.headers.origin;
  if (origin) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw error(403, 'Invalid request origin.'); }
    const expected = process.env.PUBLIC_ORIGIN;
    if (expected ? parsed.origin !== expected : parsed.host !== req.headers.host) {
      throw error(403, 'This request must come from this website.');
    }
  }
}

function throttle(key, max, windowMs) {
  const now = Date.now();
  for (const [entry, data] of limits) if (data.until <= now) limits.delete(entry);
  const value = limits.get(key);
  if (value ? value.count >= max : limits.size >= 10000) {
    throw error(429, 'Too many attempts. Please try again later.');
  }
  if (value) value.count++;
  else limits.set(key, { count: 1, until: now + windowMs });
}

async function formData(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') {
    throw error(415, 'Unsupported form format.');
  }
  const maxBytes = 30000;
  if (Number(req.headers['content-length']) > maxBytes) throw error(413, 'This request is too large.');
  let size = 0;
  const chunks = [];
  // Keep the socket open to return a clear error for oversized chunked requests.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBytes) { req.resume(); throw error(413, 'This request is too large.'); }
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

async function readRows() {
  try {
    const rows = JSON.parse(await readFile(dataFile, 'utf8'));
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object')) throw Error('Invalid data file');
    return rows;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}
async function saveRows(rows) {
  await mkdir(dirname(dataFile), { recursive: true, mode: 0o700 });
  const temporary = dataFile + '.tmp';
  await writeFile(temporary, JSON.stringify(rows, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, dataFile);
}
let pending = Promise.resolve();
function changeRows(update) {
  const job = pending.then(async () => saveRows(update(await readRows())));
  pending = job.catch(() => {});
  return job;
}

const cookieName = production ? '__Host-raman_admin' : 'raman_admin';
function cookie(value, maxAge) {
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${production ? '; Secure' : ''}`;
}
function session(req) {
  for (const [id, item] of sessions) if (item.expires <= Date.now()) sessions.delete(id);
  const pair = (req.headers.cookie || '').split(';').map((v) => v.trim()).find((v) => v.startsWith(cookieName + '='));
  const id = pair?.slice(cookieName.length + 1);
  return sessions.has(id) ? { id, ...sessions.get(id) } : null;
}

const fields = ['name', 'phone', 'email', 'caseType', 'message', 'submittedAt'];
const labels = ['Name', 'Phone', 'Email', 'Case type', 'Project details', 'Submitted (UTC)'];
const fieldValue = (row, field) => field === 'caseType' ? (Object.hasOwn(categories, row[field]) ? categories[row[field]] : '—') : row[field];
function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\t\r\n]|^\s*[=+@\-＝＋＠－]/u.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}
function adminPage(rows, auth) {
  const cells = rows.slice().reverse().map((row) => '<tr>' + fields.map((field) => `<td>${esc(fieldValue(row, field))}</td>`).join('') + '</tr>').join('');
  return html('Quote requests', `<p>${rows.length} saved request(s)</p>
<div class="actions"><a class="button" href="/download-csv">Download CSV</a><a class="button outline" href="/">View website</a></div>
<div class="table-wrap" tabindex="0" role="region" aria-label="Quote request records"><table><thead><tr>${labels.map((label) => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${cells || '<tr><td colspan="6">No requests yet.</td></tr>'}</tbody></table></div>
<form method="post" action="/admin/logout"><input type="hidden" name="csrf" value="${auth.csrf}"><button class="button outline">Sign out</button></form>
${rows.length ? `<details><summary>Delete all quote requests</summary><form method="post" action="/admin/delete-all">
<input type="hidden" name="csrf" value="${auth.csrf}"><label>Type DELETE ALL to confirm
<input name="confirmation" required autocomplete="off" maxlength="10"></label>
<p><button class="button outline">Permanently delete all requests</button></p></form></details>` : ''}`);
}
const loginPage = html('Admin sign in', `<form method="post" action="/admin/login">
<label>Password <input type="password" name="password" autocomplete="current-password" maxlength="512" required></label>
<p><button class="button">Sign in</button></p></form><a href="/">Return to the website</a>`);

const success = 'We received your quote request. Raman Flight Case will use the contact details you provided to follow up.';
function quoteResult(req, res, status, message) {
  if (req.headers.accept?.includes('application/json')) return json(res, status, { message });
  return send(res, status, html(status < 400 ? 'Quote request received' : 'Quote request could not be sent',
    `<p>${esc(message)}</p><a href="/contact#quote">Back to the contact page</a>`));
}

async function route(req, res) {
  const path = new URL(req.url, 'http://local').pathname;
  const get = req.method === 'GET' || req.method === 'HEAD';
  const ip = req.socket.remoteAddress;
  if (get && files.has(path)) {
    const [file, type] = files.get(path);
    return send(res, 200, await readFile(join(__dirname, 'public', file)), type, {
      'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=86400' : 'no-cache'
    });
  }
  if (req.method === 'POST' && path === '/submit') {
    checkSource(req);
    throttle('quote:all', 100, 15 * 60_000);
    throttle('quote:' + ip, 12, 15 * 60_000);
    const form = await formData(req);
    if (form.get('website')) return quoteResult(req, res, 201, success);
    const row = Object.fromEntries(fields.slice(0, 5).map((field) => [field, (form.get(field) || '').trim()]));
    if (!row.name || row.name.length > 100 || !/^[+\d ().-]{7,30}$/.test(row.phone)
        || row.phone.replace(/\D/g, '').length < 7
        || row.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)
        || !Object.hasOwn(categories, row.caseType) || !row.message || row.message.length > 2000) {
      throw error(400, 'Please provide a name, valid phone and email, case type, and project details.');
    }
    row.submittedAt = new Date().toISOString();
    await changeRows((rows) => [...rows, row]);
    return quoteResult(req, res, 201, success);
  }

  if (path === '/admin' || path.startsWith('/admin/') || path === '/download-csv') {
    if (!adminEnabled) throw error(404, 'Page not found.');
    const auth = session(req);
    if (get && path === '/admin') return send(res, 200, auth ? adminPage(await readRows(), auth) : loginPage);
    if (req.method === 'POST' && path === '/admin/login') {
      checkSource(req);
      throttle('admin:all', 30, 15 * 60_000);
      throttle('admin:' + ip, 8, 15 * 60_000);
      const password = (await formData(req)).get('password') || '';
      if (!matches(password, adminPassword)) throw error(401, 'Invalid password.');
      if (auth) sessions.delete(auth.id);
      const id = token();
      sessions.set(id, { csrf: token(), expires: Date.now() + sessionAge });
      return redirect(res, '/admin', { 'Set-Cookie': cookie(id, sessionAge / 1000) });
    }
    if (!auth) throw error(401, 'Please sign in at /admin.');
    if (get && path === '/admin/data') return json(res, 200, { submissions: await readRows() });
    if (get && path === '/download-csv') {
      const lines = (await readRows()).map((row) => fields.map((field) => csvCell(fieldValue(row, field))).join(','));
      return send(res, 200, [labels.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n',
        'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="quote-requests.csv"' });
    }
    if (req.method === 'POST' && ['/admin/logout', '/admin/delete-all'].includes(path)) {
      checkSource(req);
      const form = await formData(req);
      if (!matches(form.get('csrf') || '', auth.csrf)) throw error(403, 'Invalid form token.');
      if (path === '/admin/delete-all') {
        if (form.get('confirmation') !== 'DELETE ALL') throw error(400, 'Type DELETE ALL to confirm.');
        await changeRows(() => []);
        if (req.headers.accept?.includes('application/json')) return json(res, 200, { ok: true });
        return redirect(res, '/admin');
      }
      sessions.delete(auth.id);
      return redirect(res, '/admin', { 'Set-Cookie': cookie('', 0) });
    }
  }
  throw error(404, 'Page not found.');
}

const server = http.createServer({ requestTimeout: 15000, headersTimeout: 10000 }, (req, res) => {
  route(req, res).catch((err) => {
    const status = err.status || 500;
    if (status === 500) console.error('Request failed:', err.code || err.name);
    const message = status === 500 ? 'Something went wrong. Please try again later.' : err.message;
    if (req.url?.split('?')[0] === '/submit') return quoteResult(req, res, status, message);
    return send(res, status, html(message, '<a href="/">Return to the website</a>'));
  });
});
server.listen(port, host, () => {
  console.log(`Raman Flight Case: http://${host}:${server.address().port}`);
  if (!adminEnabled) console.log('Admin is disabled. Set ADMIN_PASS to a strong password of at least 16 characters to enable it.');
});
