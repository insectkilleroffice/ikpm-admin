import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The signed-in user from the session token.
 * Uses getClaims(): the token is checked locally (with the project's signing keys),
 * so a page change does not wait for a round trip to the Supabase Auth server the way
 * getUser() does. It also refreshes the session when the token is about to expire.
 */
export async function signedInUser(supabase: SupabaseClient): Promise<{ id: string; email: string } | null> {
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : "" };
}
