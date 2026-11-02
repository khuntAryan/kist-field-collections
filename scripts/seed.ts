/**
 * Resets the database and fills it with realistic sample data.
 *
 *   npm run db:seed
 *
 * 1. Simulates 150 days of the lender's overdue book (new overdue loans every day, officer
 *    visits and calls, promises kept and broken, payments, roll-overs) using the hidden
 *    behaviour model in scripts/sim/ground-truth.ts. This gives the roll-rate trend and the
 *    weekly back-test real history to work with.
 * 2. Builds today's overdue CSV from the simulated book and loads it through the same import
 *    pipeline the branch manager uses (validation, scoring, assignment).
 * 3. Plays today's field activity up to the current time through the same sync service the
 *    phones use.
 *
 * The brief's three sample loans (LN-10293, LN-10871, LN-11930) are scripted exactly.
 * Dates are anchored to the day you run the seed (override with SEED_DATE=YYYY-MM-DD), so the
 * demo always looks like "today". On 2 Nov 2026 the dates match the brief.
 */
import "./env";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, schema } from "../src/server/db";
import { hashPassword } from "../src/server/auth/password";
import { commitImport } from "../src/server/services/import";
import { applySync } from "../src/server/services/sync";
import { scoreLoan, compareForList } from "../src/lib/scoring/score";
import { daysToNextBucket, type ScoreInput } from "../src/lib/scoring/features";
import { assignLoans } from "../src/lib/assignment";
import { addDays, daysBetween, istDate, istDateTime, istParts, weekStart, type ISODate } from "../src/lib/time";
import { renderTemplate } from "../src/lib/templates";
import { computeRollRate } from "../src/lib/roll-rate";
import { createRng } from "./sim/rng";
import { samplePaidRatio, sampleOutstanding, trueRollLogit } from "./sim/ground-truth";
import { AREAS, BRANCHES, HEAD, MANAGERS, OFFICERS, PINCODES, SURNAMES, TEMPLATES, TRADES, companyCode, email } from "./sim/world";

const TODAY: ISODate = process.env.SEED_DATE ?? istDate(new Date());
const DAYS = 150;
const START = addDays(TODAY, -DAYS);
const rng = createRng(1102);

type SimPromise = { id: string; madeAt: Date; date: ISODate; amount: number; status: "open" | "kept" | "broken" | "superseded"; willKeep: boolean; officerId: string; outcomeId: string; resolvedOn?: ISODate };
type SimOutcome = { id: string; type: "paid" | "promise" | "not_reachable" | "dispute"; channel: "visit" | "call"; at: Date; day: ISODate; reason: string | null; amount: number | null; promisedDate: ISODate | null; officerId: string; lat: number | null; lng: number | null; accuracy: number | null; gps: string; offline: boolean; syncedAt: Date };
type SimLoan = {
  id: string; borrowerId: string; name: string; trade: string; contact: string; phone: string; address: string; pincode: string;
  lat: number; lng: number; language: "hi" | "en"; branchId: string; outstanding: number; emi: number; dpd: number; quality: number;
  paidRatio6m: number | null; lastPaymentDate: ISODate | null; disbursedOn: ISODate; status: "overdue" | "cured" | "closed"; officerId: string | null;
  promises: SimPromise[]; outcomes: SimOutcome[]; scripted: boolean; disputed: boolean;
  /** Day the borrower will pay, when a kept promise has fixed it. */
  scheduledCure: ISODate | null;
};

const officerIds = new Map(OFFICERS.map((o) => [o.key, randomUUID()]));
const officerById = new Map(OFFICERS.map((o) => [officerIds.get(o.key)!, o]));
const loans: SimLoan[] = [];
const snapshots: { loanId: string; asOfDate: ISODate; dpd: number; outstanding: number; branchId: string; officerId: string | null }[] = [];
const scoreRows: (typeof schema.scoreSnapshots.$inferInsert)[] = [];
const attempts: (typeof schema.contactAttempts.$inferInsert)[] = [];
const messages: (typeof schema.messages.$inferInsert)[] = [];
let nextLoanNo = 10050;
let nextCompany = 0;

const weekday = (d: ISODate) => new Date(`${d}T00:00:00Z`).getUTCDay();
const overdueAmount = (l: { emi: number; dpd: number }) => l.emi * Math.max(1, Math.ceil(l.dpd / 30));
const jitter = (v: number, spread: number) => v + (rng.next() - 0.5) * 2 * spread;

function newLoan(branchId: string, day: ISODate, override: Partial<SimLoan> = {}): SimLoan {
  const b = BRANCHES.find((x) => x.id === branchId)!;
  const quality = rng.normal() + b.qualityShift;
  const outstanding = sampleOutstanding(rng);
  let id = `LN-${nextLoanNo++}`;
  while (["LN-10293", "LN-10871", "LN-11930"].includes(id)) id = `LN-${nextLoanNo++}`;
  const area = rng.pick(AREAS[branchId]);
  const pincode = rng.pick(PINCODES[branchId]);
  const loan: SimLoan = {
    id,
    borrowerId: randomUUID(),
    name: `Company ${companyCode(nextCompany++)}`,
    trade: rng.pick(TRADES),
    contact: `${"ABDGHKLMNPRSV"[rng.int(0, 12)]}. ${rng.pick(SURNAMES)}`,
    phone: `${rng.pick(["9", "8", "7"])}${String(rng.int(100000000, 999999999))}`,
    address: `Plot ${rng.int(2, 240)}, ${area}, ${b.city} ${pincode}`,
    pincode,
    lat: jitter(b.center[0], 0.035),
    lng: jitter(b.center[1], 0.035),
    language: rng.chance(0.8) ? "hi" : "en",
    branchId,
    outstanding,
    emi: Math.round((outstanding * (0.028 + rng.next() * 0.017)) / 100) * 100,
    dpd: 1,
    quality,
    paidRatio6m: rng.chance(0.08) ? null : samplePaidRatio(rng, quality),
    lastPaymentDate: rng.chance(0.15) ? addDays(day, -rng.int(5, 25)) : addDays(day, -rng.int(30, 40)),
    disbursedOn: addDays(day, -rng.int(200, 900)),
    status: "overdue",
    officerId: null,
    promises: [],
    outcomes: [],
    scripted: false,
    disputed: false,
    scheduledCure: null,
    ...override,
  };
  loans.push(loan);
  return loan;
}

function inputsFor(l: SimLoan, day: ISODate): ScoreInput {
  const broken = l.promises.filter((p) => p.status === "broken" && p.date >= addDays(day, -90) && p.date < day).length;
  const unreachable = l.outcomes.filter((o) => o.type === "not_reachable" && o.day >= addDays(day, -7) && o.day < day).length;
  const upcoming = l.promises.find((p) => p.status === "open" && p.date >= day);
  return {
    dpd: l.dpd,
    outstanding: l.outstanding,
    brokenPromises90d: broken,
    paidRatio6m: l.paidRatio6m,
    daysSinceLastPayment: l.lastPaymentDate ? daysBetween(l.lastPaymentDate, day) : null,
    unreachable7d: unreachable,
    upcomingPromiseDate: upcoming?.date ?? null,
  };
}

function randomTime(day: ISODate, fromMin = 9 * 60 + 15, toMin = 18 * 60 + 30): Date {
  const m = rng.int(fromMin, toMin);
  return istDateTime(day, Math.floor(m / 60), m % 60);
}

function addOutcome(l: SimLoan, officerId: string, day: ISODate, at: Date, o: Partial<SimOutcome> & { type: SimOutcome["type"] }): SimOutcome {
  const channel = o.channel ?? (rng.chance(0.6) ? "visit" : "call");
  const gpsRoll = rng.next();
  const gps = gpsRoll < 0.92 ? "ok" : gpsRoll < 0.97 ? "timeout" : "denied";
  const near = channel === "visit";
  const officerBranch = BRANCHES.find((b) => b.id === l.branchId)!;
  const offlineRoll = rng.next();
  const syncedAt =
    offlineRoll < 0.85
      ? new Date(at.getTime() + rng.int(2, 90) * 1000)
      : offlineRoll < 0.97
        ? new Date(at.getTime() + rng.int(20, 180) * 60_000)
        : istDateTime(addDays(day, 1), 8, rng.int(5, 50));
  const out: SimOutcome = {
    id: randomUUID(),
    channel,
    at,
    day,
    reason: null,
    amount: null,
    promisedDate: null,
    officerId,
    lat: gps === "ok" ? (near ? jitter(l.lat, 0.0004) : jitter(officerBranch.center[0], 0.03)) : null,
    lng: gps === "ok" ? (near ? jitter(l.lng, 0.0004) : jitter(officerBranch.center[1], 0.03)) : null,
    accuracy: gps === "ok" ? rng.int(6, 45) : null,
    gps,
    offline: offlineRoll >= 0.85,
    syncedAt,
    ...o,
  };
  l.outcomes.push(out);
  attempts.push({ id: randomUUID(), loanId: l.id, officerId, kind: channel, occurredAt: at, allowed: true, flags: [], syncedAt });
  return out;
}

function makePromise(l: SimLoan, officerId: string, day: ISODate, at: Date, date: ISODate, amount: number, willKeep: boolean) {
  for (const p of l.promises) if (p.status === "open") p.status = "superseded";
  const o = addOutcome(l, officerId, day, at, { type: "promise", promisedDate: date, amount });
  l.promises.push({ id: randomUUID(), madeAt: at, date, amount, status: "open", willKeep, officerId, outcomeId: o.id });
}

function cure(l: SimLoan, day: ISODate) {
  l.status = "cured";
  l.lastPaymentDate = day;
  for (const p of l.promises) if (p.status === "open") { p.status = "kept"; p.resolvedOn = day; }
  l.officerId = null;
  l.scheduledCure = null;
}

/** Daily chance this borrower pays up, set so that P(reaching the next bucket) matches the hidden model. */
function cureHazard(l: SimLoan, day: ISODate): number {
  const trueP = 1 / (1 + Math.exp(-trueRollLogit(inputsFor(l, day), l.quality)));
  return Math.min(0.6, Math.max(0.004, 1 - Math.pow(trueP, 1 / daysToNextBucket(l.dpd))));
}

// ---------------------------------------------------------------------------------------------
// Scripted sample loans from the brief
// ---------------------------------------------------------------------------------------------
const SAMPLE_OVERRIDES: Record<string, Partial<SimLoan> & { enter: number }> = {
  "LN-10293": { enter: 11, name: "Company B", trade: "packaging unit", branchId: "IDR", pincode: "452003", outstanding: 640000, emi: 21000, quality: 0.3, paidRatio6m: 5 / 6, contact: "A. Sharma", language: "hi" },
  "LN-10871": { enter: 26, name: "Company C", trade: "fertiliser shop", branchId: "IDR", pincode: "452010", outstanding: 310000, emi: 11500, quality: -0.2, paidRatio6m: 4 / 6, contact: "M. Patidar", language: "hi" },
  "LN-11930": { enter: 18, name: "Company D", trade: "printing press", branchId: "PTP", pincode: "454775", outstanding: 220000, emi: 9000, quality: -0.6, paidRatio6m: 3 / 6, contact: "S. Bohra", language: "en" },
};
const SAMPLE_OFFICER: Record<string, string> = { "LN-10293": "rahul", "LN-10871": "neha", "LN-11930": "imran" };

function scriptedEvents(l: SimLoan, day: ISODate) {
  const officerId = officerIds.get(SAMPLE_OFFICER[l.id])!;
  const rel = daysBetween(TODAY, day);
  if (l.id === "LN-10293") {
    if (rel === -6) addOutcome(l, officerId, day, istDateTime(day, 11, 20), { type: "not_reachable", channel: "call", reason: "no_answer" });
    if (rel === -2) makePromise(l, officerId, day, istDateTime(day, 16, 5), addDays(TODAY, 3), 21000, true);
  }
  if (l.id === "LN-10871") {
    if (rel === -9) addOutcome(l, officerId, day, istDateTime(day, 12, 40), { type: "not_reachable", channel: "visit", reason: "shop_closed" });
    if (rel === -3) addOutcome(l, officerId, day, istDateTime(day, 10, 15), { type: "not_reachable", channel: "call", reason: "switched_off" });
  }
  if (l.id === "LN-11930") {
    if (rel === -6) makePromise(l, officerId, day, istDateTime(day, 15, 30), addDays(TODAY, -2), 9000, false);
    if (rel === -5) addOutcome(l, officerId, day, istDateTime(day, 17, 10), { type: "not_reachable", channel: "call", reason: "no_answer" });
  }
}

// ---------------------------------------------------------------------------------------------
// The simulation
// ---------------------------------------------------------------------------------------------
function simulate() {
  const officersForAssign = OFFICERS.map((o) => ({
    id: officerIds.get(o.key)!, name: o.name, branchId: o.branch, active: true, maxLoad: 30, pincodes: o.pincodes,
  }));
  const templateFor = (purpose: string, lang: string) => TEMPLATES.find((t) => t.purpose === purpose)![lang as "hi" | "en"];

  for (let t = 0; t < DAYS; t++) {
    const day = addDays(START, t);
    const isSunday = weekday(day) === 0;

    // Morning: promises whose date has passed are settled.
    for (const l of loans) {
      if (l.status !== "overdue") continue;
      for (const p of l.promises) if (p.status === "open" && p.date < day) { p.status = "broken"; p.resolvedOn = day; }
    }

    // New overdue loans (and the scripted samples on their entry day).
    for (const b of BRANCHES) {
      const n = rng.poisson(b.inflowPerDay * (isSunday ? 0.3 : 1));
      for (let i = 0; i < n; i++) newLoan(b.id, day);
    }
    for (const [id, o] of Object.entries(SAMPLE_OVERRIDES)) {
      if (daysBetween(day, TODAY) === o.enter) {
        const { enter: _enter, ...fields } = o;
        const l = newLoan(o.branchId!, day, { ...fields, id, scripted: true, lastPaymentDate: addDays(day, -31) });
        l.address = `Plot ${rng.int(2, 240)}, ${rng.pick(AREAS[l.branchId])}, ${BRANCHES.find((b) => b.id === l.branchId)!.city} ${l.pincode}`;
        l.officerId = officerIds.get(SAMPLE_OFFICER[id])!;
        nextCompany--; // samples use the brief's own letters
      }
    }

    const overdue = loans.filter((l) => l.status === "overdue");
    const scored = new Map(overdue.map((l) => [l.id, scoreLoan(inputsFor(l, day))]));

    // Morning file: snapshot, score, assign.
    const assignments = assignLoans(
      overdue.map((l) => ({ id: l.id, branchId: l.branchId, pincode: l.pincode, outstanding: l.outstanding, score: scored.get(l.id)!.score, currentOfficerId: l.officerId })),
      officersForAssign,
    );
    const overdueById = new Map(overdue.map((l) => [l.id, l]));
    for (const a of assignments) {
      const l = overdueById.get(a.loanId)!;
      if (!l.scripted) l.officerId = a.officerId;
    }
    for (const l of overdue) {
      snapshots.push({ loanId: l.id, asOfDate: day, dpd: l.dpd, outstanding: l.outstanding, branchId: l.branchId, officerId: l.officerId });
      const s = scored.get(l.id)!;
      scoreRows.push({ loanId: l.id, asOfDate: day, score: s.score, pRoll: s.pRoll, reasons: s.reasons, limitedHistory: s.limitedHistory, modelVersion: s.modelVersion });
    }

    // Field work (Monday to Saturday).
    const contactedToday = new Set<string>();
    if (!isSunday) {
      for (const o of officersForAssign) {
        const list = overdue
          .filter((l) => l.officerId === o.id && !l.scripted)
          .map((l) => ({ l, id: l.id, score: scored.get(l.id)!.score, dpd: l.dpd, manualRank: null }))
          .sort(compareForList);
        const capacity = rng.int(7, 11);
        let done = 0;
        for (const { l } of list) {
          if (done >= capacity) break;
          const open = l.promises.find((p) => p.status === "open");
          if (open && open.date > day) continue; // no need to chase before the promised date
          if (rng.chance(0.15)) continue; // skipped today (route, time)
          done++;
          contactedToday.add(l.id);
          const at = randomTime(day);

          if (open && open.date === day && rng.chance(0.5)) {
            messages.push({
              id: randomUUID(), loanId: l.id, officerId: o.id, templateId: `promise_today.${l.language}`, language: l.language,
              body: renderTemplate(templateFor("promise_today", l.language), {
                contact: l.contact, business: l.name, amount: `₹${open.amount.toLocaleString("en-IN")}`, date: day, officer: o.name.split(" ")[0],
              }),
              status: "sent_simulated", occurredAt: istDateTime(day, 9, rng.int(5, 55)), syncedAt: istDateTime(day, 9, 58),
            });
          }
          // A borrower who planned to pay today does so when the officer comes.
          if (l.scheduledCure === day) {
            addOutcome(l, o.id, day, at, { type: "paid", amount: open?.amount ?? overdueAmount(l), reason: "emi" });
            cure(l, day);
            continue;
          }
          const h = cureHazard(l, day);
          if (rng.chance(h)) {
            addOutcome(l, o.id, day, at, { type: "paid", amount: overdueAmount(l), reason: "overdue_full" });
            cure(l, day);
            continue;
          }
          const r = rng.next();
          if (r < 0.38) {
            // A promise is kept only if the borrower would really pay within the window.
            const windowDays = rng.int(1, 7);
            let payOn: ISODate | null = null;
            for (let j = 1; j <= windowDays && !payOn; j++) if (rng.chance(h)) payOn = addDays(day, j);
            const amount = Math.min(overdueAmount(l), l.emi * rng.int(1, 2));
            makePromise(l, o.id, day, at, payOn ?? addDays(day, windowDays), amount, payOn !== null);
            l.scheduledCure = payOn;
          } else if (r < 0.48) {
            const amount = Math.round((l.emi * (0.3 + rng.next() * 0.5)) / 100) * 100;
            addOutcome(l, o.id, day, at, { type: "paid", amount, reason: "partial" });
            l.lastPaymentDate = day;
          } else if (r < 0.495 && !l.disputed) {
            addOutcome(l, o.id, day, at, { type: "dispute", reason: rng.pick(["amount_wrong", "already_paid"]) });
            l.disputed = true;
          } else {
            addOutcome(l, o.id, day, at, { type: "not_reachable", reason: rng.pick(["no_answer", "switched_off", "shop_closed"]) });
          }
        }
        // Now and then an officer taps Call after 7 pm: the app blocks it and records the attempt.
        if (rng.chance(0.06) && list.length > 0) {
          attempts.push({
            id: randomUUID(), loanId: list[0].l.id, officerId: o.id, kind: "call", occurredAt: randomTime(day, 19 * 60 + 2, 20 * 60 + 30),
            allowed: false, blockedReason: "after_window", flags: [], syncedAt: istDateTime(day, 20, 45),
          });
        }
      }
    }

    // Borrowers who pay without a visit, and kept promises paid by transfer.
    for (const l of loans) {
      if (l.status !== "overdue" || contactedToday.has(l.id) || l.scripted) continue;
      if (l.scheduledCure) {
        if (l.scheduledCure === day) cure(l, day);
        continue;
      }
      if (rng.chance(cureHazard(l, day))) cure(l, day);
    }

    // Scripted samples follow their own story.
    for (const l of loans) if (l.scripted && l.status === "overdue") scriptedEvents(l, day);

    // Night: everyone still overdue is a day later.
    for (const l of loans) {
      if (l.status !== "overdue") continue;
      l.dpd++;
      if (l.dpd > 150) { l.status = "closed"; l.officerId = null; } // handed to the legal team
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------------------------
async function insertChunked<T extends Record<string, unknown>>(table: Parameters<typeof db.insert>[0], rows: T[], size = 800) {
  for (let i = 0; i < rows.length; i += size) await db.insert(table).values(rows.slice(i, i + size) as never);
}

function csvEscape(v: string | number | null) {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildOverdueCsv(rows: SimLoan[]): string {
  const header = "loan_id,borrower_name,business_type,contact_name,phone,address,pincode,branch,outstanding,emi,dpd,last_payment_date,paid_on_time_last_6,language";
  const lines = rows.map((l) =>
    [l.id, l.name, l.trade, l.contact, l.phone, l.address, l.pincode, l.branchId, l.outstanding, l.emi, l.dpd, l.lastPaymentDate, l.paidRatio6m === null ? "" : Math.round(l.paidRatio6m * 6), l.language]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...lines].join("\n");
}

async function main() {
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 8) throw new Error("Set DEMO_PASSWORD (8+ characters) before seeding.");
  console.log(`Seeding demo data for ${TODAY} (simulating from ${START})...`);

  await db.execute(sql`truncate table audit_log, messages, message_templates, promises, contact_attempts, outcomes,
    score_snapshots, imports, loan_snapshots, loans, borrowers, officer_territories, users, branches restart identity cascade`);

  const hash = await hashPassword(password);
  await db.insert(schema.branches).values(BRANCHES.map((b) => ({ id: b.id, name: b.name, city: b.city })));
  await db.insert(schema.users).values([
    ...OFFICERS.map((o) => ({ id: officerIds.get(o.key)!, email: email(o.key), name: o.name, role: "officer" as const, branchId: o.branch, passwordHash: hash, language: "hi", maxLoad: 30 })),
    ...MANAGERS.map((m) => ({ email: email(m.key), name: m.name, role: "manager" as const, branchId: m.branch, passwordHash: hash, language: "en" })),
    { email: email(HEAD.key), name: HEAD.name, role: "head" as const, branchId: null, passwordHash: hash, language: "en" },
  ]);
  await db.insert(schema.officerTerritories).values(OFFICERS.flatMap((o) => o.pincodes.map((p) => ({ officerId: officerIds.get(o.key)!, pincode: p }))));
  await db.insert(schema.messageTemplates).values(
    TEMPLATES.flatMap((t) =>
      (["hi", "en"] as const).map((lang) => ({ id: `${t.purpose}.${lang}`, purpose: t.purpose, language: lang, body: t[lang], approvedBy: "Head of Collections and Compliance", approvedOn: addDays(TODAY, -60) })),
    ),
  );

  simulate();

  // Everything before today goes in directly. Today's file goes through the import pipeline.
  await insertChunked(schema.borrowers, loans.map((l) => ({ id: l.borrowerId, name: l.name, contactName: l.contact, phone: l.phone, address: l.address, pincode: l.pincode, lat: l.lat, lng: l.lng, businessType: l.trade, language: l.language })));
  await insertChunked(schema.loans, loans.map((l) => ({
    id: l.id, borrowerId: l.borrowerId, branchId: l.branchId, emi: l.emi, outstanding: l.outstanding, dpd: l.dpd, lastPaymentDate: l.lastPaymentDate,
    paidRatio6m: l.paidRatio6m, disbursedOn: l.disbursedOn, status: l.status, disputed: l.disputed, assignedOfficerId: l.status === "overdue" ? l.officerId : null,
    assignmentReason: l.status === "overdue" ? "kept_with_officer" : null, assignedAt: l.status === "overdue" ? istDateTime(addDays(TODAY, -1), 7, 30) : null,
    lastImportDate: addDays(TODAY, -1),
  })));
  await insertChunked(schema.loanSnapshots, snapshots);
  await insertChunked(schema.scoreSnapshots, scoreRows, 500);
  const allOutcomes = loans.flatMap((l) => l.outcomes.map((o) => ({ l, o })));
  await insertChunked(schema.outcomes, allOutcomes.map(({ l, o }) => ({
    id: o.id, loanId: l.id, officerId: o.officerId, type: o.type, channel: o.channel, reason: o.reason, amount: o.amount, promisedDate: o.promisedDate,
    occurredAt: o.at, deviceTime: o.at, clockSkewMs: 0, lat: o.lat, lng: o.lng, accuracyM: o.accuracy, gpsStatus: o.gps, createdOffline: o.offline,
    flags: o.offline ? ["offline"] : [], syncedAt: o.syncedAt,
  })));
  await insertChunked(schema.promises, loans.flatMap((l) => l.promises.map((p) => ({
    id: p.id, loanId: l.id, outcomeId: p.outcomeId, officerId: p.officerId, promisedDate: p.date, amount: p.amount, status: p.status, createdAt: p.madeAt,
    resolvedAt: p.resolvedOn ? istDateTime(p.resolvedOn, 7, 0) : null,
  }))));
  await insertChunked(schema.contactAttempts, attempts);
  await insertChunked(schema.messages, messages);

  // Today's morning file, new overdue loans included, through the real import.
  for (const b of BRANCHES) for (let i = 0, n = rng.poisson(b.inflowPerDay); i < n; i++) newLoan(b.id, TODAY);
  const todays = loans.filter((l) => l.status === "overdue");
  const head = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.role, "head") });
  const result = await commitImport({
    csvText: buildOverdueCsv(todays),
    fileName: `overdue-${TODAY}.csv`,
    asOfDate: TODAY,
    branchScope: null,
    actor: head ? { id: head.id, role: "head" } : null,
    now: istDateTime(TODAY, 7, 40),
  });
  if (result.errors.length > 0) console.warn("Import rejected rows:", result.errors.slice(0, 5));
  // Give imported new loans their simulated coordinates (the loan system export has none).
  for (const l of todays.filter((x) => x.outcomes.length === 0)) {
    await db.update(schema.borrowers).set({ lat: l.lat, lng: l.lng }).where(sql`id = (select borrower_id from loans where id = ${l.id})`);
  }

  // Today's field work so far, through the same sync service the phones use.
  const nowReal = new Date();
  const nowMin = TODAY === istDate(nowReal) ? istParts(nowReal).minuteOfDay : 24 * 60;
  const startMin = 9 * 60 + 15;
  const endMin = Math.min(nowMin - 5, 18 * 60 + 30);
  let synced = 0;
  if (endMin > startMin && weekday(TODAY) !== 0) {
    const fraction = (endMin - startMin) / (18 * 60 + 30 - startMin);
    for (const o of OFFICERS) {
      const id = officerIds.get(o.key)!;
      const list = await db.query.loans.findMany({ where: (l, { and, eq }) => and(eq(l.assignedOfficerId, id), eq(l.status, "overdue")) });
      const scores = await db.query.scoreSnapshots.findMany({ where: (s, { eq }) => eq(s.asOfDate, TODAY) });
      const scoreOf = new Map(scores.map((s) => [s.loanId, s.score]));
      const ordered = list
        .filter((l) => !["LN-10293", "LN-10871", "LN-11930"].includes(l.id))
        .map((l) => ({ ...l, score: scoreOf.get(l.id) ?? 0 }))
        .sort(compareForList);
      const count = Math.round(fraction * rng.int(7, 10));
      const events = ordered.slice(0, count).map((l) => {
        const at = randomTime(TODAY, startMin, endMin);
        const r = rng.next();
        const sim = loans.find((x) => x.id === l.id)!;
        const type = r < 0.22 ? "paid" : r < 0.6 ? "promise" : "not_reachable";
        const channel = rng.chance(0.6) ? "visit" : "call";
        return {
          id: randomUUID(), kind: "outcome", loanId: l.id, deviceTime: at.toISOString(), occurredAt: at.toISOString(), serverOffsetMs: 0,
          createdOffline: rng.chance(0.2), type, channel,
          reason: type === "not_reachable" ? rng.pick(["no_answer", "switched_off", "shop_closed"]) : type === "paid" ? "emi" : undefined,
          amount: type === "paid" ? l.emi : type === "promise" ? l.emi : undefined,
          promisedDate: type === "promise" ? addDays(TODAY, rng.int(1, 6)) : undefined,
          gps: channel === "visit" ? { status: "ok", lat: jitter(sim.lat, 0.0004), lng: jitter(sim.lng, 0.0004), accuracy: rng.int(6, 30) } : { status: "ok", lat: jitter(sim.lat, 0.02), lng: jitter(sim.lng, 0.02), accuracy: rng.int(10, 60) },
        };
      });
      if (events.length === 0) continue;
      const res = await applySync({ id, role: "officer" }, { clientNow: nowReal.toISOString(), events }, nowReal, null);
      synced += res.filter((r) => r.status === "accepted").length;
      // Phones sync seconds after logging, or later when they were offline.
      for (const e of events) {
        const delayMs = e.createdOffline ? rng.int(15, 90) * 60_000 : rng.int(3, 60) * 1000;
        const syncedAt = new Date(Math.min(new Date(e.occurredAt).getTime() + delayMs, nowReal.getTime()));
        await db.update(schema.outcomes).set({ syncedAt }).where(sql`id = ${e.id}`);
        await db.update(schema.contactAttempts).set({ syncedAt }).where(sql`id = ${e.id}`);
      }
    }
  }

  // Report.
  const rr = computeRollRate(
    snapshots.filter((s) => s.asOfDate === addDays(TODAY, -31)),
    snapshots.filter((s) => s.asOfDate === addDays(TODAY, -1)),
  );
  console.log(`Loans simulated: ${loans.length}. Overdue today: ${todays.length}. Import accepted ${result.accepted}, assigned to ${result.officers.length} officers, ${result.unassigned.length} unassigned.`);
  console.log(`Outcomes: ${allOutcomes.length} historic + ${synced} today. Promises: ${loans.reduce((s, l) => s + l.promises.length, 0)}.`);
  console.log("30-day roll rate:", Object.entries(rr.byBranch).map(([b, r]) => `${b} ${(100 * (r.rate ?? 0)).toFixed(1)}% (${r.rolled}/${r.cohort})`).join(", "), `overall ${(100 * (rr.overall.rate ?? 0)).toFixed(1)}%`);
  console.log("Week start:", weekStart(TODAY));
  console.log("Demo sign-in: rahul@kist.test (officer), sanjay@kist.test (manager), ritu@kist.test (head). Password: the DEMO_PASSWORD you set.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
