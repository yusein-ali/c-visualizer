/*
 * Generates src/interpreter/jscpp/ast.generated.js from ast.pegjs — the C
 * grammar PLIVET checks syntax with, vendored from JSCPP.
 *
 * The output is committed. PEG.js is a build-time tool and nothing but this
 * script imports it, so keeping the generated parser in the tree lets Webpack,
 * Jest and `tsc` all read one ordinary module with no build-order rule between
 * them. Run this after editing the grammar; `npm run generate:parser`.
 *
 * PEG.js is pinned to 0.9 because that is what upstream JSCPP generates with.
 * 0.10 rejects the grammar outright: it forbids reusing a label inside one
 * expression, which `TypedefDeclaration` does.
 */
const fs = require('fs');
const path = require('path');
const peg = require('pegjs');

const DIR = path.resolve(__dirname, '..', 'src', 'interpreter', 'jscpp');
const GRAMMAR = path.join(DIR, 'ast.pegjs');
const OUT = path.join(DIR, 'ast.generated.js');

const HEADER = `/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Built from ast.pegjs by scripts/generate-parser.js (\`npm run
 * generate:parser\`). Edit the grammar, not this file.
 *
 * Derived from JSCPP (https://github.com/felixhao28/JSCPP), MIT licensed.
 */
/* eslint-disable */
`;

const source = peg.buildParser(fs.readFileSync(GRAMMAR, 'utf8'), {
  output: 'source',
  // The syntax check runs on every edit. Caching intermediate results makes
  // the parser bigger and considerably faster, which is the right trade here:
  // it is 15 kB gzipped either way next to the 217 kB of ANTLR it fronts.
  cache: true,
});

fs.writeFileSync(OUT, `${HEADER}module.exports = ${source};\n`);
process.stdout.write(
  `generate-parser: ${path.relative(process.cwd(), OUT)} (${Math.round(
    source.length / 1024
  )} kB)\n`
);
