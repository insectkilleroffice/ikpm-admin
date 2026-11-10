"use client";

import { FiBriefcase, FiClock, FiHome, FiPhone, FiUser, FiUsers } from "react-icons/fi";
import { ACTIVITY_LABELS, type Activity, type Lead, type LeadStage, type Proposal } from "@/lib/types";
import { TASK_STATUS_META, taskStatus } from "@/lib/tasks";
import { dueStatus, formatDateTime } from "@/lib/format";

type Lookups = { currentStep: Map<string, Activity>; proposalOf: Map<string, Proposal> };

type Column = "follow_up" | "meeting" | "inspection" | "proposal" | "closed";

const COLUMNS: { id: Column; label: string; bar: string }[] = [
  { id: "follow_up", label: "Follow-up", bar: "bg-sky-500" },
  { id: "meeting", label: "Meeting", bar: "bg-violet-500" },
  { id: "inspection", label: "Inspection", bar: "bg-amber-500" },
  { id: "proposal", label: "Proposal", bar: "bg-emerald-600" },
  { id: "closed", label: "Closed", bar: "bg-slate-400" },
];

const columnOf = (stage: LeadStage): Column | null =>
  stage === "new" ? null : stage === "call" ? "meeting" : stage;

const DUE_STYLES = {
  overdue: "bg-rose-50 text-rose-700",
  today: "bg-amber-50 text-amber-700",
  upcoming: "bg-slate-100 text-slate-600",
};

export default function Board({
  leads,
  onSelect,
  ...lookups
}: { leads: Lead[]; onSelect: (lead: Lead) => void } & Lookups) {
  const columns = COLUMNS.map((c) => ({
    ...c,
    items: leads
      .filter((l) => columnOf(l.stage) === c.id)
      .sort((a, b) =>
        c.id === "closed"
          ? b.updated_at.localeCompare(a.updated_at)
          : (a.next_action_at ?? "￿").localeCompare(b.next_action_at ?? "￿"),
      ),
  })).filter((c) => c.id !== "closed" || c.items.length > 0);

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
      <div className="grid min-w-max auto-cols-[16rem] grid-flow-col gap-3 xl:min-w-0 xl:auto-cols-fr">
        {columns.map((c) => (
          <section key={c.id} className="flex min-h-[60vh] flex-col rounded-xl border border-slate-200 bg-slate-100/60">
            <header className="px-3 pt-3 pb-2">
              <div className={`mb-2 h-1 rounded-full ${c.bar}`} />
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-slate-800">{c.label}</h2>
                <span className="text-xs text-slate-500">
                  {c.items.length} {c.items.length === 1 ? "lead" : "leads"}
                </span>
              </div>
            </header>
            <div className="flex-1 space-y-2 px-2 pb-2">
              {c.items.length === 0 && <p className="px-1 py-6 text-center text-xs text-slate-400">No leads</p>}
              {c.items.map((l) => (
                <Card key={l.id} lead={l} onSelect={onSelect} {...lookups} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Card({
  lead: l,
  onSelect,
  currentStep,
  proposalOf,
}: { lead: Lead; onSelect: (lead: Lead) => void } & Lookups) {
  const TypeIcon = l.type === "Company" ? FiBriefcase : FiHome;
  const due = l.next_action_at ? dueStatus(l.next_action_at) : null;
  const step = currentStep.get(l.id);
  const status =
    step && ["meeting", "call", "inspection", "proposal"].includes(l.stage)
      ? taskStatus(step, l, step, proposalOf.get(l.id))
      : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(l)}
      className="block w-full rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-emerald-300 hover:shadow focus-visible:ring-2 focus-visible:ring-emerald-200 focus-visible:outline-none"
    >
      <p className="truncate text-sm font-medium text-slate-900">{l.company_name || l.name}</p>
      <p className="flex items-center gap-1 truncate text-xs text-slate-500">
        <TypeIcon size={11} className="shrink-0" />
        {l.company_name ? l.name : l.type}
      </p>

      {(l.stage === "meeting" || l.stage === "call") && (
        <span
          className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            l.stage === "call" ? "bg-indigo-50 text-indigo-700" : "bg-violet-50 text-violet-700"
          }`}
        >
          {l.stage === "call" ? <FiPhone size={11} /> : <FiUsers size={11} />}
          {l.stage === "call" ? "On call meeting" : "In person meeting"}
        </span>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {l.stage === "closed" && l.closed_reason ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            {ACTIVITY_LABELS[l.closed_reason]}
          </span>
        ) : (
          l.next_action_at &&
          due && (
            <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${DUE_STYLES[due]}`}>
              <FiClock size={11} /> {formatDateTime(l.next_action_at)}
            </span>
          )
        )}
        {status && status !== "moved_on" && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TASK_STATUS_META[status].style}`}
          >
            {TASK_STATUS_META[status].label}
          </span>
        )}
      </div>

      <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
        <p className="flex items-center gap-1">
          <FiUser size={11} className="shrink-0" />
          <span className="truncate">{l.assigned_to_name || "No owner"}</span>
        </p>
        {step?.attendee_name && step.kind === l.stage && (
          <p className="truncate pl-4" title={step.attendee_name}>
            {step.attendee_ids?.length > 1 ? "Attendees" : "Attendee"}: {step.attendee_name}
          </p>
        )}
      </div>
    </button>
  );
}
