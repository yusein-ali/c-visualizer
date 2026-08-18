/*
 * Generates dist/licenses.html — the third-party licence disclaimer the footer
 * links to.
 *
 * Replaces `license-list-html`, which shelled out to `yarn licenses
 * generate-disclaimer` and stopped working when the project moved to npm
 * (Phase 2 of UPGRADE_PLAN.md).
 */
const fs = require('fs');
const path = require('path');
const checker = require('license-checker-rseidelsohn');

const OUT = path.resolve(__dirname, '..', 'dist', 'licenses.html');
const AUTHOR = 'RYOSKATE';

const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);

checker.init({ start: path.resolve(__dirname, '..'), production: false }, (err, packages) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  const names = Object.keys(packages).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );

  const sections = names.map((name) => {
    const info = packages[name];
    let text = '';
    if (info.licenseFile && fs.existsSync(info.licenseFile)) {
      try {
        text = fs.readFileSync(info.licenseFile, 'utf8');
      } catch (_) {
        text = '';
      }
    }
    const repo = info.repository
      ? `<div class="repo"><a href="${escape(info.repository)}">${escape(info.repository)}</a></div>`
      : '';
    const body = text
      ? `<pre>${escape(text)}</pre>`
      : `<p class="none">No licence file bundled with this package.</p>`;
    return `<section>
  <h2>${escape(name)}</h2>
  <div class="license">${escape(info.licenses || 'UNKNOWN')}</div>
  ${repo}
  ${body}
</section>`;
  });

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PLIVET — third-party licences</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 2rem auto; max-width: 60rem; padding: 0 1rem; line-height: 1.5; }
  h1 { border-bottom: 1px solid #ccc; padding-bottom: .5rem; }
  section { margin: 2rem 0; padding-top: 1rem; border-top: 1px solid #eee; }
  h2 { font-size: 1.1rem; margin: 0 0 .25rem; }
  .license { font-weight: 600; color: #444; }
  .repo a { color: #06c; text-decoration: none; word-break: break-all; }
  .none { color: #777; font-style: italic; }
  pre { background: #f6f6f6; padding: 1rem; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; font-size: .85rem; }
</style>
</head>
<body>
<h1>Third-party licences</h1>
<p>PLIVET is distributed by ${escape(AUTHOR)} under the MIT licence. It bundles the
${names.length} packages listed below, each under its own licence.</p>
${sections.join('\n')}
</body>
</html>
`;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html);
  console.log(`licenses.html: ${names.length} packages, ${html.length} bytes`);
});
