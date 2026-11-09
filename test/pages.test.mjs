import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { handle } from '../cloudflare/worker.mjs';

test('Pages Worker validates and saves quotes to SQLite and protects the inbox', async () => {
  const sql = new DatabaseSync(':memory:');
  try {
    sql.exec(await readFile(new URL('../cloudflare/schema.sql', import.meta.url), 'utf8'));
    const env = {
      ADMIN_PASS: randomBytes(24).toString('hex'),
      QUOTES_DB: {
        prepare(query) {
          const prepared = sql.prepare(query);
          const bind = (...args) => ({
            first: async () => prepared.get(...args),
            run: async () => prepared.run(...args),
            all: async () => ({ results: prepared.all(...args) })
          });
          return { ...bind(), bind };
        },
        async batch(statements) { for (const statement of statements) await statement.run(); }
      },
      ASSETS: { fetch: async () => new Response('asset') }
    };
    const request = (path, options) => handle(new Request('https://raman-flight-case.pages.dev' + path, options), env);
    const post = (path, body, headers) => request(path, { method: 'POST',
      body: new URLSearchParams(body), headers: { Accept: 'application/json', ...headers } });
    const sample = { name: '=1+1', phone: '2025550149', email: 'preview@example.com',
      caseType: 'audio', message: '<script>alert(1)</script>' };
    assert.equal(await (await request('/')).text(), 'asset');
    assert.equal((await handle(new Request('https://example.com/submit', { method: 'POST', body: new URLSearchParams(sample) }), {})).status, 503);
    assert.equal((await post('/submit', sample, { Origin: 'https://other.example' })).status, 403);
    assert.equal((await post('/submit', { ...sample, caseType: 'constructor' })).status, 400);
    assert.equal((await post('/submit', { ...sample, message: 'a'.repeat(30001) })).status, 413);
    assert.equal((await post('/submit', { ...sample, website: 'bot' })).status, 201);
    const created = await post('/submit', sample);
    assert.equal(created.status, 201);
    assert.match((await created.json()).message, /received/);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM quotes').get().n, 1);
    assert.equal((await request('/admin/data')).status, 401);
    assert.equal((await request('/download-csv')).status, 401);
    assert.equal((await post('/admin/login', { password: 'admin123' })).status, 401);
    const login = await post('/admin/login', { password: env.ADMIN_PASS });
    assert.equal(login.status, 303);
    const setCookie = login.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly; Secure; SameSite=Strict/);
    const Cookie = setCookie.split(';')[0];
    const headers = { Cookie };
    const admin = await (await request('/admin', { headers })).text();
    assert.match(admin, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    const csv = await (await request('/download-csv', { headers })).text();
    assert.match(csv, /"'=1\+1"/);
    const csrf = admin.match(/name="csrf" value="([a-f0-9]+)"/)[1];
    assert.equal((await post('/admin/logout', {}, headers)).status, 403);
    assert.equal((await post('/admin/logout', { csrf }, headers)).status, 303);
    assert.equal((await request('/admin/data', { headers })).status, 401);
    for (let i = 0; i < 10; i++) await post('/submit', {});
    assert.equal((await post('/submit', sample)).status, 429);
  } finally { sql.close(); }
});
