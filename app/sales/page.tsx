import { Suspense } from "react";
import {
  ACTIVITY_COLUMNS,
  LEAD_COLUMNS,
  PROPOSAL_COLUMNS,
  type Activity,
  type Lead,
  type Profile,
  type Proposal,
} from "@/lib/types";
import AdminShell, { LoadError, Loading } from "../AdminShell";
import AdminSales from "./AdminSales";

export const metadata = { title: "Sales · IKPM Admin" };

export default function SalesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AdminShell active="sales">
        {async ({ supabase, me }) => {
          // Admin can read every lead, activity, proposal and profile (see ikpm-new schema.sql + supabase/admin.sql).
          const [leads, activities, staff, proposals] = await Promise.all([
            supabase.from("leads").select(LEAD_COLUMNS).neq("stage", "new").order("updated_at", { ascending: false }),
            supabase.from("lead_activities").select(ACTIVITY_COLUMNS).order("created_at", { ascending: false }),
            // All staff: any of them (incl. admins) can be assigned to a meeting / inspection.
            supabase.from("profiles").select("id, full_name, email, role").order("full_name"),
            supabase.from("proposals").select(PROPOSAL_COLUMNS).order("created_at", { ascending: false }),
          ]);
          const error = leads.error ?? activities.error ?? staff.error ?? proposals.error;
          if (error) return <LoadError message={`${error.message} — did you run ikpm-admin/supabase/admin.sql in Supabase?`} />;
          return (
            <AdminSales
              leads={leads.data as Lead[]}
              activities={activities.data as Activity[]}
              staff={staff.data as Profile[]}
              meId={me.id}
              proposals={proposals.data as Proposal[]}
            />
          );
        }}
      </AdminShell>
    </Suspense>
  );
}
