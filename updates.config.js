export default {
  // typescript: held below 7.x on purpose. typescript-eslint declares
  // `peerDependencies.typescript: ">=4.8.4 <6.1.0"`, and this config leans on
  // its type-aware presets (eslint.config.js), so TypeScript 7 — the native
  // port — would leave those rules running against an unsupported compiler.
  // 6.0.3 is the ceiling until typescript-eslint ships TypeScript 7 support.
  //
  // eslint / @eslint/js: both exact-pinned so lint-toolchain majors are taken
  // deliberately rather than swept in. As of ESLint 10 the two no longer share
  // a version train (eslint 10.8.0 / @eslint/js 10.0.1) and eslint no longer
  // depends on @eslint/js at all, so @eslint/js is excluded alongside it to
  // keep the pair moving in lockstep.
  //
  // @seydx/rtsp: see #25.
  exclude: ['typescript', 'eslint', '@eslint/js', '@seydx/rtsp'],
};
