"use client";

import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  COMPLAINT_STATUS_META,
  DECISION_LABEL,
  KIND_LABEL,
  SLOTS,
  TREATMENTS,
  VISIT_STATUS_META,
  type ComplaintDecision,
  type LeadOption,
  type OpsClient,
  type OpsComplaint,
  type OpsManager,
  type OpsSite,
  type OpsStaff,
  type OpsVisit,
} from "@/lib/ops";
import {
  addStaff,
  assignMeeting,
  decideComplaint,
  newContract,
  setSiteManager,
  setStaffActive,
  type ContractSite,
} from "./actions";

type Data = {
  staff: OpsStaff[];
  clients: OpsClient[];
  sites: OpsSite[];
  complaints: OpsComplaint[];
  visits: OpsVisit[];
  leads: LeadOption[];
  managers: OpsManager[];
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

function TimeSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input" aria-label={label}>
      {SLOTS.map((t) => (
        <option key={t}>{t}</option>
      ))}
    </select>
  );
}

function ManagerSelect({
  managers,
  value,
  onChange,
  label,
}: {
  managers: OpsManager[];
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input" aria-label={label}>
      <option value="">Pick a manager…</option>
      {managers.map((m) => (
        <option key={m.id} value={m.id}>
          {m.full_name}
        </option>
      ))}
    </select>
  );
}

/** PCOs from the field team who join the operations manager. */
function CrewPicker({ staff, value, onChange }: { staff: OpsStaff[]; value: string[]; onChange: (v: string[]) => void }) {
  const active = staff.filter((s) => s.active);
  if (!active.length) return <p className="text-xs text-slate-400">No PCOs yet. Add them under Field team.</p>;
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

/** One or more treatments: chips you can remove, plus a box to add one (from the list or typed). */
function TreatmentPicker({ value, onChange, label }: { value: string[]; onChange: (v: string[]) => void; label: string }) {
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim();
    if (t && !value.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...value, t]);
    setText("");
  };
  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
              {t}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="text-emerald-600 hover:text-emerald-900" aria-label={`Remove ${t}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <input
          list="ops-treatments"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={value.length ? "Add another treatment" : "Add a treatment"}
          className="input"
          aria-label={label}
        />
        <button type="button" onClick={add} disabled={!text.trim()} className="btn-secondary px-3">
          Add
        </button>
      </div>
    </div>
  );
}

/* ---------- page ---------- */
export default function OpsAdmin(data: Data) {
  const siteById = useMemo(() => new Map(data.sites.map((s) => [s.id, s])), [data.sites]);
  const clientById = useMemo(() => new Map(data.clients.map((c) => [c.id, c])), [data.clients]);
  const staffById = useMemo(() => new Map(data.staff.map((s) => [s.id, s])), [data.staff]);
  const managerById = useMemo(() => new Map(data.managers.map((m) => [m.id, m])), [data.managers]);
  const place = (siteId: string | null) => {
    const s = siteId ? siteById.get(siteId) : null;
    return s ? `${s.name}, ${clientById.get(s.client_id)?.name ?? ""}` : "—";
  };
  const managerOf = (v: OpsVisit) => {
    const id = v.site_id ? siteById.get(v.site_id)?.manager_id : v.manager_id;
    return (id && managerById.get(id)?.full_name) || "—";
  };
  const waiting = data.complaints.filter((c) => c.status === "open");
  const decided = data.complaints.filter((c) => c.status !== "open");

  return (
    <div className="space-y-6">
      <datalist id="ops-treatments">
        {TREATMENTS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <div>
        <h1 className="text-xl font-semibold text-slate-900">Operations</h1>
        <p className="text-sm text-slate-500">
          Send contracts, meetings and inspections to your operations managers, and decide on complaints. Revisits come only from a complaint.
        </p>
      </div>

      {!data.managers.length && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          No operations managers yet. Each one needs a login (Supabase → Authentication → Users) and a row in <code>public.profiles</code> with
          role <code>operations</code>. See the top of <code>supabase/ops.sql</code>.
        </p>
      )}

      <Card
        title={`Complaints waiting for you (${waiting.length})`}
        sub="Pick what happens: a revisit (the site's manager picks the PCO), an inspection or meeting (straight on their calendar), or close it."
      >
        {waiting.length ? (
          <div className="space-y-4">
            {waiting.map((c) => {
              const m = siteById.get(c.site_id)?.manager_id;
              return (
                <ComplaintCard
                  key={c.id}
                  complaint={c}
                  place={place(c.site_id)}
                  manager={(m && managerById.get(m)?.full_name) || ""}
                  staff={data.staff}
                />
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-slate-400">No complaints are waiting.</p>
        )}
      </Card>

      <Card
        title="Send a new contract"
        sub="Like a proposal: one client with one or more sites. Each site goes to its operations manager with its service visits. The visits are red on that manager's calendar until they pick the PCO."
      >
        <NewContractForm clients={data.clients} staff={data.staff} leads={data.leads} managers={data.managers} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Assign a meeting or inspection" sub="Goes straight onto the manager's calendar. They attend and write the report.">
          <MeetingForm sites={data.sites} place={place} staff={data.staff} leads={data.leads} managers={data.managers} />
        </Card>
        <Card title="Sites and their managers" sub="Change who runs a site. All its visits move with it.">
          <SitesPanel sites={data.sites} place={place} managers={data.managers} />
        </Card>
      </div>

      <Card title="Sent to operations" sub="Revisits, new contracts, meetings and inspections you sent, newest day first.">
        {data.visits.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Day</th>
                  <th className="py-2 pr-3 font-medium">What</th>
                  <th className="py-2 pr-3 font-medium">Where</th>
                  <th className="py-2 pr-3 font-medium">Manager</th>
                  <th className="py-2 pr-3 font-medium">PCO</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.visits.map((v) => {
                  const team = [v.pco_id, ...v.crew_ids].filter(Boolean).map((id) => staffById.get(id!)?.full_name ?? "");
                  const complaint = v.complaint_id ? data.complaints.find((c) => c.id === v.complaint_id) : null;
                  return (
                    <tr key={v.id} className="border-t border-slate-100 align-top text-slate-700">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {fmtDay(v.visit_date)} · {v.visit_time}
                      </td>
                      <td className="py-2 pr-3">
                        {KIND_LABEL[v.kind]}
                        {v.job_code && <div className="text-xs text-slate-400">{v.job_code}</div>}
                        {v.treatments.length > 0 && <div className="text-xs text-slate-500">{v.treatments.join(", ")}</div>}
                        {complaint && <div className="text-xs text-slate-400">From {complaint.code}</div>}
                      </td>
                      <td className="py-2 pr-3">{v.site_id ? place(v.site_id) : `${v.prospect_name} · not a client yet`}</td>
                      <td className="py-2 pr-3">{managerOf(v)}</td>
                      <td className="py-2 pr-3">{team.join(", ") || "—"}</td>
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
        <Card title="Field team" sub="The PCOs operations managers can send. They do not sign in.">
          <StaffPanel staff={data.staff} />
        </Card>
      </div>
    </div>
  );
}

/* ---------- complaint decision ---------- */
function ComplaintCard({
  complaint: c,
  place,
  manager,
  staff,
}: {
  complaint: OpsComplaint;
  place: string;
  manager: string;
  staff: OpsStaff[];
}) {
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
      closing ? "Complaint closed." : `${DECISION_LABEL[decision]} sent to ${manager || "the site's manager"}.`,
    );
  }

  const severity =
    c.severity === "High"
      ? "bg-rose-50 text-rose-700 ring-rose-200"
      : c.severity === "Medium"
        ? "bg-amber-50 text-amber-700 ring-amber-200"
        : "bg-slate-100 text-slate-600 ring-slate-200";

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
            {manager ? ` · Manager: ${manager}` : " · No manager for this site"}
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
            <Field label="PCOs who join the manager (optional)">
              <CrewPicker staff={staff} value={crew} onChange={setCrew} />
            </Field>
            <Field label="Client people (optional)">
              <input value={guests} onChange={(e) => setGuests(e.target.value)} placeholder="Names, separated by commas" className="input" />
            </Field>
          </>
        )}
        <Field label={closing ? "Why is it closed?" : "Note for the manager (optional)"} required={closing}>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={closing ? "For example: client confirmed the problem is gone" : "Leave empty to send the complaint text"}
            className="input"
          />
        </Field>
        {decision === "revisit" && (
          <p className="text-xs text-slate-500">The revisit is red on the manager&apos;s calendar until they pick the PCO. It adds one visit to the site&apos;s total.</p>
        )}
        <Message error={a.error} ok={a.ok} />
        <button type="submit" disabled={a.pending} className="btn-primary">
          {a.pending ? "Saving…" : closing ? "Close complaint" : `Send ${DECISION_LABEL[decision].toLowerCase()}`}
        </button>
      </div>
    </form>
  );
}

/* ---------- new contract (one or more sites) ---------- */
type VisitDraft = { key: number; date: string; time: string; treatments: string[] };
type SiteDraft = {
  key: number;
  name: string;
  city: string;
  address: string;
  perMonth: number;
  managerId: string;
  pcoId: string;
  first: string;
  time: string;
  allTreatments: string[];
  visits: VisitDraft[];
};
let draftKey = 0;

/**
 * n service days from the first visit to the end of that month, spread evenly,
 * Sundays moved to Monday (same spreading as the operations monthly schedule).
 */
function spreadDays(first: string, n: number): string[] {
  if (!first || n < 1) return [];
  const [y, m, d] = first.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const span = last - d + 1;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let day = d + Math.floor((i * span) / n);
    if (new Date(y, m - 1, day).getDay() === 0) day = day + 1 <= last ? day + 1 : day - 1;
    const iso = `${y}-${pad(m)}-${pad(day)}`;
    if (!out.includes(iso)) out.push(iso);
  }
  return out;
}

function planVisits(first: string, n: number, time: string, old: VisitDraft[] = []): VisitDraft[] {
  return spreadDays(first, n).map((date, i) => ({ key: ++draftKey, date, time, treatments: old[i]?.treatments ?? [] }));
}

function newSite(managerId = ""): SiteDraft {
  const first = inDays(3);
  return { key: ++draftKey, name: "", city: "", address: "", perMonth: 2, managerId, pcoId: "", first, time: "10:00", allTreatments: [], visits: planVisits(first, 2, "10:00") };
}

function NewContractForm({
  clients,
  staff,
  leads,
  managers,
}: {
  clients: OpsClient[];
  staff: OpsStaff[];
  leads: LeadOption[];
  managers: OpsManager[];
}) {
  const linked = new Set(clients.map((c) => c.lead_id).filter(Boolean));
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [leadId, setLeadId] = useState("");
  const [sites, setSites] = useState<SiteDraft[]>(() => [newSite(managers.length === 1 ? managers[0].id : "")]);
  const [note, setNote] = useState("");
  const a = useAction();

  const setSite = (key: number, patch: Partial<SiteDraft>) => setSites((ss) => ss.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const setVisit = (siteKey: number, visitKey: number, patch: Partial<VisitDraft>) =>
    setSites((ss) => ss.map((s) => (s.key === siteKey ? { ...s, visits: s.visits.map((v) => (v.key === visitKey ? { ...v, ...patch } : v)) } : s)));
  const totalVisits = sites.reduce((n, s) => n + s.visits.length, 0);

  function submit(e: FormEvent) {
    e.preventDefault();
    const payload: ContractSite[] = sites.map((s) => ({
      name: s.name,
      city: s.city,
      address: s.address,
      visitsPerMonth: s.perMonth,
      managerId: s.managerId,
      pcoId: s.pcoId,
      visits: [...s.visits].sort((x, y) => x.date.localeCompare(y.date)).map(({ date, time, treatments }) => ({ date, time, treatments })),
    }));
    a.run(
      () => newContract({ clientId, clientName, leadId, sites: payload, note }),
      `Contract sent: ${sites.length} site${sites.length === 1 ? "" : "s"}, ${totalVisits} visit${totalVisits === 1 ? "" : "s"}. They are red on each manager's calendar until a PCO is picked.`,
      () => {
        setClientId("");
        setClientName("");
        setLeadId("");
        setNote("");
        setSites([newSite(sites[0]?.managerId ?? "")]);
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
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
          <>
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
          </>
        )}
      </div>

      {sites.map((s, si) => (
        <div key={s.key} className="space-y-3 rounded-lg border border-slate-200 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-800">
              Site {si + 1}
              {s.name.trim() ? ` · ${s.name.trim()}` : ""}
            </p>
            {sites.length > 1 && (
              <button type="button" onClick={() => setSites((ss) => ss.filter((x) => x.key !== s.key))} className="btn-secondary px-2.5 py-1 text-xs">
                Remove site
              </button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Site name" required>
              <input value={s.name} onChange={(e) => setSite(s.key, { name: e.target.value })} placeholder="For example: Clifton outlet" className="input" />
            </Field>
            <Field label="City">
              <input value={s.city} onChange={(e) => setSite(s.key, { city: e.target.value })} className="input" />
            </Field>
            <Field label="Address">
              <input value={s.address} onChange={(e) => setSite(s.key, { address: e.target.value })} className="input" />
            </Field>
            <Field label="Operations manager" required>
              <ManagerSelect managers={managers} value={s.managerId} onChange={(v) => setSite(s.key, { managerId: v })} />
            </Field>
            <Field label="Visits a month" required>
              <input
                type="number"
                min={1}
                max={8}
                value={s.perMonth}
                onChange={(e) => setSite(s.key, { perMonth: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })}
                className="input"
              />
            </Field>
            <Field label="Usual PCO (optional)">
              <select value={s.pcoId} onChange={(e) => setSite(s.key, { pcoId: e.target.value })} className="input">
                <option value="">Manager decides</option>
                {staff
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
              </select>
            </Field>
          </div>

          <div className="space-y-3 rounded-lg bg-slate-50 p-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">Service visits</p>
              <p className="text-xs text-slate-500">Like a monthly schedule: each visit has a day, a time and one or more treatments.</p>
            </div>
            <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <Field label="First visit day">
                <input type="date" min={inDays(0)} value={s.first} onChange={(e) => setSite(s.key, { first: e.target.value })} className="input" />
              </Field>
              <Field label="Time">
                <TimeSelect value={s.time} onChange={(v) => setSite(s.key, { time: v })} />
              </Field>
              <button type="button" onClick={() => setSite(s.key, { visits: planVisits(s.first, s.perMonth, s.time, s.visits) })} className="btn-secondary">
                Plan {s.perMonth} visit{s.perMonth === 1 ? "" : "s"}
              </button>
            </div>
            <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto]">
              <Field label="Same treatments for every visit (optional)">
                <TreatmentPicker value={s.allTreatments} onChange={(v) => setSite(s.key, { allTreatments: v })} label="Treatments for every visit" />
              </Field>
              <button
                type="button"
                disabled={!s.allTreatments.length}
                onClick={() => setSite(s.key, { visits: s.visits.map((v) => ({ ...v, treatments: [...s.allTreatments] })) })}
                className="btn-secondary"
              >
                Use for all visits
              </button>
            </div>

            {s.visits.length ? (
              <ol className="space-y-2">
                {s.visits.map((v, i) => (
                  <li key={v.key} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-2 sm:grid-cols-[1.5rem_9.5rem_6.5rem_1fr_auto] sm:items-start">
                    <span className="pt-2 text-xs font-medium text-slate-400">{i + 1}</span>
                    <input
                      type="date"
                      min={inDays(0)}
                      value={v.date}
                      onChange={(e) => setVisit(s.key, v.key, { date: e.target.value })}
                      className="input"
                      aria-label={`Day of visit ${i + 1}`}
                    />
                    <TimeSelect value={v.time} onChange={(t) => setVisit(s.key, v.key, { time: t })} label={`Time of visit ${i + 1}`} />
                    <TreatmentPicker value={v.treatments} onChange={(t) => setVisit(s.key, v.key, { treatments: t })} label={`Treatments for visit ${i + 1}`} />
                    <button
                      type="button"
                      onClick={() => setSite(s.key, { visits: s.visits.filter((x) => x.key !== v.key) })}
                      className="btn-secondary px-2.5 py-1 text-xs"
                      aria-label={`Remove visit ${i + 1}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-slate-400">No visits yet. Press Plan or Add a visit.</p>
            )}
            <button
              type="button"
              onClick={() => {
                const last = s.visits[s.visits.length - 1];
                const d = new Date(`${last?.date || s.first}T00:00:00`);
                d.setDate(d.getDate() + 7);
                setSite(s.key, { visits: [...s.visits, { key: ++draftKey, date: ymd(d), time: s.time, treatments: [...(last?.treatments ?? s.allTreatments)] }] });
              }}
              className="btn-secondary"
            >
              + Add a visit
            </button>
          </div>
        </div>
      ))}

      <button type="button" onClick={() => setSites((ss) => [...ss, newSite(ss[ss.length - 1]?.managerId ?? "")])} className="btn-secondary">
        + Add another site
      </button>

      <Field label="Note for the managers (optional)">
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: meet the store in-charge at the gate" className="input" />
      </Field>
      <Message error={a.error} ok={a.ok} />
      <button type="submit" disabled={a.pending || !totalVisits} className="btn-primary">
        {a.pending
          ? "Sending…"
          : `Send contract · ${sites.length} site${sites.length === 1 ? "" : "s"} · ${totalVisits} visit${totalVisits === 1 ? "" : "s"}`}
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
  managers,
}: {
  sites: OpsSite[];
  place: (id: string) => string;
  staff: OpsStaff[];
  leads: LeadOption[];
  managers: OpsManager[];
}) {
  const [kind, setKind] = useState<"meeting" | "inspection">("meeting");
  const [siteId, setSiteId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [prospect, setProspect] = useState("");
  const [managerId, setManagerId] = useState(() => (managers.length === 1 ? managers[0].id : ""));
  const [date, setDate] = useState(() => inDays(2));
  const [time, setTime] = useState("10:00");
  const [crew, setCrew] = useState<string[]>([]);
  const [guests, setGuests] = useState("");
  const [note, setNote] = useState("");
  const a = useAction();
  const siteManager = siteId ? managers.find((m) => m.id === sites.find((s) => s.id === siteId)?.manager_id) : null;

  function pickLead(id: string) {
    setLeadId(id);
    const l = leads.find((x) => x.id === id);
    if (l) setProspect(l.label.replace(`${l.code} · `, ""));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    a.run(
      () =>
        assignMeeting({
          kind,
          siteId,
          prospectName: siteId ? "" : prospect,
          leadId: siteId ? "" : leadId,
          managerId,
          date,
          time,
          crewIds: crew,
          guests,
          note,
        }),
      `${kind === "meeting" ? "Meeting" : "Inspection"} is on the manager's calendar.`,
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
      {siteId ? (
        <p className="text-xs text-slate-500">
          Goes to the site&apos;s manager: <b>{siteManager?.full_name ?? "no manager yet — set one under Sites"}</b>
        </p>
      ) : (
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
          <Field label="Operations manager" required>
            <ManagerSelect managers={managers} value={managerId} onChange={setManagerId} />
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
      <Field label="PCOs who join the manager (optional)">
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

/* ---------- sites and managers ---------- */
function SitesPanel({ sites, place, managers }: { sites: OpsSite[]; place: (id: string) => string; managers: OpsManager[] }) {
  const a = useAction();
  if (!sites.length) return <p className="text-sm text-slate-400">No sites yet. They are added with a new contract.</p>;
  return (
    <div className="space-y-2">
      <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto text-sm">
        {sites.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-slate-800">{place(s.id)}</span>
              {s.status === "pending" && <span className="text-xs text-amber-700">Waiting for its first PCO</span>}
            </span>
            <span className="w-44 shrink-0">
              <ManagerSelect
                managers={managers}
                value={s.manager_id ?? ""}
                label={`Operations manager for ${place(s.id)}`}
                onChange={(v) => v && a.run(() => setSiteManager(s.id, v), `${place(s.id)} moved to ${managers.find((m) => m.id === v)?.full_name}.`)}
              />
            </span>
          </li>
        ))}
      </ul>
      <Message error={a.error} ok={a.ok} />
    </div>
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
        <p className="text-sm text-slate-400">No PCOs yet.</p>
      )}
      <form onSubmit={submit} noValidate className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="PCO full name" className="input" aria-label="PCO full name" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className="input" aria-label="Phone" />
        <button type="submit" disabled={a.pending} className="btn-primary">
          Add PCO
        </button>
      </form>
      <Message error={a.error} ok={a.ok} />
    </div>
  );
}
