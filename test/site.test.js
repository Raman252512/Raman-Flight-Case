'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomBytes } = require('node:crypto');

test('public pages, quote inbox, and protected admin operations', { timeout: 15000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'raman-site-test-'));
  const dataFile = join(dir, 'test-submissions.json');
  const password = randomBytes(24).toString('hex');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: join(__dirname, '..'),
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', PUBLIC_ORIGIN: '', NODE_ENV: 'test',
      ADMIN_PASS: password, SUBMISSIONS_FILE: dataFile },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
    await rm(dir, { recursive: true, force: true });
  });
  const base = await new Promise((resolve, reject) => {
    let output = '';
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Server exited before startup')));
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const address = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (address) resolve(address[0]);
    });
  });
  const get = (path, cookie) => fetch(base + path, { headers: cookie ? { Cookie: cookie } : {} });
  const post = (path, body, headers = {}) => fetch(base + path, {
    method: 'POST', body: new URLSearchParams(body), redirect: 'manual',
    headers: { Accept: 'application/json', ...headers }
  });

  for (const path of ['/', '/contact?case=audio', '/styles.css', '/script.js', '/assets/raman-logo.jpg',
    '/assets/road-case.jpg', '/assets/foam-case.jpg', '/assets/whatsapp.png', '/assets/favicon.svg']) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    await response.arrayBuffer();
  }
  for (const path of ['/contact-submissions.json', '/contact-submissions.csv', '/.data/contact-submissions.json',
    '/.git/config', '/server.js', '/package.json', '/served_admin2.html']) {
    const response = await get(path);
    assert.equal(response.status, 404, path);
    await response.text();
  }
  assert.equal((await get('/admin/data')).status, 401);
  assert.equal((await get('/download-csv')).status, 401);
  assert.equal((await post('/admin/login', { password: 'admin123' })).status, 401);
  assert.equal((await post('/submit', { name: 'Test' })).status, 400);

  const sample = { name: '=2+2', phone: '2025550149', email: 'test@example.com',
    caseType: 'audio', message: '<script>alert(1)</script>' };
  assert.equal((await post('/submit', sample, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await post('/submit', { ...sample, caseType: 'constructor' })).status, 400);
  assert.equal((await post('/submit', { ...sample, message: 'A'.repeat(30001) })).status, 413);
  assert.equal((await post('/submit', { ...sample, website: 'bot' })).status, 201);
  const results = await Promise.all([post('/submit', sample), post('/submit', { ...sample, name: 'Second' })]);
  assert.deepEqual(results.map(({ status }) => status), [201, 201]);
  const saved = JSON.parse(await readFile(dataFile, 'utf8'));
  assert.equal(saved.length, 2);
  assert.ok(saved.some((record) => record.name === '=2+2' && record.caseType === 'audio'));

  const login = await post('/admin/login', { password });
  assert.equal(login.status, 303);
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly; SameSite=Strict/);
  const cookie = setCookie.split(';')[0];
  const dashboard = await (await get('/admin', cookie)).text();
  assert.match(dashboard, /2 saved request\(s\)/);
  assert.match(dashboard, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const csrf = dashboard.match(/name="csrf" value="([a-f0-9]{64})"/)[1];
  const csv = await get('/download-csv', cookie);
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /"'=2\+2"/);
  assert.equal((await post('/admin/delete-all', { confirmation: 'DELETE ALL', csrf }, { Cookie: cookie, Origin: 'https://example.com' })).status, 403);
  assert.equal((await post('/admin/delete-all', { confirmation: 'DELETE ALL' }, { Cookie: cookie })).status, 403);
  assert.equal((await post('/admin/delete-all', { confirmation: 'DELETE ALL', csrf }, { Cookie: cookie })).status, 200);
  assert.deepEqual(await (await get('/admin/data', cookie)).json(), { submissions: [] });
  assert.equal((await post('/admin/logout', { csrf }, { Cookie: cookie })).status, 303);
  assert.equal((await get('/admin/data', cookie)).status, 401);
});
