"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ACTIVITY_LABELS, TASK_KINDS, VISIT_KINDS, type Activity, type ActivityKind, type Lead, type Profile, type Proposal } from "@/lib/types";
import { TASK_STATUS_META, currentStepByLead, latestProposalByLead, taskStatus, type TaskStatus } from "@/lib/tasks";
import { formatDateTime } from "@/lib/format";

const KIND_STYLE: Partial<Record<ActivityKind, string>> = {
  meeting: "text-violet-700",
  call: "text-indigo-700",
  inspection: "text-amber-700",
  proposal: "text-emerald-700",
};

const TYPE_FILTERS = [
  { id: "all", label: "All" },
  { id: "meeting", label: "Meetings" },
  { id: "inspection", label: "Inspections" },
  { id: "proposal", label: "Proposals" },
] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number]["id"];

const matchesType = (kind: ActivityKind, f: TypeFilter) =>
  f === "all" || kind === f || (f === "meeting" && kind === "call");

/** Things admin needs to act on, shown first in the status filter. */
const ACTION_STATUSES: TaskStatus[] = ["needs_attendee", "report_due", "awaiting_proposal", "draft"];

interface Props {
  leads: Lead[];
  activities: Activity[];
  staff: Profile[];
  proposals: Proposal[];
  onSelect: (lead: Lead) => void;
}

export default function TasksTable({ leads, activities, proposals, onSelect }: Props) {
  const [type, setType] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<TaskStatus | "all" | "action">("all");

  const rows = useMemo(() => {
    const leadById = new Map(leads.map((l) => [l.id, l]));
    const current = currentStepByLead(activities);
    const proposalOf = latestProposalByLead(proposals);
    return activities.flatMap((a) => {
      const lead = leadById.get(a.lead_id);
      if (!lead || !TASK_KINDS.includes(a.kind)) return [];
      const proposal = proposalOf.get(a.lead_id);
      return [{ a, lead, proposal, status: taskStatus(a, lead, current.get(a.lead_id), proposal) }];
    });
  }, [leads, activities, proposals]);

  const byType = rows.filter((r) => matchesType(r.a.kind, type));
  const shown = byType.filter(
    (r) => status === "all" || r.status === status || (status === "action" && ACTION_STATUSES.includes(r.status)),
  );
  const count = (s: TaskStatus) => byType.filter((r) => r.status === s).length;
  const actionCount = byType.filter((r) => ACTION_STATUSES.includes(r.status)).length;

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium ${
      active ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
    }`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {TYPE_FILTERS.map((f) => (
          <button key={f.id} type="button" onClick={() => setType(f.id)} className={chip(type === f.id)}>
            {f.label} <span className="ml-0.5 text-slate-400">{rows.filter((r) => matchesType(r.a.kind, f.id)).length}</span>
          </button>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" />
        <button type="button" onClick={() => setStatus("action")} className={chip(status === "action")}>
          Needs action <span className="ml-0.5 text-slate-400">{actionCount}</span>
        </button>
        <select
          value={status === "action" ? "all" : status}
          onChange={(e) => setStatus(e.target.value as TaskStatus | "all")}
          aria-label="Status"
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 outline-none"
        >
          <option value="all">Any status</option>
          {(Object.keys(TASK_STATUS_META) as TaskStatus[]).map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS_META[s].label} ({count(s)})
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[64rem] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-2.5">Lead</th>
              <th className="px-4 py-2.5">Task</th>
              <th className="px-4 py-2.5">Scheduled for</th>
              <th className="px-4 py-2.5">Salesperson</th>
              <th className="w-56 px-4 py-2.5">Attendee / Proposal</th>
              <th className="px-4 py-2.5">Report</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">
                  No tasks match.
                </td>
              </tr>
            )}
            {shown.map(({ a, lead, proposal, status: s }) => (
              <tr key={a.id} onClick={() => onSelect(lead)} className="cursor-pointer align-top hover:bg-slate-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{lead.company_name || lead.name}</p>
                  <p className="text-xs text-slate-500">
                    {lead.code}
                    {lead.company_name ? ` · ${lead.name}` : ""}
                  </p>
                </td>
                <td className={`px-4 py-3 font-medium whitespace-nowrap ${KIND_STYLE[a.kind] ?? ""}`}>
                  {a.kind === "proposal" ? "Proposal" : ACTIVITY_LABELS[a.kind]}
                  <p className="text-xs font-normal text-slate-400">by {a.created_by_name}</p>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-700 tabular-nums">
                  {a.scheduled_at ? formatDateTime(a.scheduled_at) : "—"}
                </td>
                <td className="px-4 py-3 text-slate-700">{lead.assigned_to_name || "—"}</td>
                <td className="px-4 py-3">
                  {VISIT_KINDS.includes(a.kind) ? (
                    s === "needs_attendee" ? (
                      // Opens the lead panel (row click) where admin picks who, the address and notes.
                      <button type="button" className="btn-primary px-2.5 py-1 text-xs">
                        Assign
                      </button>
                    ) : (
                      <div className="text-slate-700">
                        <p>{a.attendee_name || "—"}</p>
                        {a.visit_address && (
                          <p className="line-clamp-1 text-xs text-slate-500" title={a.visit_address}>
                            {a.visit_address}
                          </p>
                        )}
                      </div>
                    )
                  ) : proposal ? (
                    <Link
                      href={`/proposals/${proposal.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-emerald-700 hover:underline"
                    >
                      {proposal.code}
                    </Link>
                  ) : s === "awaiting_proposal" ? (
                    <Link
                      href={`/proposals/new?lead=${lead.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="btn-primary px-2.5 py-1 text-xs"
                    >
                      Create proposal
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="max-w-[16rem] px-4 py-3 text-slate-600">
                  {a.report ? (
                    <>
                      <p className="line-clamp-2" title={a.report}>
                        {a.report}
                      </p>
                      <p className="text-xs text-slate-400">
                        {a.report_by_name} · {formatDateTime(a.report_submitted_at!)}
                      </p>
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset ${TASK_STATUS_META[s].style}`}
                  >
                    {TASK_STATUS_META[s].label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
