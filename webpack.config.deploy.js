const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { merge } = require('webpack-merge');
const baseConfig = require('./webpack.config.js');
const { generateLibraryManifest } = require('./scripts/library-manifest');
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
 *     dist/embed/c-stdio.js                <- printf and scanf, no interpreter
 *     dist/embed/c-stdio.parity.json       <- the printf parity table
 *     dist/embed/c-expression.js           <- the expression tree renderer
 *     dist/embed/library.json              <- what a program may call and not write
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

/*
 * Emits a file generated at build time - `{ text, files }` from `generate`,
 * where `files` are the sources it was made from, watched like any module.
 * Like `EmitFilePlugin` below it goes through the compilation, so it follows
 * `output.path` wherever a wrapping configuration points it.
 */
class EmitGeneratedPlugin {
  constructor(name, generate) {
    this.name = name;
    this.generate = generate;
  }

  apply(compiler) {
    compiler.hooks.thisCompilation.tap('EmitGeneratedPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'EmitGeneratedPlugin',
          stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        () => {
          const { text, files } = this.generate();
          for (const file of files) {
            compilation.fileDependencies.add(file);
          }
          compilation.emitAsset(this.name, new webpack.sources.RawSource(text));
        }
      );
    });
  }
}

/*
 * `library.json` goes beside the loader: the functions, macros, objects and
 * types a program may use and the constructs the interpreter refuses,
 * generated from `src/app/libraryHelp.ts` and `src/interpreter/refused.ts`
 * (see `src/app/libraryManifest.ts`). The course build's lint reads it.
 */
const loader = deployed(
  'embed-loader',
  { 'c-visualizer': './src/embed.loader.ts' },
  {
    plugins: [new EmitGeneratedPlugin('library.json', generateLibraryManifest)],
  }
);

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

/*
 * Copies a file from the repository into the build output unchanged. The
 * asset is emitted through the compilation rather than written beside it, so
 * it lands in whatever `output.path` is in effect - `dist/embed` here, and
 * the Sphinx repository's directory when ../webpack.config.c-visualizer.js
 * rewrites the path.
 */
class EmitFilePlugin {
  constructor(name, source) {
    this.name = name;
    this.source = source;
  }

  apply(compiler) {
    compiler.hooks.thisCompilation.tap('EmitFilePlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'EmitFilePlugin',
          stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        () => {
          compilation.fileDependencies.add(this.source);
          compilation.emitAsset(
            this.name,
            new webpack.sources.RawSource(fs.readFileSync(this.source))
          );
        }
      );
    });
  }
}

/*
 * `c-stdio.js`: the printf formatter and the scanf matcher without the
 * interpreter, for a host's format playground. One file, no chunks and no
 * runtime to discover them, so a host can load it with a plain script tag.
 * `c-stdio.parity.json` is the table the interpreter's printf is tested
 * against, copied so the playground's own tests read the same expectations.
 */
const stdio = deployed(
  'embed-stdio',
  { 'c-stdio': './src/stdio.entry.ts' },
  {
    optimization: { splitChunks: false },
    plugins: [
      new EmitFilePlugin(
        'c-stdio.parity.json',
        path.resolve(__dirname, 'test', 'fixtures', 'stdio-parity.json')
      ),
    ],
  }
);

/*
 * `c-expression.js`: the canvas's expression tree drawing - layout, boxes,
 * conversion pills, JointJS - for a host that evaluates expressions itself.
 * One file with no chunks, like `c-stdio.js`: nothing in it reaches the
 * worker, the interpreter or CodeMirror, and a host loads it with one tag.
 */
const expression = deployed(
  'embed-expression',
  { 'c-expression': './src/expression.entry.ts' },
  { optimization: { splitChunks: false } }
);

module.exports = [loader, fallback, application, stdio, expression];
