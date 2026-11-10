"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FiShield } from "react-icons/fi";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return setError("Enter your email and password");
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) {
      setLoading(false);
      return setError(error?.message ?? "Sign in failed");
    }

    // This app is for admins only.
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profile?.role !== "admin") {
      await supabase.auth.signOut();
      setLoading(false);
      return setError("This account is not an admin. Only admins can sign in here.");
    }

    router.replace("/sales");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-slate-50 p-4">
      <form
        onSubmit={onSubmit}
        noValidate
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-700 text-white">
            <FiShield size={18} />
          </span>
          <div className="leading-tight">
            <p className="font-semibold text-slate-900">IKPM Admin</p>
            <p className="text-xs text-slate-500">Pest Management</p>
          </div>
        </div>

        <h1 className="text-lg font-semibold text-slate-900">Admin sign in</h1>
        <p className="mb-4 text-sm text-slate-500">Use your admin account.</p>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Email</span>
            <input
              autoFocus
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="input"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
            />
          </label>
        </div>

        {error && <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

        <button type="submit" disabled={loading} className="btn-primary mt-5 w-full">
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
