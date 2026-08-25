/**
 * Give the single-file build a name a colleague will recognise in their Downloads folder,
 * stamped with the version so two copies can be told apart.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

// Vite marks the inlined bundle as a module script. The bundle is built as an IIFE, so it
// needs no module semantics — and a classic script sidesteps every browser restriction on
// module scripts loaded from file://, which is how a colleague will open this.
let html = readFileSync('dist/index.html', 'utf8').replace(
  /<script type="module" crossorigin>/,
  '<script>',
);
if (html.includes('type="module"')) {
  throw new Error('a module script survived: the file would not open reliably from file://');
}

// A classic script is not deferred, so it must run after #root exists: move it to the end
// of <body>. (Vite escapes any literal </script> inside the bundle, so this match is safe.)
const script = html.match(/<script>[\s\S]*?<\/script>/);
if (!script) throw new Error('no inlined script found in the build output');
html = html.replace(script[0], '').replace('</body>', `${script[0]}</body>`);
if (html.indexOf('<div id="root">') > html.indexOf('<script>')) {
  throw new Error('the script still runs before #root exists');
}

const out = `dist/Plate Assay Assistant ${version}.html`;
writeFileSync(out, html);
rmSync('dist/index.html');
console.log(`\n  Send this one file to anyone — no install needed:\n  ${out}\n`);
