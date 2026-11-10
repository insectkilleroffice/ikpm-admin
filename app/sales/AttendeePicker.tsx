"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Activity, Profile } from "@/lib/types";
import { assignAttendee } from "../actions";

const ROLE_GROUPS: { role: Profile["role"]; label: string }[] = [
  { role: "admin", label: "Admin" },
  { role: "sales", label: "Sales" },
  { role: "operations", label: "Operations" },
  { role: "finance", label: "Finance" },
];

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Choose (or change) who attends a meeting / inspection: one or more staff of
 * any role, including the signed-in admin. Address (not needed for a meeting
 * on call) and notes are required.
 */
export default function AttendeePicker({ activity, staff, meId }: { activity: Activity; staff: Profile[]; meId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const initial = activity.attendee_ids ?? [];
  const [selected, setSelected] = useState<string[]>(initial);
  const [address, setAddress] = useState(activity.visit_address ?? "");
  const [notes, setNotes] = useState(activity.attendee_notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const needsAddress = activity.kind !== "call";
  const changed =
    !sameSet(selected, initial) ||
    address.trim() !== (activity.visit_address ?? "") ||
    notes.trim() !== (activity.attendee_notes ?? "");

  const toggle = (id: string) => {
    setSaved(false);
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  // "Me" first, then everyone else grouped by role.
  const me = staff.find((p) => p.id === meId);
  const others = staff.filter((p) => p.id !== meId);

  function save() {
    setError(null);
    setSaved(false);
    if (selected.length === 0) return setError("Choose at least one person");
    if (needsAddress && !address.trim()) return setError("Add the address");
    if (!notes.trim()) return setError("Add notes for the attendees");
    start(async () => {
      const res = await assignAttendee({ activityId: activity.id, attendeeIds: selected, notes, address, needsAddress });
      if (res.error) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  }

  const field =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";

  const person = (p: Profile, you = false) => {
    const on = selected.includes(p.id);
    return (
      <label
        key={p.id}
        className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
          on ? "bg-emerald-50 text-emerald-900" : "text-slate-700 hover:bg-slate-50"
        }`}
      >
        <input
          type="checkbox"
          checked={on}
          onChange={() => toggle(p.id)}
          className="h-4 w-4 rounded border-slate-300 accent-emerald-700"
        />
        <span className="truncate">{p.full_name}</span>
        {you && <span className="ml-auto shrink-0 text-[11px] font-medium text-emerald-700">(you)</span>}
      </label>
    );
  };

  return (
    <div className="space-y-2">
      <div>
        <span className="mb-1 flex items-center justify-between text-xs font-medium text-slate-600">
          <span>
            Who attends <span className="text-rose-500">*</span>
          </span>
          {selected.length > 0 && <span className="font-normal text-slate-500">{selected.length} selected</span>}
        </span>
        <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5">
          {me && person(me, true)}
          {ROLE_GROUPS.map(({ role, label }) => {
            const people = others.filter((p) => p.role === role);
            if (people.length === 0) return null;
            return (
              <div key={role}>
                <p className="px-2 pt-1 text-[10.5px] font-semibold tracking-wider text-slate-400 uppercase">{label}</p>
                {people.map((p) => person(p))}
              </div>
            );
          })}
        </div>
      </div>

      {needsAddress && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Address <span className="text-rose-500">*</span>
          </span>
          <textarea
            rows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Site / office address, landmark, floor…"
            className={field}
          />
        </label>
      )}

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">
          Notes for the attendees <span className="text-rose-500">*</span>
        </span>
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Who to meet, contact on site, what to check, pest type…"
          className={field}
        />
      </label>

      {error && <p className="text-xs text-rose-600">{error}</p>}
      {saved && !error && !changed && <p className="text-xs text-emerald-700">Saved.</p>}

      {changed && (
        <button type="button" onClick={save} disabled={pending} className="btn-primary w-full">
          {pending
            ? "Saving…"
            : initial.length
              ? "Update assignment"
              : `Assign ${selected.length > 1 ? `${selected.length} people` : ""}`.trim()}
        </button>
      )}
    </div>
  );
}
