"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  SCHEDULABLE_KINDS,
  proposalTotals,
  type ProposalStatus,
  type ServicePlan,
  type SchedulableKind,
} from "@/lib/types";

type Result = { error?: string };

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

function done(error?: { message: string } | null): Result {
  if (error) return { error: error.message };
  revalidatePath("/sales");
  revalidatePath("/proposals", "layout");
  return {};
}

/**
 * Schedules the next step on a lead (moves its stage). Goes through the shared
 * log_lead_activity() function, so it is added to the lead's history.
 */
export async function scheduleStep(input: {
  leadId: string;
  kind: SchedulableKind;
  scheduledAt: string | null;
  notes: string;
}): Promise<Result> {
  if (!input.leadId) return { error: "Choose a lead" };
  if (!SCHEDULABLE_KINDS.includes(input.kind)) return { error: "Choose a step" };
  if (input.kind !== "proposal" && !input.scheduledAt) return { error: "Choose a date and time" };
  if (!input.notes.trim()) return { error: "Add notes" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("log_lead_activity", {
    p_lead_id: input.leadId,
    p_kind: input.kind,
    p_scheduled_at: input.scheduledAt,
    p_notes: input.notes,
  });
  return done(error);
}

/**
 * Picks who attends a meeting / inspection: one or more staff (admin can pick
 * themself), with notes for them and the address (not needed on call).
 */
export async function assignAttendee(input: {
  activityId: string;
  attendeeIds: string[];
  notes: string;
  address: string;
  needsAddress: boolean;
}): Promise<Result> {
  if (input.attendeeIds.length === 0) return { error: "Choose at least one person" };
  if (input.needsAddress && !input.address.trim()) return { error: "Add the address" };
  if (!input.notes.trim()) return { error: "Add notes for the attendees" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_attendee", {
    p_activity_id: input.activityId,
    p_attendee_ids: input.attendeeIds,
    p_notes: input.notes.trim(),
    p_address: input.address.trim() || null,
  });
  return done(error);
}

/** Admin can also fill in a report on someone's behalf. */
export async function submitReport(activityId: string, report: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_report", { p_activity_id: activityId, p_report: report });
  return done(error);
}

/** Editable fields of a proposal letter. */
export type ProposalDraft = {
  title: string;
  proposal_date: string;
  client_name: string;
  client_address: string;
  attention_name: string;
  attention_designation: string;
  subject: string;
  intro: string;
  scope: string;
  terms: string;
  plans: ServicePlan[];
  tenure_start: string | null;
  tenure_end: string | null;
  payment_terms: string;
  closing: string;
  currency: string;
};

const txt = (v: string) => v.trim() || null;

function clean(d: ProposalDraft) {
  const plans = d.plans.map((p) => ({
    title: p.title.trim(),
    sites: p.sites.map((s) => s.trim()),
    rows: p.rows
      .filter((r) => r.service.trim())
      .map((r) => ({ service: r.service.trim(), values: p.sites.map((_, i) => (r.values[i] ?? "").trim()) })),
    rates: p.sites.map((_, i) => Number(p.rates[i]) || 0),
  }));
  const row = {
    title: txt(d.title),
    proposal_date: d.proposal_date || new Date().toISOString().slice(0, 10),
    client_name: txt(d.client_name),
    client_address: txt(d.client_address),
    attention_name: txt(d.attention_name),
    attention_designation: txt(d.attention_designation),
    subject: txt(d.subject),
    intro: txt(d.intro),
    scope: txt(d.scope),
    terms: txt(d.terms),
    plans,
    tenure_start: d.tenure_start || null,
    tenure_end: d.tenure_end || null,
    payment_terms: txt(d.payment_terms),
    closing: txt(d.closing),
    currency: d.currency.trim().toUpperCase() || "PKR",
  };
  if (row.tenure_start && row.tenure_end && row.tenure_end < row.tenure_start)
    throw new Error("Tenure end must be after the start");
  return { ...row, total: proposalTotals(row).total };
}

export async function createProposal(leadId: string, draft: ProposalDraft): Promise<Result & { id?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const { data: me } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  let row;
  try {
    row = clean(draft);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const { data, error } = await supabase
    .from("proposals")
    .insert({ lead_id: leadId, ...row, created_by_name: me?.full_name ?? user.email })
    .select("id")
    .single();
  if (error) return { error: error.message };
  done();
  return { id: data.id };
}

export async function saveProposal(id: string, draft: ProposalDraft): Promise<Result> {
  let row;
  try {
    row = clean(draft);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proposals")
    .update({ ...row, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (!error && data.length === 0) return { error: "Only drafts can be edited" };
  return done(error);
}

/**
 * Notes are required for every status change (for a rejection: the reason).
 * Rejected also needs a follow-up ISO date: the lead goes back to Follow-up on
 * the salesperson's board, tagged "Rejected".
 */
export async function setProposalStatus(
  id: string,
  status: Exclude<ProposalStatus, "draft">,
  notes: string,
  followUpAt?: string
): Promise<Result> {
  if (!notes.trim()) return { error: status === "rejected" ? "Write why the client rejected it" : "Add notes" };
  if (status === "rejected" && !followUpAt) return { error: "Choose a follow-up date and time" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_proposal_status", {
    p_proposal_id: id,
    p_status: status,
    p_reason: notes.trim(),
    p_follow_up_at: status === "rejected" ? followUpAt : null,
  });
  return done(error);
}

export async function deleteProposal(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("proposals").delete().eq("id", id);
  if (error) return { error: error.message };
  done();
  redirect("/proposals");
}
