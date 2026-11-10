"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ACTIVITY_LABELS, SCHEDULABLE_KINDS, type Lead, type SchedulableKind } from "@/lib/types";
import { toLocalInput } from "@/lib/format";
import { scheduleStep } from "../actions";

const LABELS: Record<SchedulableKind, string> = {
  ...(ACTIVITY_LABELS as Record<SchedulableKind, string>),
  proposal: "Proposal",
};

/** Admin moves a lead to its next step (any stage). Added to the lead's history. */
export default function ScheduleForm({ lead }: { lead: Lead }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<SchedulableKind>("meeting");
  const [at, setAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return toLocalInput(d);
  });
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const isProposal = kind === "proposal";

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    if (!isProposal && !at) return setError("Choose a date and time");
    if (!notes.trim()) return setError("Add notes");

    startTransition(async () => {
      const res = await scheduleStep({
        leadId: lead.id,
        kind,
        // Convert in the browser so the admin's local time is kept.
        scheduledAt: at ? new Date(at).toISOString() : null,
        notes,
      });
      if (res.error) return setError(res.error);
      setNotes("");
      setOk(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {SCHEDULABLE_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-lg border px-3 py-2 text-left text-sm font-medium ${
              kind === k ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {LABELS[k]}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">
          {isProposal ? "Proposal follow-up date (optional)" : "Date & time"}
        </span>
        <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="input" />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">
          Notes <span className="text-rose-500">*</span>
        </span>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What was discussed, why this step, what to do next…"
          className="input"
        />
      </label>

      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
      {ok && <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">Saved and added to history.</p>}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "Saving…" : `Move to ${LABELS[kind]}`}
      </button>
    </form>
  );
}
