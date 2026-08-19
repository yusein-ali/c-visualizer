module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      '@babel/typescript',
      '@babel/react',
      [
        '@babel/env',
        {
          // Targets come from the `browserslist` key in package.json, so the
          // build, any future PostCSS pass and `npx browserslist` all read one
          // policy. See AGENTS.md for what that policy is and why.
          useBuiltIns: 'usage',
          corejs: 3,
        },
      ],
    ],
    plugins: [
      '@babel/proposal-class-properties',
      '@babel/proposal-object-rest-spread',
      '@babel/plugin-syntax-dynamic-import',
      '@babel/plugin-transform-runtime',
      '@babel/plugin-transform-typescript',
    ],
  };
};
