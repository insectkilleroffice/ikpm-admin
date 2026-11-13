import { Suspense } from "react";
import {
  VISIT_COLUMNS,
  type LeadOption,
  type OpsClient,
  type OpsManager,
  type OpsComplaint,
  type OpsSite,
  type OpsStaff,
  type OpsVisit,
} from "@/lib/ops";
import AdminShell, { LoadError, Loading } from "../AdminShell";
import OpsAdmin from "./OpsAdmin";

export const metadata = { title: "Operations · IKPM Admin" };

export default function OperationsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AdminShell active="operations">
        {async ({ supabase }) => {
          const ops = supabase.schema("ops");
          const [staff, clients, sites, complaints, visits, leads, managers] = await Promise.all([
            ops.from("staff").select("id, full_name, phone, active").order("full_name"),
            ops.from("clients").select("id, name, code, lead_id").order("name"),
            ops.from("sites").select("id, client_id, name, city, address, visits_per_month, pco_id, manager_id, status").order("name"),
            ops
              .from("complaints")
              .select("id, code, site_id, description, severity, lodged_by_name, lodged_at, status, decision, decision_note, decided_by_name, decided_at")
              .order("lodged_at", { ascending: false })
              .limit(200),
            // What admin sent to operations: requests, meetings and inspections.
            ops.from("visits").select(VISIT_COLUMNS).eq("source", "admin").order("visit_date", { ascending: false }).limit(200),
            // Sales leads, only to link a new client or a meeting to the lead it came from.
            supabase.from("leads").select("id, code, name, company_name").neq("stage", "new").order("updated_at", { ascending: false }),
            // Operations managers: staff logins with the operations role.
            supabase.from("profiles").select("id, full_name, email").eq("role", "operations").order("full_name"),
          ]);
          const error = staff.error ?? clients.error ?? sites.error ?? complaints.error ?? visits.error ?? leads.error ?? managers.error;
          if (error)
            return (
              <LoadError
                message={`${error.message} — did you run ikpm-admin/supabase/ops.sql and add "ops" to Exposed schemas (Supabase → Settings → API)?`}
              />
            );
          const leadOptions: LeadOption[] = (leads.data ?? []).map((l) => ({
            id: l.id,
            code: l.code,
            label: `${l.code} · ${l.company_name || l.name}`,
          }));
          return (
            <OpsAdmin
              staff={staff.data as OpsStaff[]}
              clients={clients.data as OpsClient[]}
              sites={sites.data as OpsSite[]}
              complaints={complaints.data as OpsComplaint[]}
              visits={visits.data as OpsVisit[]}
              leads={leadOptions}
              managers={managers.data as OpsManager[]}
            />
          );
        }}
      </AdminShell>
    </Suspense>
  );
}
