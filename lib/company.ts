import type { ServicePlan } from "./types";

/** Letterhead, footer and signatory printed on every proposal. Edit here to change them. */
export const COMPANY = {
  name: "Insect Killer Pest Management",
  tagline: "Integrated Pest Management & Fumigation Services",
  logo: "/logo.png", // public/logo.png
  /** Brand red from the logo. */
  brand: "#c8102e",
  email: "info@insectkiller.pk",
  website: "www.insectkiller.pk",
  phones: ["+92 304 2316127", "+92 345 2794074"],
  /** Head Quarter address, one line per row in the footer. */
  headQuarter: ["Suite 407, 4th Floor Dr. Inn Plaza, Block", "3 Nazimabad, 74600, Karachi, Pakistan"],
  /** Service areas, one line per row in the footer. */
  serviceAreas: ["Karachi | Lahore | Islamabad | Rawalpindi", "Multan | Bahawalpur | Faisalabad & nearby cities"],
  signatory: { name: "M. SALMAN MALICK", title: "Chief Executive Officer" },
  currency: "PKR",
};

/* ---- Default wording for a new proposal (all editable per proposal) ---- */

export const DEFAULT_TITLE = "GENERAL FUMIGATION & RODENT CONTROL SERVICE";

export const DEFAULT_INTRO = [
  `We, at ${COMPANY.name}, use biological, genetic and cultural management in rendering our Pest Management Services, with a focus on eliminating the use of harmful pesticides. Our aim is to ensure a safe and pest-free environment to our clients, along with supervision by our trained Pest Control Operators.`,
  "As per our representative's detailed meeting and visit at your site, please find below our proposal for Pest Control Services implementation at your site for your kind consideration. We recommend using the latest pest control devices (Bait Boxes, Transparent Glue Boxes & Mechanical Traps as per the latest EPA & Safety Standards) in this area.",
].join("\n\n");

export const DEFAULT_SCOPE = [
  "Implementation of IPM (Integrated Pest Management)",
  "Management of all pests either crawling or flying.",
  "Management of Rodents.",
].join("\n");

export function defaultTerms(client: string) {
  const ik = COMPANY.name.toUpperCase();
  return [
    `${ik} will design & implement pest management plan as per Audits Standards.`,
    `Food grade chemicals will be used by ${ik}.`,
    `All Audits related reporting required will be met by ${ik}.`,
    `Any structural condition pointed as an entry or hiding & breeding place for pests must be alerted by ${client}.`,
    `All MSDS required will be provided by ${ik}.`,
    `All SOPs, Trend Analysis Reports & IPM layout will be provided by ${ik}.`,
    `Any mechanical device if installed at ${client}, will be the property of ${client}. ${client} will bear the cost of devices.`,
    "Termite & Birds service is not a part of this contract.",
  ].join("\n");
}

export const DEFAULT_PAYMENT_TERMS = `Payment for the Service Charges is to be made within 15 days from the date of invoice in favor of "${COMPANY.name.toUpperCase()}".`;

export const DEFAULT_CLOSING =
  "Thank you very much for your time and interest, if you have anything to inquire please feel free to do so. We hope over the time you will experience the benefits of being served by PROFESSIONALS.";

const DEFAULT_ROWS: [string, string][] = [
  ["Fumigation (Cold Fogging) / Spray (ULV)", "Once per week"],
  ["Rodent Traps Monitoring / Cleaning", "Once per week"],
  ["Rodent Glue change", "Once per week"],
  ["Lizard night activity", "Twice per Month"],
  ["Cockroach control - Gelling treatment", "Once per week"],
  ["EFK cleaning / monitoring", "Twice per Month"],
  ["Supervisor Visit", "Once a Month"],
  ["PCO", "01"],
  ["Documentation", "Yes"],
];

export function defaultPlan(site = "Site 1", city = ""): ServicePlan {
  return {
    title: city ? `Monthly IPM Service Plan (${city})` : "Monthly IPM Service Plan",
    sites: [site],
    rows: DEFAULT_ROWS.map(([service, value]) => ({ service, values: [value] })),
    rates: [0],
  };
}
