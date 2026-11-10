import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { signOut } from "./actions";

/**
 * Signs-in check + header for every admin page. Children get the Supabase
 * client of the signed-in admin. Render inside <Suspense>.
 */
export default async function AdminShell({
  active,
  children,
}: {
  active: "sales" | "proposals";
  children: (ctx: { supabase: SupabaseClient; me: Profile }) => Promise<ReactNode>;
}) {
  await connection();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  if (me?.role !== "admin") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Admins only</h1>
        <p className="text-sm text-slate-500">{user.email} is not an admin account.</p>
        <form action={signOut}>
          <button className="btn-secondary">Sign out</button>
        </form>
      </main>
    );
  }

  const links = [
    { id: "sales", href: "/sales", label: "Sales" },
    { id: "proposals", href: "/proposals", label: "Proposals" },
  ] as const;

  return (
    <main className="flex flex-1 flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-5">
            <div className="leading-tight">
              <p className="font-semibold text-slate-900">IKPM Admin</p>
              <p className="text-xs text-slate-500">{me.full_name || me.email}</p>
            </div>
            <nav className="flex gap-1">
              {links.map((l) => (
                <Link
                  key={l.id}
                  href={l.href}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    active === l.id ? "bg-emerald-50 text-emerald-800" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>
          <form action={signOut}>
            <button className="btn-secondary">Sign out</button>
          </form>
        </div>
      </header>
      <div className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6 print:max-w-none print:p-0">
        {await children({ supabase, me })}
      </div>
    </main>
  );
}

export function LoadError({ message }: { message: string }) {
  return <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">Could not load data: {message}</p>;
}

export function Loading() {
  return <main className="flex flex-1 items-center justify-center text-sm text-slate-400">Loading…</main>;
}
