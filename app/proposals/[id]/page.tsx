import { Suspense } from "react";
import { PROPOSAL_COLUMNS, type Proposal } from "@/lib/types";
import AdminShell, { LoadError, Loading } from "../../AdminShell";
import ProposalEditor from "../ProposalEditor";
import { loadLeadForProposal } from "../load";

export const metadata = { title: "Proposal · IKPM Admin" };

export default function ProposalPage({ params }: PageProps<"/proposals/[id]">) {
  return (
    <Suspense fallback={<Loading />}>
      <AdminShell active="proposals">
        {async ({ supabase }) => {
          const { id } = await params;
          const { data: proposal, error } = await supabase
            .from("proposals")
            .select(PROPOSAL_COLUMNS)
            .eq("id", id)
            .maybeSingle<Proposal>();
          if (error) return <LoadError message={error.message} />;
          if (!proposal) return <LoadError message="Proposal not found." />;

          const ctx = await loadLeadForProposal(supabase, proposal.lead_id);
          if (ctx.error) return <LoadError message={ctx.error} />;
          if (!ctx.lead) return <LoadError message="Lead not found." />;
          // key: reset the form when the status changes (e.g. after marking sent).
          return <ProposalEditor key={proposal.status} lead={ctx.lead} reports={ctx.reports} proposal={proposal} />;
        }}
      </AdminShell>
    </Suspense>
  );
}
