/**
 * Which build of the manager is running, as `<short commit> <ISO timestamp>`.
 *
 * The page is a long-lived SPA: a user who leaves the tab open keeps running
 * the JS it loaded, so a deploy does not reach them until they reload. Without
 * a stamp, "still broken after the fix" and "never loaded the fix" produce
 * identical bug reports — which is exactly what happened once already. Every
 * technical-details block carries this, and it is logged on boot.
 */
export const ANS_BUILD: string =
  typeof __ANS_BUILD__ === "string" ? __ANS_BUILD__ : "dev";
