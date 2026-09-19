/** @type {import("jest").Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: {
    // .ts files: handled by ts-jest (CJS mode)
    "^.+\\.ts$": "ts-jest",
    // .js files in node_modules/@nestjs: handled by babel-jest
    // babel-jest reads root babel.config.js which converts ESM -> CJS
    "^.+\\.js$": ["babel-jest", { rootMode: "upward" }],
  },
  // Allow @nestjs packages to be transformed (they are pure ESM in v12)
  transformIgnorePatterns: ["/node_modules/(?!@nestjs)/"],
};
