const { merge } = require('webpack-merge');
const baseConfig = require('./webpack.config.js');

// Opt-in only: the analyzer used to open a browser tab on every dev start and
// every debug session. `npm run analyze` sets it.
const plugins = [];
if (process.env.ANALYZE) {
  const {
    BundleAnalyzerPlugin,
  } = require('webpack-bundle-analyzer');
  plugins.push(new BundleAnalyzerPlugin());
}

module.exports = merge(baseConfig, {
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
