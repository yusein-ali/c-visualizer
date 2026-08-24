const { merge } = require('webpack-merge');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const baseConfig = require('./webpack.config.js');

/*
 * The multi-instance check, and the only thing this config adds: a second
 * page holding two instances side by side. It is here rather than in
 * `webpack.config.js` so that `npm run build` ships one page, not two.
 */
const plugins = [
  new HtmlWebpackPlugin({
    template: 'src/dev.html',
    filename: 'dev.html',
    chunks: ['dev'],
  }),
];

// Opt-in only: the analyzer used to open a browser tab on every dev start and
// every debug session. `npm run analyze` sets it.
if (process.env.ANALYZE) {
  const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
  plugins.push(new BundleAnalyzerPlugin());
}

module.exports = merge(baseConfig, {
  entry: {
    dev: './src/dev.ts',
  },
  // Source maps that map back to the .ts/.tsx files, so breakpoints bind in src/.
  devtool: 'eval-source-map',
  devServer: {
    port: 8080,
    hot: true,
    historyApiFallback: true,
    open: false,
    client: {
      logging: 'info',
      overlay: { errors: true, warnings: false },
    },
    static: false,
  },
  plugins,
});
