"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { FiCheckSquare, FiColumns, FiSearch } from "react-icons/fi";
import type { Activity, Lead, Profile, Proposal } from "@/lib/types";
import { currentStepByLead, latestProposalByLead } from "@/lib/tasks";
import Board from "./Board";
import TasksTable from "./TasksTable";
import LeadSheet from "./LeadSheet";

const noop = () => () => {};
/** Dates and "overdue" depend on the browser's clock and time zone, so render on the client only. */
const useMounted = () => useSyncExternalStore(noop, () => true, () => false);

interface Props {
  leads: Lead[];
  activities: Activity[];
  staff: Profile[]; // all staff (any role)
  meId: string; // signed-in admin, shown as "(you)" when assigning
  proposals: Proposal[];
}

export default function AdminSales({ leads, activities, staff, meId, proposals }: Props) {
  const mounted = useMounted();
  const [view, setView] = useState<"tasks" | "board">("tasks");
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const salespeople = staff.filter((p) => p.role === "sales");

  const visibleLeads = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((l) => {
      if (owner === "unassigned" ? l.assigned_to : owner !== "all" && l.assigned_to !== owner) return false;
      if (!q) return true;
      return [l.name, l.company_name, l.phone, l.email, l.code, l.assigned_to_name].some((v) =>
        (v ?? "").toLowerCase().includes(q),
      );
    });
  }, [leads, query, owner]);

  const currentStep = useMemo(() => currentStepByLead(activities), [activities]);
  const proposalOf = useMemo(() => latestProposalByLead(proposals), [proposals]);
  const selected = selectedId ? leads.find((l) => l.id === selectedId) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Sales</h1>
          <p className="text-sm text-slate-500">Every salesperson&apos;s pipeline. Assign attendees and follow up on reports.</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5" role="tablist" aria-label="View">
            {(
              [
                ["tasks", "Tasks", FiCheckSquare],
                ["board", "Board", FiColumns],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                onClick={() => setView(id)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
                  view === id ? "bg-emerald-700 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>

          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            aria-label="Salesperson"
          >
            <option value="all">All salespeople</option>
            {salespeople.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
            <option value="unassigned">No owner</option>
          </select>

          <label className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-400 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-100 sm:w-60">
            <FiSearch className="shrink-0" size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full bg-transparent text-slate-800 outline-none placeholder:text-slate-400"
            />
          </label>
        </div>
      </div>

      {!mounted ? (
        <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
      ) : view === "board" ? (
        <Board leads={visibleLeads} currentStep={currentStep} proposalOf={proposalOf} onSelect={(l) => setSelectedId(l.id)} />
      ) : (
        <TasksTable
          leads={visibleLeads}
          activities={activities}
          staff={staff}
          proposals={proposals}
          onSelect={(l) => setSelectedId(l.id)}
        />
      )}

      {selected && (
        <LeadSheet
          lead={selected}
          history={activities.filter((a) => a.lead_id === selected.id)}
          proposals={proposals.filter((p) => p.lead_id === selected.id)}
          staff={staff}
          meId={meId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
