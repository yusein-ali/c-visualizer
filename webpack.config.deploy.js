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
 *     dist/embed/c-visualizer.app.js       <- the application's entry stub
 *     dist/embed/c-visualizer.app-<hash>.js <- the application, in async parts
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
 * host mounted its assets - which is what the Sphinx extension needs, and
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

const hostChunking = {
  splitChunks: {
    chunks: 'all',
    maxSize: 200000,
    automaticNameDelimiter: '-',
    cacheGroups: {
      defaultVendors: false,
    },
  },
};

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

/*
 * The fallback is one file because the loader addresses it by name and has no
 * way to discover a second. Splitting it - by `maxSize`, or into an entry per
 * package - either leaves code in a chunk nothing fetches or leaves five
 * scripts racing each other for the shared runtime they were split against.
 * It is also the file a course page never asks for: it is fetched only where
 * `window.CodeMirror` is missing, which is a popup or a host that is not A+.
 */
const fallback = deployed(
  'embed-codemirror',
  { 'codemirror-fallback': './src/codemirror.fallback.ts' },
  {
    optimization: { splitChunks: false },
    output: {
      ...output('embed-codemirror'),
      library: { name: 'CodeMirror', type: 'assign-properties' },
    },
  }
);

const application = deployed(
  'embed-app',
  { 'c-visualizer.app': './src/embed.entry.ts' },
  {
    // Keep the host-facing application below the static asset-size limit used
    // by course pages. The entry is a stub that imports `embed.ts`, so the
    // application is in async chunks and `maxSize` divides those: an initial
    // chunk over the limit would be split into files named after it, and the
    // loader would find nothing under `c-visualizer.app.js`. The application
    // runtime discovers the chunks relative to the loader script.
    optimization: hostChunking,
    externalsType: 'window',
    externals: {
      '@codemirror/autocomplete': ['CodeMirror', 'autocomplete'],
      '@codemirror/commands': ['CodeMirror', 'commands'],
      '@codemirror/language': ['CodeMirror', 'language'],
      '@codemirror/state': ['CodeMirror', 'state'],
      '@codemirror/view': ['CodeMirror', 'view'],
      '@lezer/highlight': ['CodeMirror', 'highlight'],
    },
  }
);

module.exports = [loader, fallback, application];
