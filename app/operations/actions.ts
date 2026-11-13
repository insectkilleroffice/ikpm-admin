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

export type ContractVisit = { date: string; time: string; treatments: string[] };
export type ContractSite = {
  name: string;
  city: string;
  address: string;
  visitsPerMonth: number;
  managerId: string;
  pcoId: string;
  visits: ContractVisit[];
};

/**
 * New contract, like a proposal: one client (new or existing) with one or more sites.
 * Each site has its operations manager and its service visits (day, time, treatments).
 */
export async function newContract(input: {
  clientId: string;
  clientName: string;
  leadId: string;
  sites: ContractSite[];
  note: string;
}): Promise<Result> {
  if (!input.clientId && !input.clientName.trim()) return { error: "Write the client name" };
  if (!input.sites.length) return { error: "Add at least one site" };
  for (const [i, s] of input.sites.entries()) {
    const name = s.name.trim() || `Site ${i + 1}`;
    if (!s.name.trim()) return { error: `Write the name of site ${i + 1}` };
    if (!s.managerId) return { error: `Pick the operations manager for ${name}` };
    if (!s.visits.length) return { error: `Add at least one visit for ${name}` };
    const noDay = s.visits.findIndex((v) => !v.date);
    if (noDay > -1) return { error: `Pick the day for visit ${noDay + 1} at ${name}` };
    const noTreat = s.visits.findIndex((v) => !v.treatments.some((t) => t.trim()));
    if (noTreat > -1) return { error: `Pick the treatment for visit ${noTreat + 1} at ${name}` };
  }
  const { error } = await (await ops()).rpc("new_contract", {
    p_client_id: input.clientId || null,
    p_client_name: input.clientName,
    p_lead_id: input.leadId || null,
    p_sites: input.sites.map((s) => ({
      name: s.name.trim(),
      city: s.city,
      address: s.address,
      visits_per_month: s.visitsPerMonth,
      manager_id: s.managerId,
      pco_id: s.pcoId || null,
      visits: s.visits.map((v) => ({ date: v.date, time: v.time, treatments: v.treatments.map((t) => t.trim()).filter(Boolean) })),
    })),
    p_note: input.note,
  });
  return done(error);
}

/** Move a site to another operations manager. */
export async function setSiteManager(siteId: string, managerId: string): Promise<Result> {
  if (!managerId) return { error: "Pick the operations manager" };
  const { error } = await (await ops()).rpc("set_site_manager", { p_site_id: siteId, p_manager_id: managerId });
  return done(error);
}

/** Meeting or inspection straight onto a manager's calendar. */
export async function assignMeeting(input: {
  kind: "meeting" | "inspection";
  siteId: string;
  prospectName: string;
  leadId: string;
  managerId: string;
  date: string;
  time: string;
  crewIds: string[];
  guests: string;
  note: string;
}): Promise<Result> {
  if (!input.siteId && !input.prospectName.trim()) return { error: "Pick the site or write the name of the lead" };
  if (!input.siteId && !input.managerId) return { error: "Pick the operations manager" };
  if (!input.date) return { error: "Pick the day" };
  const { error } = await (await ops()).rpc("assign_meeting", {
    p_kind: input.kind,
    p_site_id: input.siteId || null,
    p_prospect_name: input.prospectName,
    p_lead_id: input.leadId || null,
    p_manager_id: input.siteId ? null : input.managerId,
    p_date: input.date,
    p_time: input.time,
    p_crew_ids: input.crewIds,
    p_guests: input.guests,
    p_note: input.note,
  });
  return done(error);
}

/** Field team (PCOs). They do not sign in. */
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
