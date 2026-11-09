import { cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const fromRoot = (path) => fileURLToPath(new URL(path, root));
const paths = ['index.html', 'contact.html', 'styles.css', 'script.js', '_headers', '_routes.json', '404.html', 'assets'];
await mkdir(fromRoot('dist'), { recursive: true });
for (const path of paths) await cp(fromRoot('public/' + path), fromRoot('dist/' + path), { recursive: true });
await writeFile(fromRoot('dist/_worker.js'), await readFile(fromRoot('cloudflare/worker.mjs')));
console.log('Cloudflare Pages output: dist/');
