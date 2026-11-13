// Mirrors the operations database: supabase/ops.sql (schema "ops").
// Kept apart from the sales types in lib/types.ts.

export type OpsStaff = { id: string; full_name: string; phone: string | null; active: boolean };

/** An operations manager (public.profiles with role operations). */
export type OpsManager = { id: string; full_name: string; email: string };

export type OpsClient = { id: string; name: string; code: string; lead_id: string | null };

export type OpsSite = {
  id: string;
  client_id: string;
  name: string;
  city: string | null;
  address: string | null;
  visits_per_month: number;
  pco_id: string | null;
  manager_id: string | null;
  status: "pending" | "active";
};

export type ComplaintStatus = "open" | "in_progress" | "resolved" | "closed";
export type ComplaintDecision = "revisit" | "inspection" | "meeting" | "closed";

export type OpsComplaint = {
  id: string;
  code: string;
  site_id: string;
  description: string;
  severity: "Low" | "Medium" | "High";
  lodged_by_name: string;
  lodged_at: string;
  status: ComplaintStatus;
  decision: ComplaintDecision | null;
  decision_note: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
};

export type VisitKind = "monthly" | "contract" | "revisit" | "meeting" | "inspection";
export type VisitStatus = "needs_pco" | "scheduled" | "started" | "needs_new_day" | "done";

export type OpsVisit = {
  id: string;
  kind: VisitKind;
  site_id: string | null;
  prospect_name: string | null;
  complaint_id: string | null;
  job_code: string | null;
  source: "admin" | "ops";
  status: VisitStatus;
  visit_date: string;
  visit_time: string;
  manager_id: string | null;
  pco_id: string | null;
  crew_ids: string[];
  treatments: string[];
  note: string | null;
};

export const VISIT_COLUMNS =
  "id, kind, site_id, prospect_name, complaint_id, job_code, source, status, visit_date, visit_time, manager_id, pco_id, crew_ids, treatments, note";

export const KIND_LABEL: Record<VisitKind, string> = {
  monthly: "Monthly visit",
  contract: "New contract",
  revisit: "Revisit",
  meeting: "Meeting",
  inspection: "Inspection",
};

export const VISIT_STATUS_META: Record<VisitStatus, { label: string; style: string }> = {
  needs_pco: { label: "Waiting for a PCO", style: "bg-rose-50 text-rose-700 ring-rose-200" },
  scheduled: { label: "Scheduled", style: "bg-sky-50 text-sky-700 ring-sky-200" },
  started: { label: "Started", style: "bg-violet-50 text-violet-700 ring-violet-200" },
  needs_new_day: { label: "Needs a new day", style: "bg-rose-50 text-rose-700 ring-rose-200" },
  done: { label: "Done", style: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
};

export const COMPLAINT_STATUS_META: Record<ComplaintStatus, { label: string; style: string }> = {
  open: { label: "Waiting for you", style: "bg-amber-50 text-amber-700 ring-amber-200" },
  in_progress: { label: "In progress", style: "bg-sky-50 text-sky-700 ring-sky-200" },
  resolved: { label: "Resolved", style: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  closed: { label: "Closed", style: "bg-slate-100 text-slate-600 ring-slate-200" },
};

export const DECISION_LABEL: Record<ComplaintDecision, string> = {
  revisit: "Revisit",
  inspection: "Inspection",
  meeting: "Meeting",
  closed: "Closed",
};

/** Common treatments, offered as suggestions (any text is allowed). */
export const TREATMENTS = [
  "General pest control spray",
  "Cockroach gel baiting",
  "Rodent bait stations",
  "Fogging / fumigation",
  "Ant gel treatment",
  "Termite treatment",
  "Bed bug treatment",
  "Fly control",
];

export const SLOTS = ["08:00", "09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00"];

/** A lead admin can link to a new client or a meeting (from the sales tables). */
export type LeadOption = { id: string; code: string; label: string };
