// Bundles the site into one HTML page (CSS and JS inlined) for publishing as a
// claude.ai artifact, where it can be opened from the Claude phone app.
//   node build-artifact.mjs   ->  dist/artifact.html  (images stay in assets/)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const css = readFileSync('styles.css', 'utf8');
const scripts = ['js/track.js', 'js/main.js'].map((f) => readFileSync(f, 'utf8'));

const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]+>/)[0];
let body = html.match(/<body>([\s\S]*)<\/body>/)[1];
body = body.replace(/\s*<script src="js\/[^"]+"><\/script>/g, '');

const out = [
  title,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  fonts,
  `<style>\n${css}\n</style>`,
  body.trim(),
  ...scripts.map((s) => `<script>\n${s}\n</script>`),
].join('\n');

mkdirSync('dist', { recursive: true });
writeFileSync('dist/artifact.html', out);
console.log(`dist/artifact.html: ${(out.length / 1024).toFixed(1)} KB`);
