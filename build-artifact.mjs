// Bundles the site into one HTML page (CSS and JS inlined) for publishing as a
// claude.ai artifact, where it can be opened from the Claude phone app.
//   node build-artifact.mjs   ->  dist/artifact.html  (images stay in assets/)
// three.js still loads from jsDelivr through the import map.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const css = ['styles.css', 'hero.css'].map((f) => readFileSync(f, 'utf8')).join('\n');
const scripts = ['js/main.js'].map((f) => readFileSync(f, 'utf8'));
const modules = ['js/hero.js'].map((f) => readFileSync(f, 'utf8'));

const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]+>/)[0];
const importmap = html.match(/<script type="importmap">[\s\S]*?<\/script>/)[0];
let body = html.match(/<body>([\s\S]*)<\/body>/)[1];
body = body.replace(/\s*<script (type="module" )?src="js\/[^"]+"><\/script>/g, '');

const out = [
  title,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  fonts,
  `<style>\n${css}\n</style>`,
  importmap,
  body.trim(),
  ...scripts.map((s) => `<script>\n${s}\n</script>`),
  ...modules.map((s) => `<script type="module">\n${s}\n</script>`),
].join('\n');

mkdirSync('dist', { recursive: true });
writeFileSync('dist/artifact.html', out);
console.log(`dist/artifact.html: ${(out.length / 1024).toFixed(1)} KB`);
