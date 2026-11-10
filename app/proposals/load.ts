import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVITY_COLUMNS, LEAD_COLUMNS, VISIT_KINDS, type Activity, type Lead } from "@/lib/types";

/** The lead and its submitted meeting / inspection reports (to write the proposal from). */
export async function loadLeadForProposal(supabase: SupabaseClient, leadId: string) {
  const [leadRes, reportsRes] = await Promise.all([
    supabase.from("leads").select(LEAD_COLUMNS).eq("id", leadId).maybeSingle<Lead>(),
    supabase
      .from("lead_activities")
      .select(ACTIVITY_COLUMNS)
      .eq("lead_id", leadId)
      .in("kind", VISIT_KINDS)
      .not("report_submitted_at", "is", null)
      .order("created_at", { ascending: false }),
  ]);
  return {
    lead: leadRes.data,
    reports: (reportsRes.data ?? []) as Activity[],
    error: leadRes.error?.message ?? reportsRes.error?.message,
  };
}
