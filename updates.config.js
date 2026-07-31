export default {
  // typescript: held below 7.x on purpose. typescript-eslint declares
  // `peerDependencies.typescript: ">=4.8.4 <6.1.0"`, and this config leans on
  // its type-aware presets (eslint.config.js), so TypeScript 7 — the native
  // port — would leave those rules running against an unsupported compiler.
  // 6.0.3 is the ceiling until typescript-eslint ships TypeScript 7 support.
  //
  // @seydx/rtsp: see #25.
  exclude: ['typescript', 'eslint', '@seydx/rtsp'],
};
