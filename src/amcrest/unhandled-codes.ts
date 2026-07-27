/**
 * Codes that arrive constantly and carry nothing we act on. `VideoMotionInfo`
 * in particular fires several times a second on some firmware, so logging it
 * would drown out the codes worth noticing.
 */
const MUTED_CODES = new Set([
  'VideoMotionInfo',
  'NTPAdjustTime',
  'TimeChange',
  'RtspSessionDisconnect',
  'NewFile',
  'StorageChange',
  'InterVideoAccess',
]);

/**
 * Tracks event codes the classifier doesn't understand so each one can be
 * logged exactly once per camera. Unrecognized codes are otherwise dropped
 * silently, which is how the wrong vehicle code went unnoticed (see #6).
 */
export class UnhandledCodeTracker {
  private seen = new Set<string>();

  /** True the first time a loggable unknown code is seen; false thereafter. */
  shouldReport(code: string): boolean {
    if (MUTED_CODES.has(code) || this.seen.has(code)) return false;
    this.seen.add(code);
    return true;
  }
}
