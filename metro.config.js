const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// nostr-tools and @noble/* publish package "exports"; keep Metro on them.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
