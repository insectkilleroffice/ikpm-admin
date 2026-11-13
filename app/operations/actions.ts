"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ComplaintDecision } from "@/lib/ops";

type Result = { error?: string };

/** Every write goes through a checked function in the "ops" schema (supabase/ops.sql). */
async function ops() {
  return (await createClient()).schema("ops");
}

function done(error?: { message: string } | null): Result {
  if (error) return { error: error.message };
  revalidatePath("/operations");
  return {};
}

/** Admin decides on a complaint: revisit, inspection, meeting, or close. */
export async function decideComplaint(input: {
  complaintId: string;
  decision: ComplaintDecision;
  date: string;
  time: string;
  note: string;
  crewIds: string[];
  guests: string;
}): Promise<Result> {
  const closing = input.decision === "closed";
  if (closing && !input.note.trim()) return { error: "Write why it is closed" };
  if (!closing && !input.date) return { error: "Pick the day" };
  const { error } = await (await ops()).rpc("decide_complaint", {
    p_complaint_id: input.complaintId,
    p_decision: input.decision,
    p_date: closing ? null : input.date,
    p_time: closing ? null : input.time,
    p_note: input.note,
    p_crew_ids: input.crewIds,
    p_guests: input.guests,
  });
  return done(error);
}

/** New contract: client (new or existing) + site + first visit with a fixed day. */
export async function newContract(input: {
  clientId: string;
  clientName: string;
  leadId: string;
  siteName: string;
  city: string;
  address: string;
  visitsPerMonth: number;
  supervisorId: string;
  date: string;
  time: string;
  note: string;
}): Promise<Result> {
  if (!input.clientId && !input.clientName.trim()) return { error: "Write the client name" };
  if (!input.siteName.trim()) return { error: "Write the site name" };
  if (!input.date) return { error: "Pick the day of the first visit" };
  const { error } = await (await ops()).rpc("new_contract", {
    p_client_id: input.clientId || null,
    p_client_name: input.clientName,
    p_lead_id: input.leadId || null,
    p_site_name: input.siteName,
    p_city: input.city,
    p_address: input.address,
    p_visits_per_month: input.visitsPerMonth,
    p_supervisor_id: input.supervisorId || null,
    p_date: input.date,
    p_time: input.time,
    p_note: input.note,
  });
  return done(error);
}

/** Meeting or inspection straight onto the operations calendar. */
export async function assignMeeting(input: {
  kind: "meeting" | "inspection";
  siteId: string;
  prospectName: string;
  leadId: string;
  date: string;
  time: string;
  crewIds: string[];
  guests: string;
  note: string;
}): Promise<Result> {
  if (!input.siteId && !input.prospectName.trim()) return { error: "Pick the site or write the name of the lead" };
  if (!input.date) return { error: "Pick the day" };
  const { error } = await (await ops()).rpc("assign_meeting", {
    p_kind: input.kind,
    p_site_id: input.siteId || null,
    p_prospect_name: input.prospectName,
    p_lead_id: input.leadId || null,
    p_date: input.date,
    p_time: input.time,
    p_crew_ids: input.crewIds,
    p_guests: input.guests,
    p_note: input.note,
  });
  return done(error);
}

/** Field team (supervisors and PCOs). They do not sign in. */
export async function addStaff(fullName: string, phone: string): Promise<Result> {
  if (!fullName.trim()) return { error: "Write the name" };
  const { error } = await (await ops())
    .from("staff")
    .insert({ full_name: fullName.trim(), phone: phone.trim() || null });
  if (error?.code === "23505") return { error: "Someone with this name is already in the team" };
  return done(error);
}

export async function setStaffActive(id: string, active: boolean): Promise<Result> {
  const { error } = await (await ops()).from("staff").update({ active }).eq("id", id);
  return done(error);
}
