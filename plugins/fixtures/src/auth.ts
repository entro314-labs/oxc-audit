import { createServerClient, createBrowserClient } from "@supabase/ssr";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

export const db = createServerClient(url, key, { cookies });

export async function guard() {
	const { data } = await db.auth.getSession();
	if (!data.session) throw new Error("unauthorized");
	const { data: rows } = await db.from("posts").select();
	return rows;
}

export const browser = createBrowserClient(url, key);
