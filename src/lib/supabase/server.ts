import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NotConfiguredError, serverEnv } from "@/lib/env";

/** Supabase client bound to the current user's session (RLS applies). */
export async function createClient() {
  const url = serverEnv.supabaseUrl();
  const key = serverEnv.supabaseAnonKey();
  if (!url || !key) throw new NotConfiguredError("Supabase");
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}
