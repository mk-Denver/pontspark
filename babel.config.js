module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // react-native-worklets/plugin must be last (required by reanimated v4).
    plugins: ["react-native-worklets/plugin"],
  };
};
