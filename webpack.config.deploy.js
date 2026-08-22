const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { merge } = require('webpack-merge');
const baseConfig = require('./webpack.config.js');
const isDebug = process.env.DEBUG_DEPLOY === '1';

/*
 * `npm run deploy`: c-visualizer as assets for somebody else's page.
 *
 * `npm run build` produces a site - `index.html` with the bundle wired into
 * it - which is the right output for the demo and the wrong one for a host.
 * A Sphinx extension registers a script and writes its own markup, so what it
 * needs is the script and the chunks under it, in a directory it can copy into
 * `_static` whole:
 *
 *     dist/embed/c-visualizer.js           <- the one <script src>, a loader
 *     dist/embed/c-visualizer.app.js       <- the application
 *     dist/embed/codemirror-fallback.js    <- loaded only without host CM6
 *     dist/embed/CPP14.<hash>.js           <- the interpreter, fetched on Start
 *     dist/embed/<worker>.<hash>.js        <- the interpreter's Worker
 *     dist/embed/preprocessed.<hash>.js    <- the preprocessor dialog
 *     dist/embed/licenses.html             <- what the footer links to
 *
 * The three bootstrap assets have fixed names because the loader addresses
 * the other two. Lazy chunks are addressed by the application runtime, so
 * they carry a content hash and can be cached hard.
 *
 * Nothing here inlines them. `output.publicPath` is webpack's default `auto`,
 * which resolves at run time from the script element the bundle was loaded by,
 * so the chunks and the Worker are fetched from beside the script wherever the
 * host mounted its assets - which is the Phase 13 note in UPGRADE_PLAN.md, and
 * the reason the interpreter can stay out of the first download.
 *
 * Three compilers keep the loader independent of CodeMirror: it first uses
 * the host's `window.CodeMirror` namespaces or loads the fallback, then loads
 * the application whose shared CM6 packages are webpack externals.
 */

const output = (uniqueName) => ({
  path: path.resolve(__dirname, 'dist', 'embed'),
  filename: '[name].js',
  chunkFilename: '[name].[contenthash:8].js',
  publicPath: 'auto',
  uniqueName,
  // `npm run deploy` cleans once before all three compilers run. Cleaning from
  // one of them while the others emit into the same directory is a race.
  clean: false,
});

const deployed = (name, entry, extra = {}) => {
  const config = merge(baseConfig, {
    name,
    devtool: isDebug ? 'source-map' : false,
    output: output(name),
    cache: {
      name: `${name}${isDebug ? '-debug' : ''}`,
      buildDependencies: { config: [__filename] },
    },
    ...extra,
  });
  // `merge` combines entry objects; this build replaces the site's `main`.
  config.entry = entry;
  // A host has its own page. The application compiler checks the whole TypeScript
  // program once; the two tiny support builds do not need duplicate checkers.
  config.plugins = config.plugins.filter(
    (plugin) =>
      !(plugin instanceof HtmlWebpackPlugin) &&
      (name === 'embed-app' ||
        plugin.constructor.name !== 'ForkTsCheckerWebpackPlugin')
  );
  return config;
};

const loader = deployed('embed-loader', {
  'c-visualizer': './src/embed.loader.ts',
});

const fallback = deployed(
  'embed-codemirror',
  { 'codemirror-fallback': './src/codemirror.fallback.ts' },
  {
    output: {
      ...output('embed-codemirror'),
      library: { name: 'CodeMirror', type: 'assign-properties' },
    },
  }
);

const application = deployed(
  'embed-app',
  { 'c-visualizer.app': './src/embed.ts' },
  {
    externalsType: 'window',
    externals: {
      '@codemirror/autocomplete': ['CodeMirror', 'autocomplete'],
      '@codemirror/commands': ['CodeMirror', 'commands'],
      '@codemirror/language': ['CodeMirror', 'language'],
      '@codemirror/state': ['CodeMirror', 'state'],
      '@codemirror/view': ['CodeMirror', 'view'],
    },
  }
);

module.exports = [loader, fallback, application];
