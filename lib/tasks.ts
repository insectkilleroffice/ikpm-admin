import { VISIT_KINDS, type Activity, type ActivityKind, type Lead, type Proposal } from "./types";

export type TaskStatus =
  | "needs_attendee"
  | "assigned"
  | "report_due"
  | "report_in"
  | "moved_on"
  | "awaiting_proposal"
  | "draft"
  | "sent"
  | "accepted"
  | "rejected";

export const TASK_STATUS_META: Record<TaskStatus, { label: string; style: string }> = {
  needs_attendee: { label: "Needs attendee", style: "bg-amber-50 text-amber-800 ring-amber-200" },
  assigned: { label: "Assigned", style: "bg-sky-50 text-sky-700 ring-sky-200" },
  report_due: { label: "Report due", style: "bg-rose-50 text-rose-700 ring-rose-200" },
  report_in: { label: "Report in", style: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  moved_on: { label: "Moved on", style: "bg-slate-100 text-slate-600 ring-slate-200" },
  awaiting_proposal: { label: "Proposal needed", style: "bg-amber-50 text-amber-800 ring-amber-200" },
  draft: { label: "Proposal draft", style: "bg-amber-50 text-amber-700 ring-amber-200" },
  sent: { label: "Proposal sent", style: "bg-sky-50 text-sky-700 ring-sky-200" },
  accepted: { label: "Accepted", style: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  rejected: { label: "Rejected", style: "bg-rose-50 text-rose-700 ring-rose-200" },
};

/** Activities that move a lead's stage (proposal_* events don't). */
const STAGE_KINDS: ActivityKind[] = ["follow_up", "call", "meeting", "inspection", "proposal", "wrong_lead", "already_working"];

/** The activity that put each lead in its current stage. Activities must be newest first. */
export function currentStepByLead(activities: Activity[]) {
  const m = new Map<string, Activity>();
  for (const a of activities) if (STAGE_KINDS.includes(a.kind) && !m.has(a.lead_id)) m.set(a.lead_id, a);
  return m;
}

/** Newest proposal per lead. Proposals must be newest first. */
export function latestProposalByLead(proposals: Proposal[]) {
  const m = new Map<string, Proposal>();
  for (const p of proposals) if (!m.has(p.lead_id)) m.set(p.lead_id, p);
  return m;
}

export function taskStatus(
  a: Activity,
  lead: Lead,
  current: Activity | undefined,
  proposal: Proposal | undefined,
): TaskStatus {
  const isCurrent = current?.id === a.id && lead.stage === a.kind;

  if (a.kind === "proposal") {
    if (proposal) return proposal.status;
    return isCurrent ? "awaiting_proposal" : "moved_on";
  }
  if (VISIT_KINDS.includes(a.kind)) {
    if (a.report_submitted_at) return "report_in";
    if (!isCurrent) return "moved_on";
    if (!a.attendee_ids?.length) return "needs_attendee";
    return a.scheduled_at && new Date(a.scheduled_at) < new Date() ? "report_due" : "assigned";
  }
  return "moved_on";
}
