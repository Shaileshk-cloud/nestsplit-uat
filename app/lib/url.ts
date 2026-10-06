/**
 * Open-redirect guard for post-auth "next" redirects.
 *
 * Only same-origin relative paths are allowed: the value must start with a
 * single "/". Protocol-relative ("//evil.com") and absolute ("https://evil")
 * URLs — the classic open-redirect vectors — fall back to "/".
 *
 * Single source of truth shared by the OAuth start (app/lib/supabase.ts) and
 * the callback route (app/auth/callback/route.ts), and covered by url.test.ts.
 */
export function safeNext(value: string | null | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}
