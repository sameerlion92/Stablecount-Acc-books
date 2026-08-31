/** True when running on a personal server with local data directory. */
export function isSelfHosted() {
  return Boolean(process.env.STABLECOUNT_DATA_DIR?.trim()) || process.env.STABLECOUNT_FORCE_LOCAL === "1";
}
