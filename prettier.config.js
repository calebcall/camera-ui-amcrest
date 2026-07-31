/**
 * `npm run format` (prettier) and `npm run lint` (eslint --fix) both rewrite
 * source, so anywhere their defaults differ the two undo each other and
 * whichever ran last wins. `npm run bundle` only converged by accident, because
 * it happens to run format before lint — running prettier on its own left the
 * tree lint-dirty, and a commit taken at that moment captured the wrong style.
 * See #31.
 *
 * #31 assumed quote style was the whole problem. It wasn't: the two also
 * disagree on how union-type members are indented (`@stylistic/indent`) and on
 * where the brace goes when an `implements` clause wraps
 * (`@stylistic/brace-style`). Turning off the offending rules one at a time did
 * not converge either — it just surfaced the next conflict.
 *
 * The fix is to remove the overlap rather than referee it. eslint/@stylistic is
 * the formatter of record for source, and `.prettierignore` keeps prettier off
 * it entirely; prettier's remaining job is the test files, which eslint already
 * ignores (`**\/*.test.ts` in eslint.config.js). Nothing is formatted twice, so
 * the order the two scripts run in no longer matters.
 *
 * singleQuote is set so the test files prettier does own match the single-quote
 * style @stylistic enforces everywhere else, instead of drifting into prettier's
 * double-quote default.
 */
export default {
  singleQuote: true,
};
