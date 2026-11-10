"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FiFileText, FiPlus, FiX } from "react-icons/fi";
import {
  ACTIVITY_LABELS,
  PROPOSAL_STATUS_META,
  TASK_KINDS,
  VISIT_KINDS,
  money,
  type Activity,
  type Lead,
  type LeadStage,
  type Profile,
  type Proposal,
} from "@/lib/types";
import { TASK_STATUS_META, currentStepByLead, taskStatus } from "@/lib/tasks";
import { formatDateTime } from "@/lib/format";
import { submitReport } from "../actions";
import AttendeePicker from "./AttendeePicker";
import ScheduleForm from "./ScheduleForm";

const STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  follow_up: "Follow-up",
  call: "Meeting · On call",
  meeting: "Meeting · In person",
  inspection: "Inspection",
  proposal: "Proposal",
  closed: "Closed",
};

interface Props {
  lead: Lead;
  history: Activity[]; // newest first
  proposals: Proposal[]; // this lead's, newest first
  staff: Profile[];
  meId: string;
  onClose: () => void;
}

export default function LeadSheet({ lead: l, history, proposals, staff, meId, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const current = currentStepByLead(history).get(l.id);
  const currentVisit = current && VISIT_KINDS.includes(current.kind) && l.stage === current.kind ? current : null;

  const details: [string, string][] = [
    ["Lead ID", l.code],
    ["Type", l.type],
    ["Phone", l.phone],
    ["Email", l.email || "—"],
    ["Source", l.source],
    ["Added by", l.added_by_name],
    ["Salesperson", l.assigned_to_name || "—"],
    ["Stage", STAGE_LABELS[l.stage]],
    ["Next step", l.next_action_at ? formatDateTime(l.next_action_at) : "—"],
  ];

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-slate-900/40" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={l.name}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-slate-900">{l.company_name || l.name}</h2>
            {l.company_name && <p className="text-sm text-slate-500">{l.name}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <FiX size={18} />
          </button>
        </header>

        <div className="space-y-6 p-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {details.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="break-words text-slate-900">{v}</dd>
              </div>
            ))}
          </dl>

          {currentVisit && <VisitCard key={currentVisit.id} activity={currentVisit} staff={staff} meId={meId} />}

          {(l.stage === "proposal" || proposals.length > 0) && (
            <section className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">Proposals</h3>
                {l.stage === "proposal" && (
                  <Link href={`/proposals/new?lead=${l.id}`} className="btn-primary px-2.5 py-1 text-xs">
                    <FiPlus size={12} /> Create proposal
                  </Link>
                )}
              </div>
              {proposals.length === 0 ? (
                <p className="text-sm text-amber-700">Salesperson moved this lead to Proposal. No proposal written yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {proposals.map((p) => (
                    <li key={p.id}>
                      <Link href={`/proposals/${p.id}`} className="flex items-center gap-2 py-2 text-sm hover:text-emerald-700">
                        <FiFileText size={14} className="text-slate-400" />
                        <span className="font-medium">{p.code}</span>
                        <span className="text-slate-500">{money(p.total, p.currency)}</span>
                        <span
                          className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${PROPOSAL_STATUS_META[p.status].style}`}
                        >
                          {PROPOSAL_STATUS_META[p.status].label}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {l.stage !== "closed" && (
            <details className="rounded-xl border border-slate-200 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">Move to another step</summary>
              <div className="mt-3">
                <ScheduleForm key={l.id} lead={l} />
              </div>
            </details>
          )}

          <History lead={l} history={history} proposal={proposals[0]} />
        </div>
      </aside>
    </div>
  );
}

/** Current meeting / inspection: who attends and their report. */
function VisitCard({ activity: a, staff, meId }: { activity: Activity; staff: Profile[]; meId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [writing, setWriting] = useState(false);
  const [report, setReport] = useState("");
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    start(async () => {
      const res = await submitReport(a.id, report);
      if (res.error) return setError(res.error);
      setWriting(false);
      router.refresh();
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">{ACTIVITY_LABELS[a.kind]}</h3>
        <p className="text-xs text-slate-500">
          {a.scheduled_at ? formatDateTime(a.scheduled_at) : "No time set"} · scheduled by {a.created_by_name}
        </p>
        {a.notes && <p className="mt-1 text-sm whitespace-pre-wrap text-slate-600">{a.notes}</p>}
      </div>

      {a.report_submitted_at ? (
        <>
        <AssignmentDetails activity={a} />
        <div className="rounded-lg bg-white p-3 ring-1 ring-emerald-200">
          <p className="text-xs font-medium text-emerald-700">
            Report by {a.report_by_name} · {formatDateTime(a.report_submitted_at)}
          </p>
          <p className="mt-1 text-sm whitespace-pre-wrap text-slate-700">{a.report}</p>
          <p className="mt-2 text-xs text-slate-500">The salesperson can now move this lead on (e.g. to Proposal).</p>
        </div>
        </>
      ) : (
        <>
          <div>
            <AttendeePicker key={a.attendee_assigned_at ?? "none"} activity={a} staff={staff} meId={meId} />
            {a.attendee_name && (
              <p className="mt-1 text-xs text-slate-500">
                {a.attendee_name} · assigned by {a.attendee_assigned_by_name} · waiting for the report
              </p>
            )}
          </div>
          {writing ? (
            <div className="space-y-2">
              <textarea
                rows={4}
                value={report}
                onChange={(e) => setReport(e.target.value)}
                placeholder="What happened, findings, what the client needs…"
                className="input"
              />
              {error && <p className="text-xs text-rose-600">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={save} disabled={pending} className="btn-primary">
                  {pending ? "Saving…" : "Submit report"}
                </button>
                <button type="button" onClick={() => setWriting(false)} className="btn-secondary">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setWriting(true)} className="text-xs font-medium text-emerald-700 hover:underline">
              Add the report on their behalf
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** Who attends, where, and the admin's notes for them. */
function AssignmentDetails({ activity: a }: { activity: Activity }) {
  if (!a.attendee_name) return null;
  return (
    <div className="mt-1 space-y-0.5 rounded-md bg-violet-50 px-2.5 py-1.5 text-xs text-slate-700">
      <p>
        {a.attendee_ids?.length > 1 ? "Attendees" : "Attendee"}: <span className="font-medium">{a.attendee_name}</span>
        {a.attendee_assigned_by_name && ` (assigned by ${a.attendee_assigned_by_name})`}
      </p>
      {a.visit_address && (
        <p className="whitespace-pre-wrap">
          <span className="font-medium">Address:</span> {a.visit_address}
        </p>
      )}
      {a.attendee_notes && (
        <p className="whitespace-pre-wrap">
          <span className="font-medium">Notes:</span> {a.attendee_notes}
        </p>
      )}
    </div>
  );
}

function History({ lead, history, proposal }: { lead: Lead; history: Activity[]; proposal?: Proposal }) {
  const current = currentStepByLead(history).get(lead.id);
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-slate-800">
        History <span className="font-normal text-slate-400">{history.length}</span>
      </h3>
      {history.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing logged yet.</p>
      ) : (
        <ol className="relative space-y-4 border-l border-slate-200 pl-4">
          {history.map((a) => {
            const s = TASK_KINDS.includes(a.kind) ? taskStatus(a, lead, current, proposal) : null;
            return (
              <li key={a.id} className="relative">
                <span className="absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-600" />
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-slate-900">{ACTIVITY_LABELS[a.kind]}</p>
                  {s && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TASK_STATUS_META[s].style}`}>
                      {TASK_STATUS_META[s].label}
                    </span>
                  )}
                </div>
                {a.scheduled_at && <p className="text-xs text-slate-600">For {formatDateTime(a.scheduled_at)}</p>}
                {a.notes && <p className="mt-1 text-sm whitespace-pre-wrap text-slate-600">{a.notes}</p>}
                <AssignmentDetails activity={a} />
                {a.report && (
                  <div className="mt-1 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700">
                    <p className="text-[11px] font-medium text-slate-500">
                      Report · {a.report_by_name} · {formatDateTime(a.report_submitted_at!)}
                    </p>
                    <p className="whitespace-pre-wrap">{a.report}</p>
                  </div>
                )}
                <p className="mt-1 text-[11px] text-slate-400">
                  By {a.created_by_name} · {formatDateTime(a.created_at)}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
