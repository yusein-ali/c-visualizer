const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

const isProduction = process.env.NODE_ENV === 'prod';
const tsConfigFile = `tsconfig.${isProduction ? 'prod' : 'dev'}.json`;

module.exports = {
  mode: isProduction ? 'production' : 'development',
  entry: {
    main: './src/main.ts',
  },
  output: {
    filename: 'js/[name].js',
    chunkFilename: 'js/[name].bundle.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
  },
  // Keep the interpreter in its own chunk: the dynamic import in
  // src/server.ts is what keeps the editor interactive while the parser loads.
  optimization: {
    chunkIds: 'named',
    splitChunks: {
      automaticNameDelimiter: '-',
      cacheGroups: {
        defaultVendors: false,
      },
    },
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.json'],
    fallback: {
      // unicoen.ts pulls in scanf, which requires fs. There is no server here.
      fs: false,
      // webpack 4 polyfilled Node core modules automatically; webpack 5 does
      // not. antlr4ts (unicoen's parser runtime) needs both for real:
      // `assert(...)` runs in the parser hot path, and BitSet.js evaluates
      // `util.inspect.custom` as a computed method key at module load. Stubbing
      // either to `false` throws on the first parse.
      assert: require.resolve('assert/'),
      util: require.resolve('util/'),
      // scanf's stdin module calls Buffer.alloc(256) at module scope and
      // process.platform inside its export. webpack 4 injected both globals
      // automatically; webpack 5 removed them. Without these the CPP14 chunk
      // throws ReferenceError on load and CPP14Interpreter never gets exported.
      buffer: require.resolve('buffer/'),
      process: require.resolve('process/browser'),
    },
  },
  target: ['web', 'es2020'],
  // Filesystem cache replaces HardSourceWebpackPlugin, which is unmaintained
  // and never supported webpack 5.
  cache: {
    type: 'filesystem',
    buildDependencies: {
      config: [__filename],
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [{ loader: 'babel-loader', options: { cacheDirectory: true } }],
      },
      {
        // @babel/runtime and other packages ship ESM with extensionless
        // relative imports; webpack 5 enforces fullySpecified for ESM.
        test: /\.m?js$/,
        resolve: { fullySpecified: false },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(gif|png)$/,
        type: 'asset',
      },
      {
        test: /\.(woff|woff2|eot|ttf|svg)$/,
        type: 'asset/resource',
        generator: {
          filename: 'font/[name][ext]',
        },
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: 'src/index.html',
      filename: 'index.html',
      chunks: ['main'],
    }),
    new webpack.ProvidePlugin({
      // See resolve.fallback above: these are globals in Node, not modules.
      // `$` and `jQuery` were here too, for Bootstrap 3's plugins; Bootstrap
      // went with react-bootstrap.
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser',
    }),
    new ForkTsCheckerWebpackPlugin({
      async: false,
      typescript: {
        configFile: path.resolve(__dirname, tsConfigFile),
        memoryLimit: 4096,
        configOverwrite: {
          compilerOptions: { skipLibCheck: true },
        },
      },
    }),
  ],
};
