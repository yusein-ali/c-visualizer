/*
 * Generates dist/licenses.html — the third-party licence disclaimer the footer
 * links to.
 *
 * Replaces `license-list-html`, which shelled out to `yarn licenses
 * generate-disclaimer` and stopped working when the project moved to npm.
 */
const fs = require('fs');
const path = require('path');
const checker = require('license-checker-rseidelsohn');

/*
 * Where the report goes. `npm run build` leaves it beside the generated page;
 * `npm run deploy` sets LICENSE_OUT, because a deployed bundle links to the
 * copy that travels with it into the host's assets rather than to one beside
 * a page it does not own.
 */
const OUT = process.env.LICENSE_OUT
  ? path.resolve(process.env.LICENSE_OUT)
  : path.resolve(__dirname, '..', 'dist', 'licenses.html');
const AUTHOR = 'Yusein R. Ali';
const UPSTREAM = 'https://github.com/RYOSKATE/PLIVET';

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]
  );

checker.init(
  { start: path.resolve(__dirname, '..'), production: false },
  (err, packages) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }

    const names = Object.keys(packages).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );

    /*
     * Code that ships in the bundle without being an installed package.
     * `license-checker` reads node_modules, and the C grammar the syntax check
     * uses was vendored into src/ instead - so it would be missed here, and
     * missing it is the one kind of omission this page exists to prevent.
     */
    const vendored = [
      {
        name: 'JSCPP (pegjs/ast.pegjs)',
        licenses: 'MIT',
        repository: 'https://github.com/felixhao28/JSCPP',
        note:
          'The C grammar in src/interpreter/jscpp/ast.pegjs, vendored and ' +
          'modified. Only the grammar is used; the JSCPP interpreter is not ' +
          'bundled.',
      },
    ];

    const vendoredSections = vendored.map(
      (item) => `<section>
  <h2>${escapeHtml(item.name)}</h2>
  <div class="license">${escapeHtml(item.licenses)}</div>
  <div class="repo"><a href="${escapeHtml(item.repository)}">${escapeHtml(item.repository)}</a></div>
  <p class="none">${escapeHtml(item.note)}</p>
</section>`
    );

    const sections = names.map((name) => {
      const info = packages[name];
      let text = '';
      if (info.licenseFile && fs.existsSync(info.licenseFile)) {
        try {
          text = fs.readFileSync(info.licenseFile, 'utf8');
        } catch {
          text = '';
        }
      }
      const repo = info.repository
        ? `<div class="repo"><a href="${escapeHtml(info.repository)}">${escapeHtml(info.repository)}</a></div>`
        : '';
      const body = text
        ? `<pre>${escapeHtml(text)}</pre>`
        : `<p class="none">No licence file bundled with this package.</p>`;
      return `<section>
  <h2>${escapeHtml(name)}</h2>
  <div class="license">${escapeHtml(info.licenses || 'UNKNOWN')}</div>
  ${repo}
  ${body}
</section>`;
    });

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>c-visualizer — third-party licences</title>
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
<p>c-visualizer is developed by ${escapeHtml(AUTHOR)} and is a fork of
<a href="${UPSTREAM}">PLIVET</a> by RYOSKATE. It is distributed under the MIT licence and bundles
${names.length} packages listed below, each under its own licence. It also
carries the vendored source listed first.</p>
${vendoredSections.join('\n')}
${sections.join('\n')}
</body>
</html>
`;

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, html);
    console.log(
      `licenses.html: ${names.length} packages, ${html.length} bytes`
    );
  }
);
