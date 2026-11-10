import { Suspense } from "react";
import Link from "next/link";
import { LEAD_COLUMNS, PROPOSAL_COLUMNS, PROPOSAL_STATUS_META, money, type Lead, type Proposal } from "@/lib/types";
import AdminShell, { LoadError, Loading } from "../AdminShell";
import LocalDate from "./LocalDate";

export const metadata = { title: "Proposals · IKPM Admin" };

export default function ProposalsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AdminShell active="proposals">
        {async ({ supabase }) => {
          const [proposalsRes, leadsRes] = await Promise.all([
            supabase.from("proposals").select(PROPOSAL_COLUMNS).order("created_at", { ascending: false }),
            supabase.from("leads").select(LEAD_COLUMNS).neq("stage", "new"),
          ]);
          const error = proposalsRes.error ?? leadsRes.error;
          if (error) return <LoadError message={`${error.message} — did you run ikpm-admin/supabase/admin.sql in Supabase?`} />;

          const proposals = proposalsRes.data as Proposal[];
          const leads = leadsRes.data as Lead[];
          const leadById = new Map(leads.map((l) => [l.id, l]));
          const withProposal = new Set(proposals.map((p) => p.lead_id));
          const needed = leads.filter((l) => l.stage === "proposal" && !withProposal.has(l.id));

          return (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">Proposals</h1>
                <p className="text-sm text-slate-500">Write proposals for leads the sales team moved to Proposal.</p>
              </div>

              <section className="rounded-xl border border-amber-200 bg-white">
                <header className="border-b border-amber-100 px-4 py-2.5 text-sm font-semibold text-amber-800">
                  Proposal needed <span className="font-normal text-slate-400">{needed.length}</span>
                </header>
                {needed.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-slate-400">Nothing waiting.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {needed.map((l) => (
                      <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-slate-900">{l.company_name || l.name}</p>
                          <p className="text-xs text-slate-500">
                            {l.code} · {l.assigned_to_name || "No owner"} · moved <LocalDate iso={l.updated_at} />
                          </p>
                        </div>
                        <Link href={`/proposals/new?lead=${l.id}`} className="btn-primary">
                          Create proposal
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full min-w-[48rem] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium tracking-wide text-slate-500 uppercase">
                    <tr>
                      <th className="px-4 py-2.5">Proposal</th>
                      <th className="px-4 py-2.5">Client</th>
                      <th className="px-4 py-2.5">Salesperson</th>
                      <th className="px-4 py-2.5 text-right">Total</th>
                      <th className="px-4 py-2.5">Created</th>
                      <th className="px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {proposals.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                          No proposals yet.
                        </td>
                      </tr>
                    )}
                    {proposals.map((p) => {
                      const l = leadById.get(p.lead_id);
                      return (
                        <tr key={p.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <Link href={`/proposals/${p.id}`} className="font-medium text-emerald-700 hover:underline">
                              {p.code}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-slate-900">{l ? l.company_name || l.name : "—"}</td>
                          <td className="px-4 py-3 text-slate-700">{l?.assigned_to_name || "—"}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-900">{money(p.total, p.currency)}</td>
                          <td className="px-4 py-3 text-slate-500">
                            <LocalDate iso={p.created_at} /> · {p.created_by_name}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${PROPOSAL_STATUS_META[p.status].style}`}
                            >
                              {PROPOSAL_STATUS_META[p.status].label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }}
      </AdminShell>
    </Suspense>
  );
}
