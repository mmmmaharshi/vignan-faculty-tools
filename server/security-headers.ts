/**
 * Every document and asset answer a deployment gives carries these. The policy
 * is named once here and read in two places: `server.ts` attaches it to what
 * it serves, and `vercel.json` carries the same string for the deployed front
 * end. A JSON file cannot import a constant, so `test/conventions.spec.ts` is
 * what holds the two copies together.
 *
 * `style-src 'unsafe-inline'` is Mantine's runtime styles; `img-src` names
 * ECAP because the faculty photo loads from the portal itself.
 */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: https://webprosindia.com; font-src 'self' data:; " +
  "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
export const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
};
