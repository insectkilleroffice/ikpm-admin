import { Suspense } from "react";
import AdminShell, { LoadError, Loading } from "../../AdminShell";
import ProposalEditor from "../ProposalEditor";
import { loadLeadForProposal } from "../load";

export const metadata = { title: "New proposal · IKPM Admin" };

export default function NewProposalPage({ searchParams }: PageProps<"/proposals/new">) {
  return (
    <Suspense fallback={<Loading />}>
      <AdminShell active="proposals">
        {async ({ supabase }) => {
          const { lead: leadId } = await searchParams;
          if (typeof leadId !== "string") return <LoadError message="No lead chosen." />;
          const { lead, reports, error } = await loadLeadForProposal(supabase, leadId);
          if (error) return <LoadError message={error} />;
          if (!lead) return <LoadError message="Lead not found." />;
          return <ProposalEditor lead={lead} reports={reports} />;
        }}
      </AdminShell>
    </Suspense>
  );
}
