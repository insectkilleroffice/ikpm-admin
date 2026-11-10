// Mirrors the shared database: ikpm-new/supabase/schema.sql (sales tables)
// plus this app's supabase/admin.sql (attendees, reports, proposals).

export type LeadStage = "new" | "follow_up" | "call" | "meeting" | "inspection" | "proposal" | "closed";

export type ActivityKind =
  | "follow_up"
  | "call"
  | "meeting"
  | "inspection"
  | "proposal"
  | "wrong_lead"
  | "already_working"
  | "proposal_sent"
  | "proposal_accepted"
  | "proposal_rejected";

export type Lead = {
  id: string;
  code: string;
  type: "Residential" | "Company";
  name: string;
  company_name: string | null;
  phone: string;
  email: string | null;
  source: string;
  added_by_name: string;
  stage: LeadStage;
  assigned_to: string | null;
  assigned_to_name: string | null;
  next_action_at: string | null;
  closed_reason: "wrong_lead" | "already_working" | null;
  created_at: string;
  updated_at: string;
};

export type Activity = {
  id: string;
  lead_id: string;
  kind: ActivityKind;
  scheduled_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
  attendee_ids: string[]; // one or more staff (any role, incl. admin)
  attendee_name: string | null; // their names, e.g. "Ali Raza, Sara Khan"
  attendee_assigned_at: string | null;
  attendee_assigned_by_name: string | null;
  attendee_notes: string | null; // admin's notes for the attendee
  visit_address: string | null; // where to go (not for a meeting on call)
  report: string | null;
  report_by_name: string | null;
  report_submitted_at: string | null;
};

export type ProposalStatus = "draft" | "sent" | "accepted" | "rejected";

/** One row of a service plan table: a service and its frequency at each site. */
export type PlanRow = { service: string; values: string[] };

/** A "Monthly IPM Service Plan" table: one column per site, with a monthly rate per site. */
export type ServicePlan = { title: string; sites: string[]; rows: PlanRow[]; rates: number[] };

export type Proposal = {
  id: string;
  code: string;
  lead_id: string;
  title: string | null;
  proposal_date: string; // YYYY-MM-DD
  client_name: string | null;
  client_address: string | null;
  attention_name: string | null;
  attention_designation: string | null;
  subject: string | null;
  intro: string | null;
  scope: string | null; // one point per line
  terms: string | null; // one point per line
  plans: ServicePlan[];
  tenure_start: string | null; // YYYY-MM-01
  tenure_end: string | null;
  payment_terms: string | null;
  closing: string | null;
  currency: string;
  total: number;
  status: ProposalStatus;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
};

export const PROPOSAL_COLUMNS =
  "id, code, lead_id, title, proposal_date, client_name, client_address, attention_name, attention_designation, subject, intro, scope, terms, plans, tenure_start, tenure_end, payment_terms, closing, currency, total, status, created_by_name, created_at, updated_at, sent_at";

export const PROPOSAL_STATUS_META: Record<ProposalStatus, { label: string; style: string }> = {
  draft: { label: "Draft", style: "bg-amber-50 text-amber-700 ring-amber-200" },
  sent: { label: "Sent", style: "bg-sky-50 text-sky-700 ring-sky-200" },
  accepted: { label: "Accepted", style: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  rejected: { label: "Rejected", style: "bg-rose-50 text-rose-700 ring-rose-200" },
};

/** Number of months from tenure start to end, both included (July 2026 → March 2027 = 9). */
export function tenureMonths(start: string | null, end: string | null) {
  if (!start || !end) return 0;
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return Math.max(0, (ey - sy) * 12 + (em - sm) + 1);
}

/** Monthly fee = all site rates added up; contract value = monthly × months (or just monthly without a tenure). */
export function proposalTotals(p: { plans: ServicePlan[]; tenure_start: string | null; tenure_end: string | null }) {
  const monthly = p.plans.reduce((s, plan) => s + plan.rates.reduce((a, r) => a + (Number(r) || 0), 0), 0);
  const months = tenureMonths(p.tenure_start, p.tenure_end);
  return { monthly, months, total: months > 0 ? monthly * months : monthly };
}

/** "39,000/-" style amounts used on the proposal letter. */
export function rupees(n: number) {
  return `${Math.round(Number(n) || 0).toLocaleString("en-US")}/-`;
}

export function money(n: number, currency: string) {
  return `${currency} ${rupees(n)}`;
}

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: "admin" | "operations" | "sales" | "finance";
};

export const LEAD_COLUMNS =
  "id, code, type, name, company_name, phone, email, source, added_by_name, stage, assigned_to, assigned_to_name, next_action_at, closed_reason, created_at, updated_at";

export const ACTIVITY_COLUMNS =
  "id, lead_id, kind, scheduled_at, notes, created_by, created_by_name, created_at, attendee_ids, attendee_name, attendee_assigned_at, attendee_assigned_by_name, attendee_notes, visit_address, report, report_by_name, report_submitted_at";

export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  follow_up: "Follow-up",
  call: "Meeting · On call",
  meeting: "Meeting · In person",
  inspection: "Inspection",
  proposal: "Moved to Proposal",
  wrong_lead: "Wrong lead",
  already_working: "Working with other company",
  proposal_sent: "Proposal sent",
  proposal_accepted: "Proposal accepted",
  proposal_rejected: "Proposal rejected",
};

/** Steps admin can schedule on a lead from this app (moves the lead's stage). */
export const SCHEDULABLE_KINDS = ["follow_up", "meeting", "call", "inspection", "proposal"] as const;
export type SchedulableKind = (typeof SCHEDULABLE_KINDS)[number];

/** Steps that need someone to attend and a report. */
export const VISIT_KINDS: ActivityKind[] = ["meeting", "call", "inspection"];

/** Activity kinds that show up as rows in the Tasks table. */
export const TASK_KINDS: ActivityKind[] = ["meeting", "call", "inspection", "proposal"];
