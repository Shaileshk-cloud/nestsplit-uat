import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { safeNext } from "@/app/lib/url";

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient() {
  if (typeof window === "undefined") {
    return null;
  }

  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    return null;
  }

  supabaseClient = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  return supabaseClient;
}

function getOAuthCallbackUrl(nextPath: string) {
  if (typeof window === "undefined") {
    throw new Error("OAuth can only start in a browser.");
  }

  // This intentionally uses the browser's active origin: localhost in local
  // development and the current Vercel production domain after deployment.
  const callbackUrl = new URL("/auth/callback", window.location.origin);
  callbackUrl.searchParams.set("next", safeNext(nextPath));
  return callbackUrl.toString();
}

export async function signInWithGoogle(nextPath = "/") {
  const supabase = getSupabaseBrowserClient();
  if (!supabase || typeof window === "undefined") {
    throw new Error("Supabase is not configured.");
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: getOAuthCallbackUrl(nextPath) },
  });
  if (error) throw error;
}
