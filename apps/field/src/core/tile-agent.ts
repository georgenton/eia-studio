/**
 * The `User-Agent` this application sends when it asks a tile provider for imagery.
 *
 * ## Why it is a constant with a comment rather than a string in a fetch call
 *
 * It is the **credential restriction**. The browser key is restricted at MapTiler by allowed HTTP
 * origin; a native application sends no `Referer`, so that key answers 403 from a phone — checked
 * against the provider rather than assumed. MapTiler's documented mechanism for a native
 * application is a key restricted by *Allowed User-Agent header*, matched as a substring.
 *
 * So the substring below is what the owner enters at the provider, and changing it here without
 * changing it there silently removes every background from every phone. It is deliberately not
 * derived from anything that varies per build.
 *
 * It is not a secret and does not protect anything on its own: anyone can send any header. It
 * raises the cost of casually reusing a key lifted out of an APK, which together with a spend cap
 * is what the provider's model actually offers. The key itself never ships in the binary — it is
 * handed to a device that has signed in (ADR-028).
 */
export const TILE_USER_AGENT_TOKEN = "EIAFieldAndroid";

/** `EIAFieldAndroid/1.1.0 (staging)` — the token, then what is useful in a provider's log. */
export function tileUserAgent(version: string, environment: string): string {
  return `${TILE_USER_AGENT_TOKEN}/${version} (${environment})`;
}
