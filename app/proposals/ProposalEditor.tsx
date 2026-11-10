"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FiPlus, FiPrinter, FiTrash2 } from "react-icons/fi";
import {
  ACTIVITY_LABELS,
  PROPOSAL_STATUS_META,
  proposalTotals,
  rupees,
  type Activity,
  type Lead,
  type Proposal,
  type ServicePlan,
} from "@/lib/types";
import {
  COMPANY,
  DEFAULT_CLOSING,
  DEFAULT_INTRO,
  DEFAULT_PAYMENT_TERMS,
  DEFAULT_SCOPE,
  DEFAULT_TITLE,
  defaultPlan,
  defaultTerms,
} from "@/lib/company";
import { createProposal, deleteProposal, saveProposal, setProposalStatus, type ProposalDraft } from "../actions";
import LocalDate from "./LocalDate";

interface Props {
  lead: Lead;
  reports: Activity[]; // meetings / inspections with a report, for reference
  proposal?: Proposal; // missing = new proposal
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function initialDraft(lead: Lead, p?: Proposal): ProposalDraft {
  const client = lead.company_name || lead.name;
  if (p)
    return {
      title: p.title ?? "",
      proposal_date: p.proposal_date,
      client_name: p.client_name ?? "",
      client_address: p.client_address ?? "",
      attention_name: p.attention_name ?? "",
      attention_designation: p.attention_designation ?? "",
      subject: p.subject ?? "",
      intro: p.intro ?? "",
      scope: p.scope ?? "",
      terms: p.terms ?? "",
      plans: p.plans ?? [],
      tenure_start: p.tenure_start,
      tenure_end: p.tenure_end,
      payment_terms: p.payment_terms ?? "",
      closing: p.closing ?? "",
      currency: p.currency,
    };
  const today = localToday();
  return {
    title: DEFAULT_TITLE,
    proposal_date: today,
    client_name: client,
    client_address: "",
    attention_name: lead.company_name ? lead.name : "",
    attention_designation: "",
    subject: "",
    intro: `Dear Sir,\n\n${DEFAULT_INTRO}`,
    scope: DEFAULT_SCOPE,
    terms: defaultTerms(client),
    plans: [defaultPlan()],
    tenure_start: `${today.slice(0, 7)}-01`,
    tenure_end: null,
    payment_terms: DEFAULT_PAYMENT_TERMS,
    closing: DEFAULT_CLOSING,
    currency: COMPANY.currency,
  };
}

export default function ProposalEditor({ lead, reports, proposal }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const editable = !proposal || proposal.status === "draft";
  const [draft, setDraft] = useState<ProposalDraft>(() => initialDraft(lead, proposal));
  // Status change being confirmed (notes are required for each one).
  const [statusAction, setStatusAction] = useState<"sent" | "accepted" | "rejected" | null>(null);
  const [statusNotes, setStatusNotes] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const openStatus = (s: "sent" | "accepted" | "rejected") => {
    setError(null);
    setStatusNotes("");
    setStatusAction((cur) => (cur === s ? null : s));
  };

  const set = <K extends keyof ProposalDraft>(k: K, v: ProposalDraft[K]) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [k]: v }));
  };

  function run(fn: () => Promise<{ error?: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.error) return setError(res.error);
      after?.();
      router.refresh();
    });
  }

  function save() {
    if (proposal) return run(() => saveProposal(proposal.id, draft), () => setSaved(true));
    setError(null);
    start(async () => {
      const res = await createProposal(lead.id, draft);
      if (res.error || !res.id) return setError(res.error ?? "Could not save");
      router.replace(`/proposals/${res.id}`);
    });
  }

  function confirmStatus() {
    if (!proposal || !statusAction) return;
    const action = statusAction;
    if (!statusNotes.trim()) return setError(action === "rejected" ? "Write why the client rejected it" : "Add notes");
    if (action === "rejected") {
      const when = new Date(followUpAt);
      if (!followUpAt || Number.isNaN(when.getTime())) return setError("Choose a follow-up date and time");
      return run(
        () => setProposalStatus(proposal.id, "rejected", statusNotes, when.toISOString()),
        () => setStatusAction(null)
      );
    }
    run(
      async () => {
        if (action === "sent") {
          // Save the latest edits first; after this it can no longer be edited.
          const r = await saveProposal(proposal.id, draft);
          if (r.error) return r;
        }
        return setProposalStatus(proposal.id, action, statusNotes);
      },
      () => setStatusAction(null)
    );
  }

  const STATUS_PANEL = {
    sent: {
      title: "Mark as sent — the proposal can no longer be edited after this.",
      label: "Notes *",
      placeholder: "How was it sent (email / WhatsApp / by hand), to whom…",
      button: "Mark as sent",
      tone: "border-sky-200 bg-sky-50/50 text-sky-800",
    },
    accepted: {
      title: "Client accepted the proposal.",
      label: "Notes *",
      placeholder: "Who confirmed, start date, anything agreed…",
      button: "Mark accepted",
      tone: "border-emerald-200 bg-emerald-50/50 text-emerald-800",
    },
    rejected: {
      title: `Client rejected — the lead goes back to Follow-up for ${lead.assigned_to_name || "the salesperson"}, tagged Rejected.`,
      label: "Reason *",
      placeholder: "Why did the client reject it? e.g. price too high, chose another company",
      button: "Mark rejected",
      tone: "border-rose-200 bg-rose-50/50 text-rose-800",
    },
  } as const;

  const totals = proposalTotals(draft);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {proposal ? proposal.code : "New proposal"}
            {proposal && (
              <span
                className={`ml-3 rounded-full px-2 py-0.5 align-middle text-xs font-medium ring-1 ring-inset ${PROPOSAL_STATUS_META[proposal.status].style}`}
              >
                {PROPOSAL_STATUS_META[proposal.status].label}
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500">
            {lead.company_name || lead.name} · {lead.code} · salesperson {lead.assigned_to_name || "—"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {proposal && (
            <button type="button" className="btn-secondary" onClick={() => window.print()}>
              <FiPrinter size={14} /> Print / PDF
            </button>
          )}
          {editable && (
            <button type="button" className="btn-secondary" onClick={save} disabled={pending}>
              {pending ? "Saving…" : proposal ? "Save draft" : "Create draft"}
            </button>
          )}
          {proposal?.status === "draft" && (
            <button type="button" className="btn-primary" onClick={() => openStatus("sent")} disabled={pending}>
              Mark as sent
            </button>
          )}
          {proposal?.status === "sent" && (
            <>
              <button type="button" className="btn-primary" disabled={pending} onClick={() => openStatus("accepted")}>
                Client accepted
              </button>
              <button
                type="button"
                className="btn-secondary text-rose-600"
                disabled={pending}
                onClick={() => openStatus("rejected")}
              >
                Client rejected
              </button>
            </>
          )}
        </div>
      </div>

      {statusAction &&
        proposal &&
        ((statusAction === "sent" && proposal.status === "draft") ||
          (statusAction !== "sent" && proposal.status === "sent")) && (
          <div className={`space-y-3 rounded-xl border p-4 print:hidden ${STATUS_PANEL[statusAction].tone}`}>
            <p className="text-sm font-medium">{STATUS_PANEL[statusAction].title}</p>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">{STATUS_PANEL[statusAction].label}</span>
              <textarea
                rows={2}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                value={statusNotes}
                onChange={(e) => setStatusNotes(e.target.value)}
                placeholder={STATUS_PANEL[statusAction].placeholder}
              />
            </label>
            {statusAction === "rejected" && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Follow-up date & time *</span>
                <input
                  type="datetime-local"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                  value={followUpAt}
                  onChange={(e) => setFollowUpAt(e.target.value)}
                />
              </label>
            )}
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" onClick={() => setStatusAction(null)} disabled={pending}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn-primary ${statusAction === "rejected" ? "bg-rose-600 hover:bg-rose-700" : ""}`}
                onClick={confirmStatus}
                disabled={pending}
              >
                {pending ? "Saving…" : STATUS_PANEL[statusAction].button}
              </button>
            </div>
          </div>
        )}

      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 print:hidden">{error}</p>}
      {saved && !error && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 print:hidden">Saved.</p>}

      <div className={`grid items-start gap-6 ${editable ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : ""} print:block`}>
        {editable && (
          <div className="space-y-4 print:hidden">
            {reports.length > 0 && (
              <Card title="Visit reports">
                <ul className="space-y-3">
                  {reports.map((r) => (
                    <li key={r.id} className="text-sm">
                      <p className="text-xs font-medium text-slate-500">
                        {ACTIVITY_LABELS[r.kind]} · {r.report_by_name} · <LocalDate iso={r.report_submitted_at!} />
                      </p>
                      <p className="whitespace-pre-wrap text-slate-700">{r.report}</p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Card title="Client & letter">
              <Field label="Proposal title">
                <input value={draft.title} onChange={(e) => set("title", e.target.value)} className="input" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Client name">
                  <input value={draft.client_name} onChange={(e) => set("client_name", e.target.value)} className="input" />
                </Field>
                <Field label="Date">
                  <input
                    type="date"
                    value={draft.proposal_date}
                    onChange={(e) => set("proposal_date", e.target.value)}
                    className="input"
                  />
                </Field>
              </div>
              <Field label="Client address">
                <input
                  value={draft.client_address}
                  onChange={(e) => set("client_address", e.target.value)}
                  placeholder="e.g. Bahria Town Tower, Tariq Road, Karachi"
                  className="input"
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Attention (name)">
                  <input
                    value={draft.attention_name}
                    onChange={(e) => set("attention_name", e.target.value)}
                    placeholder="Mr. Noman Aijaz"
                    className="input"
                  />
                </Field>
                <Field label="Designation">
                  <input
                    value={draft.attention_designation}
                    onChange={(e) => set("attention_designation", e.target.value)}
                    placeholder="Manager Procurement"
                    className="input"
                  />
                </Field>
              </div>
              <Field label="Subject / reference (optional)">
                <textarea
                  rows={2}
                  value={draft.subject}
                  onChange={(e) => set("subject", e.target.value)}
                  placeholder="e.g. Addendum No. 1 to the Contract … – Addition of new locations"
                  className="input"
                />
              </Field>
              <Field label="Opening letter">
                <textarea rows={8} value={draft.intro} onChange={(e) => set("intro", e.target.value)} className="input" />
              </Field>
            </Card>

            <Card title="Scope & terms">
              <Field label="Scope of services (one per line → A, B, C…)">
                <textarea rows={4} value={draft.scope} onChange={(e) => set("scope", e.target.value)} className="input" />
              </Field>
              <Field label="Terms & conditions (one per line → a), b), c)…)">
                <textarea rows={9} value={draft.terms} onChange={(e) => set("terms", e.target.value)} className="input" />
              </Field>
            </Card>

            <Card title="Service plans">
              {draft.plans.map((plan, i) => (
                <PlanEditor
                  key={i}
                  plan={plan}
                  onChange={(p) => set("plans", draft.plans.map((x, j) => (j === i ? p : x)))}
                  onRemove={() => set("plans", draft.plans.filter((_, j) => j !== i))}
                />
              ))}
              <button
                type="button"
                onClick={() => set("plans", [...draft.plans, defaultPlan()])}
                className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline"
              >
                <FiPlus size={14} /> Add plan (another city)
              </button>
            </Card>

            <Card title="Charges & payment">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Currency">
                  <input value={draft.currency} onChange={(e) => set("currency", e.target.value)} className="input" />
                </Field>
                <Field label="Tenure from">
                  <input
                    type="month"
                    value={draft.tenure_start?.slice(0, 7) ?? ""}
                    onChange={(e) => set("tenure_start", e.target.value ? `${e.target.value}-01` : null)}
                    className="input"
                  />
                </Field>
                <Field label="Tenure to">
                  <input
                    type="month"
                    value={draft.tenure_end?.slice(0, 7) ?? ""}
                    onChange={(e) => set("tenure_end", e.target.value ? `${e.target.value}-01` : null)}
                    className="input"
                  />
                </Field>
              </div>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                Monthly: <b>{draft.currency} {rupees(totals.monthly)}</b>
                {totals.months > 0 && (
                  <>
                    {" "}
                    × {totals.months} months = <b>{draft.currency} {rupees(totals.total)}</b>
                  </>
                )}
              </p>
              <Field label="Payment terms">
                <textarea
                  rows={2}
                  value={draft.payment_terms}
                  onChange={(e) => set("payment_terms", e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Closing">
                <textarea rows={3} value={draft.closing} onChange={(e) => set("closing", e.target.value)} className="input" />
              </Field>
              {proposal && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => confirm("Delete this draft?") && run(() => deleteProposal(proposal.id))}
                  className="text-xs font-medium text-rose-600 hover:underline"
                >
                  Delete draft
                </button>
              )}
            </Card>
          </div>
        )}

        <ProposalLetter draft={draft} code={proposal?.code} />
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

/** Edit one plan table: sites are columns, services are rows, one monthly rate per site. */
function PlanEditor({
  plan,
  onChange,
  onRemove,
}: {
  plan: ServicePlan;
  onChange: (p: ServicePlan) => void;
  onRemove: () => void;
}) {
  const edit = (fn: (p: ServicePlan) => void) => {
    const next = structuredClone(plan);
    fn(next);
    onChange(next);
  };
  const cell = "w-full min-w-0 rounded border border-slate-200 px-2 py-1 text-xs outline-none focus:border-emerald-600";

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <div className="flex gap-2">
        <input
          value={plan.title}
          onChange={(e) => edit((p) => void (p.title = e.target.value))}
          placeholder="Monthly IPM Service Plan (Lahore)"
          className="input"
        />
        <button
          type="button"
          onClick={onRemove}
          className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
          aria-label="Remove plan"
        >
          <FiTrash2 size={14} />
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th className="min-w-40 text-left font-medium text-slate-500">Service details</th>
              {plan.sites.map((s, i) => (
                <th key={i} className="min-w-28">
                  <div className="flex items-center gap-1">
                    <input
                      value={s}
                      onChange={(e) => edit((p) => void (p.sites[i] = e.target.value))}
                      placeholder="Site"
                      className={`${cell} font-semibold`}
                    />
                    {plan.sites.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          edit((p) => {
                            p.sites.splice(i, 1);
                            p.rates.splice(i, 1);
                            p.rows.forEach((r) => r.values.splice(i, 1));
                          })
                        }
                        className="text-slate-400 hover:text-rose-600"
                        aria-label="Remove site"
                      >
                        <FiTrash2 size={12} />
                      </button>
                    )}
                  </div>
                </th>
              ))}
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((r, ri) => (
              <tr key={ri}>
                <td>
                  <input
                    value={r.service}
                    onChange={(e) => edit((p) => void (p.rows[ri].service = e.target.value))}
                    className={cell}
                  />
                </td>
                {plan.sites.map((_, si) => (
                  <td key={si}>
                    <input
                      value={r.values[si] ?? ""}
                      onChange={(e) => edit((p) => void (p.rows[ri].values[si] = e.target.value))}
                      className={cell}
                    />
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    onClick={() => edit((p) => void p.rows.splice(ri, 1))}
                    className="text-slate-400 hover:text-rose-600"
                    aria-label="Remove row"
                  >
                    <FiTrash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td className="font-semibold text-slate-700">Rate per month (excl. tax)</td>
              {plan.sites.map((_, si) => (
                <td key={si}>
                  <input
                    type="number"
                    min={0}
                    value={plan.rates[si] ?? 0}
                    onChange={(e) => edit((p) => void (p.rates[si] = Number(e.target.value)))}
                    className={`${cell} font-semibold`}
                  />
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex gap-4">
        <button
          type="button"
          onClick={() => edit((p) => void p.rows.push({ service: "", values: p.sites.map(() => "") }))}
          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
        >
          <FiPlus size={12} /> Add service row
        </button>
        <button
          type="button"
          onClick={() =>
            edit((p) => {
              p.sites.push(`Site ${p.sites.length + 1}`);
              p.rates.push(0);
              // New site starts with the same frequencies as the first one.
              p.rows.forEach((r) => r.values.push(r.values[0] ?? ""));
            })
          }
          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
        >
          <FiPlus size={12} /> Add site column
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ Printed letter ------------------------------ */

const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "TH" : (["TH", "ST", "ND", "RD"][n % 10] ?? "TH")}`;

/** "2026-07-24" → "24TH JULY, 2026" */
function letterDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  const month = new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long" }).toUpperCase();
  return `${ordinal(d)} ${month}, ${y}`;
}

/** "2026-07-01" → "July 2026" */
const monthLabel = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
};

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

const BRAND = COMPANY.brand;

/** "2026-11-10" → "10-Nov-2026" */
function shortDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  const mon = new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short" });
  return `${String(d).padStart(2, "0")}-${mon}-${y}`;
}

/** Logo left, company contact right, thin brand-red rule. Repeats on every printed page. */
function Letterhead() {
  return (
    <div className="mb-6 flex items-center justify-between gap-6 border-b-2 pb-3" style={{ borderColor: BRAND }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- plain img prints reliably */}
      <img src={COMPANY.logo} alt={COMPANY.name} className="h-[72px] w-auto shrink-0 object-contain" />
      <div className="text-right text-[11px] leading-[1.55] text-slate-700">
        <p className="text-[15px] font-bold text-slate-900">{COMPANY.name}</p>
        <p className="text-[10.5px]" style={{ color: BRAND }}>
          {COMPANY.tagline}
        </p>
        <p>{COMPANY.email}</p>
        <p>{COMPANY.website}</p>
        <p>{COMPANY.phones.join("  |  ")}</p>
      </div>
    </div>
  );
}

/** Head Quarter left, service areas right. Repeats at the bottom of every printed page. */
function LetterFooter() {
  return (
    <div className="mt-8 flex items-start justify-between gap-6 border-t border-slate-300 pt-3 text-[10.5px] leading-[1.55] text-slate-600">
      <div>
        <p className="font-bold" style={{ color: BRAND }}>
          Head Quarter:
        </p>
        {COMPANY.headQuarter.map((l) => (
          <p key={l}>{l}</p>
        ))}
      </div>
      <div className="text-right">
        <p className="font-bold text-slate-900">{COMPANY.name}</p>
        <p className="font-bold" style={{ color: BRAND }}>
          Service Areas:
        </p>
        {COMPANY.serviceAreas.map((l) => (
          <p key={l} className="text-slate-700">
            {l}
          </p>
        ))}
      </div>
    </div>
  );
}

/** The client-facing proposal letter. This is what prints (letterhead + footer repeat on each page). */
function ProposalLetter({ draft: d, code }: { draft: ProposalDraft; code?: string }) {
  const totals = proposalTotals(d);
  const scope = lines(d.scope);
  const terms = lines(d.terms);
  const cur = d.currency || COMPANY.currency;
  const hasAttention = Boolean(d.attention_name || d.attention_designation);

  return (
    <article className="proposal-letter mx-auto w-full max-w-[210mm] rounded-xl border border-slate-200 bg-white px-10 py-8 text-[13px] leading-relaxed text-slate-900 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
      {/* A table's <thead> / <tfoot> repeat on every printed page. */}
      <table className="w-full">
        <thead>
          <tr>
            <td>
              <Letterhead />
            </td>
          </tr>
        </thead>
        <tfoot>
          <tr>
            <td>
              <LetterFooter />
            </td>
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td className="space-y-5 align-top">
              {/* Title + proposal number / date */}
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div className="min-w-0 flex-1">
                  <h1 className="inline-block border-b-[5px] pb-1 text-[28px] leading-none font-extrabold tracking-[0.12em] text-slate-900 uppercase" style={{ borderColor: BRAND }}>
                    Proposal
                  </h1>
                  {d.title && <p className="mt-2 text-[13px] font-semibold tracking-wide text-slate-600 uppercase">{d.title}</p>}
                </div>
                <dl className="w-60 shrink-0 space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[12px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Proposal No.</dt>
                    <dd className="font-bold text-slate-900">{code ?? "DRAFT"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Date</dt>
                    <dd className="font-bold text-slate-900">{shortDate(d.proposal_date)}</dd>
                  </div>
                </dl>
              </div>

              {/* Prepared for / Attention */}
              <div className={`grid gap-4 ${hasAttention ? "grid-cols-2" : "grid-cols-1"}`}>
                <div className="rounded-xl border border-slate-200 px-4 py-3">
                  <p className="mb-1 text-[10.5px] font-bold tracking-wider uppercase" style={{ color: BRAND }}>
                    Prepared for
                  </p>
                  <p className="font-bold text-slate-900">{d.client_name || "—"}</p>
                  {d.client_address && <p className="whitespace-pre-wrap text-[12px] text-slate-600">{d.client_address}</p>}
                </div>
                {hasAttention && (
                  <div className="rounded-xl border border-slate-200 px-4 py-3">
                    <p className="mb-1 text-[10.5px] font-bold tracking-wider uppercase" style={{ color: BRAND }}>
                      Attention
                    </p>
                    {d.attention_name && <p className="font-bold text-slate-900">{d.attention_name}</p>}
                    {d.attention_designation && <p className="text-[12px] text-slate-600">{d.attention_designation}</p>}
                  </div>
                )}
              </div>

              {d.subject && (
                <p className="font-semibold whitespace-pre-wrap">
                  <span style={{ color: BRAND }}>Subject: </span>
                  {d.subject}
                </p>
              )}

              {d.intro && (
                <div className="space-y-3">
                  {d.intro.split(/\n\s*\n/).map((para, i) => (
                    <p key={i} className="whitespace-pre-wrap">
                      {para.trim()}
                    </p>
                  ))}
                </div>
              )}

              {scope.length > 0 && (
                <div>
                  <SectionTitle>Scope of Services</SectionTitle>
                  <ol className="mt-1 space-y-0.5 pl-1">
                    {scope.map((s, i) => (
                      <li key={i}>
                        {String.fromCharCode(65 + i)}. {s}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {terms.length > 0 && (
                <div className="break-inside-avoid-page">
                  <SectionTitle>Terms &amp; Conditions</SectionTitle>
                  <ol className="mt-1 space-y-0.5 pl-1">
                    {terms.map((t, i) => (
                      <li key={i} className="flex gap-1.5">
                        <span className="shrink-0">{String.fromCharCode(97 + i)})</span>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {d.plans.map((plan, i) => (
                <PlanTable key={i} plan={plan} />
              ))}

              <div className="break-inside-avoid-page space-y-2">
              <SectionTitle>Charges &amp; Payment</SectionTitle>
              <p>
                <b>Services Charges and Tenure:</b>{" "}
                {totals.months > 0 && d.tenure_start && d.tenure_end ? (
                  <>
                    The total contract value shall be{" "}
                    <b>
                      {cur} {rupees(totals.total)}
                    </b>{" "}
                    for the period from {monthLabel(d.tenure_start)} to {monthLabel(d.tenure_end)}, extendable upon mutual
                    agreement of both parties.
                  </>
                ) : (
                  <>
                    The total monthly service charges shall be{" "}
                    <b>
                      {cur} {rupees(totals.monthly)}
                    </b>
                    {d.tenure_start ? ` starting from ${monthLabel(d.tenure_start)}` : ""}.
                  </>
                )}
              </p>
              <p>
                <b>Services &amp; Service Fees:</b> The above mentioned Pest Control Services at your place are quoted excluding
                all services sales tax; tax will be applicable.
              </p>
              {d.payment_terms && (
                <p className="whitespace-pre-wrap">
                  <b>Payment Terms:</b> {d.payment_terms}
                </p>
              )}
              </div>
              {d.closing && <p className="whitespace-pre-wrap">{d.closing}</p>}

              <div className="flex break-inside-avoid-page flex-wrap items-end justify-between gap-8 pt-4">
                <div>
                  <p className="font-bold" style={{ color: BRAND }}>
                    Regards,
                  </p>
                  <div className="h-14" />
                  <p className="font-bold">{COMPANY.signatory.name}</p>
                  <p>{COMPANY.signatory.title}</p>
                  <p>{COMPANY.name}</p>
                </div>
                <div className="w-64 space-y-3">
                  <p className="text-[10.5px] font-bold tracking-wider uppercase" style={{ color: BRAND }}>
                    Accepted by client
                  </p>
                  {["Name", "Designation", "Signature"].map((k) => (
                    <p key={k} className="flex gap-2">
                      <span className="w-24 font-semibold">{k}:</span>
                      <span className="flex-1 border-b border-slate-500" />
                    </p>
                  ))}
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}

/** Brand-red uppercase heading with a short rule, used for each letter section. */
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1.5 flex items-center gap-2 text-[12px] font-bold tracking-wider uppercase" style={{ color: BRAND }}>
      <span className="inline-block h-3 w-1 rounded-sm" style={{ background: BRAND }} />
      {children}
    </p>
  );
}

function PlanTable({ plan }: { plan: ServicePlan }) {
  const rows = plan.rows.filter((r) => r.service.trim());
  return (
    <div className="break-inside-avoid-page">
      {plan.title && <SectionTitle>{plan.title}</SectionTitle>}
      <table className="w-full border-collapse overflow-hidden text-[12px]">
        <thead>
          <tr className="text-white" style={{ background: "#1f1f1f" }}>
            <th className="border border-slate-300 px-2.5 py-1.5 text-left font-semibold">Service Details</th>
            {plan.sites.map((s, i) => (
              <th key={i} className="border border-slate-300 px-2.5 py-1.5 text-center font-semibold">
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={i % 2 ? "bg-slate-50" : ""}>
              <td className="border border-slate-300 px-2.5 py-1.5">{r.service}</td>
              {plan.sites.map((_, si) => (
                <td key={si} className="border border-slate-300 px-2.5 py-1.5 text-center">
                  {r.values[si]}
                </td>
              ))}
            </tr>
          ))}
          <tr className="font-bold text-white" style={{ background: BRAND }}>
            <td className="border border-slate-300 px-2.5 py-1.5">Rates Per Month (Exclusive of Tax)</td>
            {plan.sites.map((_, si) => (
              <td key={si} className="border border-slate-300 px-2.5 py-1.5 text-center">
                {rupees(plan.rates[si] ?? 0)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
