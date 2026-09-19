// Babel configuration for Jest: converts @nestjs ESM packages to CJS
module.exports = {
  presets: [
    // Target current Node to minimise unnecessary transpilation
    ["@babel/preset-env", { targets: { node: "current" } }],
  ],
  plugins: [
    // Convert ESM module syntax (import/export) → CJS so Jest CJS runtime can load it
    "@babel/plugin-transform-modules-commonjs",
    "babel-plugin-transform-import-meta"
  ],
};
