"use client";

import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  COMPLAINT_STATUS_META,
  DECISION_LABEL,
  KIND_LABEL,
  SLOTS,
  VISIT_STATUS_META,
  type ComplaintDecision,
  type LeadOption,
  type OpsClient,
  type OpsComplaint,
  type OpsSite,
  type OpsStaff,
  type OpsVisit,
} from "@/lib/ops";
import { addStaff, assignMeeting, decideComplaint, newContract, setStaffActive } from "./actions";

type Data = {
  staff: OpsStaff[];
  clients: OpsClient[];
  sites: OpsSite[];
  complaints: OpsComplaint[];
  visits: OpsVisit[];
  leads: LeadOption[];
};

/* ---------- small helpers ---------- */
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const fmtDay = (s: string) =>
  new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

function Pill({ label, style }: { label: string; style: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style}`}>{label}</span>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        {sub && <p className="text-xs text-slate-500">{sub}</p>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Message({ error, ok }: { error: string | null; ok: string | null }) {
  if (error) return <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>;
  if (ok) return <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{ok}</p>;
  return null;
}

/** Runs a server action, shows its error or a success message, then refreshes the page data. */
function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  function run(fn: () => Promise<{ error?: string }>, success: string, after?: () => void) {
    setError(null);
    setOk(null);
    start(async () => {
      const res = await fn();
      if (res.error) return setError(res.error);
      setOk(success);
      after?.();
      router.refresh();
    });
  }
  return { pending, error, ok, run, setError };
}

function TimeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input">
      {SLOTS.map((t) => (
        <option key={t}>{t}</option>
      ))}
    </select>
  );
}

/** People from the field team who join the operations manager. */
function CrewPicker({ staff, value, onChange }: { staff: OpsStaff[]; value: string[]; onChange: (v: string[]) => void }) {
  const active = staff.filter((s) => s.active);
  if (!active.length) return <p className="text-xs text-slate-400">No field team yet. Add people under Field team.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {active.map((s) => {
        const on = value.includes(s.id);
        return (
          <label
            key={s.id}
            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm ${
              on ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600"
            }`}
          >
            <input
              type="checkbox"
              checked={on}
              onChange={(e) => onChange(e.target.checked ? [...value, s.id] : value.filter((x) => x !== s.id))}
              className="accent-emerald-700"
            />
            {s.full_name}
          </label>
        );
      })}
    </div>
  );
}

/* ---------- page ---------- */
export default function OpsAdmin(data: Data) {
  const siteById = useMemo(() => new Map(data.sites.map((s) => [s.id, s])), [data.sites]);
  const clientById = useMemo(() => new Map(data.clients.map((c) => [c.id, c])), [data.clients]);
  const staffById = useMemo(() => new Map(data.staff.map((s) => [s.id, s])), [data.staff]);
  const place = (siteId: string | null) => {
    const s = siteId ? siteById.get(siteId) : null;
    return s ? `${s.name}, ${clientById.get(s.client_id)?.name ?? ""}` : "—";
  };
  const waiting = data.complaints.filter((c) => c.status === "open");
  const decided = data.complaints.filter((c) => c.status !== "open");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Operations</h1>
        <p className="text-sm text-slate-500">
          Decide on complaints and send work to the operations manager. Revisits come only from a complaint.
        </p>
      </div>

      <Card
        title={`Complaints waiting for you (${waiting.length})`}
        sub="Pick what happens: a revisit (operations picks the PCO), an inspection or meeting (straight on the calendar), or close it."
      >
        {waiting.length ? (
          <div className="space-y-4">
            {waiting.map((c) => (
              <ComplaintCard key={c.id} complaint={c} place={place(c.site_id)} staff={data.staff} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">No complaints are waiting.</p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Send a new contract" sub="Adds the site and its first visit. It is red on the operations calendar until a PCO is picked.">
          <NewContractForm clients={data.clients} staff={data.staff} leads={data.leads} />
        </Card>
        <Card title="Assign a meeting or inspection" sub="Goes straight onto the calendar. The operations manager attends and writes the report.">
          <MeetingForm sites={data.sites} place={place} staff={data.staff} leads={data.leads} />
        </Card>
      </div>

      <Card title="Sent to operations" sub="Revisits, new contracts, meetings and inspections you sent, newest day first.">
        {data.visits.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Day</th>
                  <th className="py-2 pr-3 font-medium">What</th>
                  <th className="py-2 pr-3 font-medium">Where</th>
                  <th className="py-2 pr-3 font-medium">Team</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.visits.map((v) => {
                  const team = [v.supervisor_id, ...v.crew_ids].filter(Boolean).map((id) => staffById.get(id!)?.full_name ?? "");
                  const complaint = v.complaint_id ? data.complaints.find((c) => c.id === v.complaint_id) : null;
                  return (
                    <tr key={v.id} className="border-t border-slate-100 align-top text-slate-700">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {fmtDay(v.visit_date)} · {v.visit_time}
                      </td>
                      <td className="py-2 pr-3">
                        {KIND_LABEL[v.kind]}
                        {v.job_code && <div className="text-xs text-slate-400">{v.job_code}</div>}
                        {complaint && <div className="text-xs text-slate-400">From {complaint.code}</div>}
                      </td>
                      <td className="py-2 pr-3">{v.site_id ? place(v.site_id) : `${v.prospect_name} · not a client yet`}</td>
                      <td className="py-2 pr-3">
                        {v.kind === "meeting" || v.kind === "inspection"
                          ? ["Ops manager", ...team].join(", ")
                          : team.join(", ") || "—"}
                      </td>
                      <td className="py-2">
                        <Pill {...VISIT_STATUS_META[v.status]} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Nothing sent yet.</p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Decided complaints">
          {decided.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {decided.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 py-2">
                  <div>
                    <p className="font-medium text-slate-800">
                      {c.code} · {place(c.site_id)}
                    </p>
                    <p className="text-slate-600">{c.description}</p>
                    <p className="text-xs text-slate-400">
                      {c.decision ? DECISION_LABEL[c.decision] : ""} by {c.decided_by_name}
                      {c.decided_at ? ` on ${fmtDay(c.decided_at)}` : ""}
                      {c.decision_note ? ` · ${c.decision_note}` : ""}
                    </p>
                  </div>
                  <Pill {...COMPLAINT_STATUS_META[c.status]} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">Nothing decided yet.</p>
          )}
        </Card>
        <Card title="Field team" sub="Supervisors and PCOs the operations manager can send. They do not sign in.">
          <StaffPanel staff={data.staff} />
        </Card>
      </div>
    </div>
  );
}

/* ---------- complaint decision ---------- */
function ComplaintCard({ complaint: c, place, staff }: { complaint: OpsComplaint; place: string; staff: OpsStaff[] }) {
  const [decision, setDecision] = useState<ComplaintDecision>("revisit");
  const [date, setDate] = useState(() => inDays(1));
  const [time, setTime] = useState("10:00");
  const [note, setNote] = useState("");
  const [crew, setCrew] = useState<string[]>([]);
  const [guests, setGuests] = useState("");
  const a = useAction();
  const closing = decision === "closed";
  const visitLike = decision === "inspection" || decision === "meeting";

  function submit(e: FormEvent) {
    e.preventDefault();
    a.run(
      () => decideComplaint({ complaintId: c.id, decision, date, time, note, crewIds: visitLike ? crew : [], guests: visitLike ? guests : "" }),
      closing ? "Complaint closed." : `${DECISION_LABEL[decision]} sent to operations.`,
    );
  }

  const severity = c.severity === "High" ? "bg-rose-50 text-rose-700 ring-rose-200" : c.severity === "Medium" ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-slate-100 text-slate-600 ring-slate-200";

  return (
    <form onSubmit={submit} noValidate className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-slate-900">
            {c.code} · {place}
          </p>
          <p className="text-sm text-slate-700">{c.description}</p>
          <p className="text-xs text-slate-400">
            Lodged by {c.lodged_by_name} on {fmtDay(c.lodged_at)}
          </p>
        </div>
        <Pill label={`${c.severity} priority`} style={severity} />
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["revisit", "inspection", "meeting", "closed"] as ComplaintDecision[]).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDecision(d)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${
              decision === d ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {d === "closed" ? "Close" : DECISION_LABEL[d]}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {!closing && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Day" required>
              <input type="date" min={inDays(0)} value={date} onChange={(e) => setDate(e.target.value)} className="input" />
            </Field>
            <Field label="Time" required>
              <TimeSelect value={time} onChange={setTime} />
            </Field>
          </div>
        )}
        {visitLike && (
          <>
            <Field label="Who joins the operations manager (optional)">
              <CrewPicker staff={staff} value={crew} onChange={setCrew} />
            </Field>
            <Field label="Client people (optional)">
              <input value={guests} onChange={(e) => setGuests(e.target.value)} placeholder="Names, separated by commas" className="input" />
            </Field>
          </>
        )}
        <Field label={closing ? "Why is it closed?" : "Note for operations (optional)"} required={closing}>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={closing ? "For example: client confirmed the problem is gone" : "Leave empty to send the complaint text"}
            className="input"
          />
        </Field>
        {decision === "revisit" && (
          <p className="text-xs text-slate-500">The revisit is red on the operations calendar until they pick the PCO. It adds one visit to the site&apos;s total.</p>
        )}
        <Message error={a.error} ok={a.ok} />
        <button type="submit" disabled={a.pending} className="btn-primary">
          {a.pending ? "Saving…" : closing ? "Close complaint" : `Send ${DECISION_LABEL[decision].toLowerCase()}`}
        </button>
      </div>
    </form>
  );
}

/* ---------- new contract ---------- */
function NewContractForm({ clients, staff, leads }: { clients: OpsClient[]; staff: OpsStaff[]; leads: LeadOption[] }) {
  const linked = new Set(clients.map((c) => c.lead_id).filter(Boolean));
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [leadId, setLeadId] = useState("");
  const [siteName, setSiteName] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [perMonth, setPerMonth] = useState(2);
  const [supervisorId, setSupervisorId] = useState("");
  const [date, setDate] = useState(() => inDays(3));
  const [time, setTime] = useState("10:00");
  const [note, setNote] = useState("");
  const a = useAction();

  function submit(e: FormEvent) {
    e.preventDefault();
    a.run(
      () =>
        newContract({ clientId, clientName, leadId, siteName, city, address, visitsPerMonth: perMonth, supervisorId, date, time, note }),
      "Contract sent. Operations will pick the PCO for the first visit.",
      () => {
        setClientName("");
        setLeadId("");
        setSiteName("");
        setCity("");
        setAddress("");
        setNote("");
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <Field label="Client" required>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="input">
          <option value="">New client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      {!clientId && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client name" required>
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="input" />
          </Field>
          <Field label="Won lead (optional)">
            <select value={leadId} onChange={(e) => setLeadId(e.target.value)} className="input">
              <option value="">Not linked</option>
              {leads
                .filter((l) => !linked.has(l.id))
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
            </select>
          </Field>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Site name" required>
          <input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="For example: Clifton outlet" className="input" />
        </Field>
        <Field label="City">
          <input value={city} onChange={(e) => setCity(e.target.value)} className="input" />
        </Field>
      </div>
      <Field label="Address">
        <input value={address} onChange={(e) => setAddress(e.target.value)} className="input" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Visits a month" required>
          <input type="number" min={1} max={8} value={perMonth} onChange={(e) => setPerMonth(Number(e.target.value))} className="input" />
        </Field>
        <Field label="Usual supervisor (optional)">
          <select value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)} className="input">
            <option value="">Operations decides</option>
            {staff
              .filter((s) => s.active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First visit day" required>
          <input type="date" min={inDays(0)} value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </Field>
        <Field label="Time" required>
          <TimeSelect value={time} onChange={setTime} />
        </Field>
      </div>
      <Field label="Note for operations (optional)">
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="input" />
      </Field>
      <Message error={a.error} ok={a.ok} />
      <button type="submit" disabled={a.pending} className="btn-primary">
        {a.pending ? "Sending…" : "Send new contract"}
      </button>
    </form>
  );
}

/* ---------- meeting / inspection ---------- */
function MeetingForm({
  sites,
  place,
  staff,
  leads,
}: {
  sites: OpsSite[];
  place: (id: string) => string;
  staff: OpsStaff[];
  leads: LeadOption[];
}) {
  const [kind, setKind] = useState<"meeting" | "inspection">("meeting");
  const [siteId, setSiteId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [prospect, setProspect] = useState("");
  const [date, setDate] = useState(() => inDays(2));
  const [time, setTime] = useState("10:00");
  const [crew, setCrew] = useState<string[]>([]);
  const [guests, setGuests] = useState("");
  const [note, setNote] = useState("");
  const a = useAction();

  function pickLead(id: string) {
    setLeadId(id);
    const l = leads.find((x) => x.id === id);
    if (l) setProspect(l.label.replace(`${l.code} · `, ""));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    a.run(
      () => assignMeeting({ kind, siteId, prospectName: siteId ? "" : prospect, leadId: siteId ? "" : leadId, date, time, crewIds: crew, guests, note }),
      `${kind === "meeting" ? "Meeting" : "Inspection"} is on the operations calendar.`,
      () => {
        setNote("");
        setGuests("");
        setCrew([]);
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {(["meeting", "inspection"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${
              kind === k ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {k === "meeting" ? "Meeting" : "Inspection"}
          </button>
        ))}
      </div>
      <Field label="For" required>
        <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="input">
          <option value="">A lead (not a client yet)</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {place(s.id)}
            </option>
          ))}
        </select>
      </Field>
      {!siteId && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Lead from sales (optional)">
            <select value={leadId} onChange={(e) => pickLead(e.target.value)} className="input">
              <option value="">Not in sales</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Name of the lead" required>
            <input value={prospect} onChange={(e) => setProspect(e.target.value)} placeholder="Business name" className="input" />
          </Field>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Day" required>
          <input type="date" min={inDays(0)} value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </Field>
        <Field label="Time" required>
          <TimeSelect value={time} onChange={setTime} />
        </Field>
      </div>
      <Field label="Who joins the operations manager (optional)">
        <CrewPicker staff={staff} value={crew} onChange={setCrew} />
      </Field>
      <Field label="Client people (optional)">
        <input value={guests} onChange={(e) => setGuests(e.target.value)} placeholder="Names, separated by commas" className="input" />
      </Field>
      <Field label="What is it about?">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: first meeting about two outlets" className="input" />
      </Field>
      <Message error={a.error} ok={a.ok} />
      <button type="submit" disabled={a.pending} className="btn-primary">
        {a.pending ? "Saving…" : `Assign ${kind}`}
      </button>
    </form>
  );
}

/* ---------- field team ---------- */
function StaffPanel({ staff }: { staff: OpsStaff[] }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const a = useAction();

  function submit(e: FormEvent) {
    e.preventDefault();
    a.run(() => addStaff(name, phone), `${name.trim()} added to the field team.`, () => {
      setName("");
      setPhone("");
    });
  }

  return (
    <div className="space-y-4">
      {staff.length ? (
        <ul className="divide-y divide-slate-100 text-sm">
          {staff.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
              <span className={s.active ? "text-slate-800" : "text-slate-400 line-through"}>
                {s.full_name}
                {s.phone && <span className="ml-2 text-xs text-slate-400">{s.phone}</span>}
              </span>
              <button
                type="button"
                disabled={a.pending}
                onClick={() => a.run(() => setStaffActive(s.id, !s.active), s.active ? `${s.full_name} removed from new work.` : `${s.full_name} is back.`)}
                className="btn-secondary px-2.5 py-1 text-xs"
              >
                {s.active ? "Stop sending" : "Bring back"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">No one yet.</p>
      )}
      <form onSubmit={submit} noValidate className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="input" aria-label="Full name" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className="input" aria-label="Phone" />
        <button type="submit" disabled={a.pending} className="btn-primary">
          Add
        </button>
      </form>
      <Message error={a.error} ok={a.ok} />
    </div>
  );
}
