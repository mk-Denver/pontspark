/** Unit tests cover the pure protocol and money logic; UI is exercised on device. */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.[tj]sx?$": [
      "ts-jest",
      {
        tsconfig: {
          allowJs: true,
          esModuleInterop: true,
          module: "commonjs",
          target: "es2022",
          strict: true,
          isolatedModules: true,
          rootDir: __dirname,
          types: ["jest"],
        },
      },
    ],
  },
  transformIgnorePatterns: ["/node_modules/(?!(nostr-tools|@noble|@scure)/)"],
};
