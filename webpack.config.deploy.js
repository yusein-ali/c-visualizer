const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { merge } = require('webpack-merge');
const baseConfig = require('./webpack.config.js');

/*
 * `npm run deploy`: c-visualizer as assets for somebody else's page.
 *
 * `npm run build` produces a site - `index.html` with the bundle wired into
 * it - which is the right output for the demo and the wrong one for a host.
 * A Sphinx extension registers a script and writes its own markup, so what it
 * needs is the script and the chunks under it, in a directory it can copy into
 * `_static` whole:
 *
 *     dist/embed/c-visualizer.js            <- the one <script src>
 *     dist/embed/CPP14.<hash>.js            <- the interpreter, fetched on Start
 *     dist/embed/<worker>.<hash>.js         <- the interpreter's Worker
 *     dist/embed/preprocessed.<hash>.js     <- the preprocessor dialog
 *     dist/embed/licenses.html              <- what the footer links to
 *
 * Only the entry has a fixed name, because that name is written into the host
 * page and a host caches it. The chunks are addressed by the runtime out of
 * the entry, so they carry a content hash and can be cached hard.
 *
 * Nothing here inlines them. `output.publicPath` is webpack's default `auto`,
 * which resolves at run time from the script element the bundle was loaded by,
 * so the chunks and the Worker are fetched from beside the script wherever the
 * host mounted its assets - which is the Phase 13 note in UPGRADE_PLAN.md, and
 * the reason the interpreter can stay out of the first download.
 */

const config = merge(baseConfig, {
  // Names the filesystem cache, so this build does not share entries with the
  // site build that has the same mode and a different entry point.
  name: 'embed',
  output: {
    path: path.resolve(__dirname, 'dist', 'embed'),
    filename: '[name].js',
    chunkFilename: '[name].[contenthash:8].js',
    publicPath: 'auto',
    clean: true,
  },
  cache: {
    buildDependencies: {
      config: [__filename],
    },
  },
});

// One entry, and it is not the site's: `main.ts` mounts the page webpack
// generates for it, `embed.ts` mounts whatever the host wrote.
config.entry = { 'c-visualizer': './src/embed.ts' };

// The page generator goes with it. A host has its own templates, and an
// `index.html` in the assets directory is one more file to explain.
config.plugins = config.plugins.filter(
  (plugin) => !(plugin instanceof HtmlWebpackPlugin)
);

module.exports = config;
