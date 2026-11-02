/**
 * The demo lender: three branches around Indore, nine field officers, three branch managers
 * and a head of collections. All people and borrowers are fictional; borrower businesses follow
 * the brief's "Company X (trade)" naming so no real business is named.
 */

export const BRANCHES = [
  { id: "IDR", name: "Indore City", city: "Indore", center: [22.7196, 75.8577] as const, qualityShift: 0.1, inflowPerDay: 4.8 },
  { id: "PTP", name: "Pithampur", city: "Pithampur", center: [22.6136, 75.6797] as const, qualityShift: -0.1, inflowPerDay: 2.9 },
  { id: "DWS", name: "Dewas", city: "Dewas", center: [22.9676, 76.0534] as const, qualityShift: -0.4, inflowPerDay: 2.1 },
];

export const PINCODES: Record<string, string[]> = {
  IDR: ["452001", "452002", "452003", "452005", "452007", "452009", "452010", "452011", "452015", "452016", "452018"],
  PTP: ["454775", "454001", "453441", "453551"],
  DWS: ["455001", "455221", "455336"],
};

export const AREAS: Record<string, string[]> = {
  IDR: ["Sanwer Road Industrial Area", "Pologround Industrial Estate", "Siyaganj", "Malharganj", "Vijay Nagar", "Palasia", "Laxmibai Nagar", "Rau"],
  PTP: ["Sector 1 Industrial Area", "Sector 3 Industrial Area", "Main Market", "Bagdun Road"],
  DWS: ["Industrial Area No. 1", "AB Road", "Station Road", "Ujjain Road"],
};

export const OFFICERS = [
  { key: "rahul", name: "Rahul Chouhan", branch: "IDR", pincodes: ["452001", "452002", "452003", "452005"] },
  { key: "neha", name: "Neha Solanki", branch: "IDR", pincodes: ["452007", "452009", "452010", "452011"] },
  { key: "pooja", name: "Pooja Verma", branch: "IDR", pincodes: ["452015", "452016", "452018", "452002"] },
  { key: "amit", name: "Amit Patidar", branch: "IDR", pincodes: ["452010", "452011", "452018", "452005"] },
  { key: "imran", name: "Imran Qureshi", branch: "PTP", pincodes: ["454775", "453551"] },
  { key: "sandeep", name: "Sandeep Yadav", branch: "PTP", pincodes: ["454775", "454001"] },
  { key: "kavita", name: "Kavita Rathore", branch: "PTP", pincodes: ["453441", "453551", "454001"] },
  { key: "vikas", name: "Vikas Malviya", branch: "DWS", pincodes: ["455001", "455221"] },
  { key: "farhan", name: "Farhan Ali", branch: "DWS", pincodes: ["455001", "455221", "455336"] },
];

export const MANAGERS = [
  { key: "sanjay", name: "Sanjay Jain", branch: "IDR" },
  { key: "meera", name: "Meera Joshi", branch: "PTP" },
  { key: "arjun", name: "Arjun Tiwari", branch: "DWS" },
];

export const HEAD = { key: "ritu", name: "Ritu Agrawal" };

export const email = (key: string) => `${key}@kist.test`;

export const TRADES = [
  "packaging unit", "fertiliser shop", "printing press", "auto parts", "textile trader", "namkeen maker",
  "plastic moulding", "steel fabrication", "electrical goods", "pharma distributor", "furniture workshop",
  "kirana wholesaler", "poha mill", "garment unit", "hardware store", "dairy", "tiles dealer",
  "spice grinding", "pump repair", "transport agency",
];

export const SURNAMES = [
  "Sharma", "Jain", "Patel", "Agrawal", "Malviya", "Rathore", "Khan", "Verma", "Joshi", "Mishra", "Patidar",
  "Gupta", "Sethi", "Bhatia", "Pandey", "Tiwari", "Chouhan", "Yadav", "Kushwaha", "Soni", "Shaikh", "Bohra",
];

/** Company E ... Company Z, then Company AA ... ZZ, then AA2 ... (B, C and D are the brief's own samples). */
export function companyCode(i: number): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (i < 22) return letters[i + 4];
  const n = i - 22;
  const pair = letters[Math.floor(n / 26) % 26] + letters[n % 26];
  const round = Math.floor(n / 676);
  return round === 0 ? pair : `${pair}${round + 1}`;
}

export const TEMPLATES = [
  {
    purpose: "promise_tomorrow",
    hi: "नमस्ते {contact} जी, {business} की किस्त {amount} कल {date} को देनी है, जैसा आपने बताया था। भुगतान के बाद रसीद ज़रूर लें। – {officer}, Company A",
    en: "Hello {contact}, a reminder that the EMI of {amount} for {business} is due tomorrow, {date}, as you confirmed. Please keep the receipt when you pay. – {officer}, Company A",
  },
  {
    purpose: "promise_today",
    hi: "नमस्ते {contact} जी, आज {date} को {business} की किस्त {amount} देने की बात हुई थी। कोई दिक्कत हो तो मुझे बताएं। – {officer}, Company A",
    en: "Hello {contact}, today, {date}, is the day you planned to pay {amount} for {business}. If anything has changed, please let me know. – {officer}, Company A",
  },
  {
    purpose: "promise_broken",
    hi: "नमस्ते {contact} जी, {date} को {amount} का भुगतान अभी तक नहीं मिला है। कृपया बताएं कि कब तक भुगतान हो पाएगा, ताकि नई तारीख तय कर सकें। – {officer}, Company A",
    en: "Hello {contact}, we have not yet received the {amount} planned for {date}. Please tell me when you can pay so we can agree a new date. – {officer}, Company A",
  },
  {
    purpose: "overdue_reminder",
    hi: "नमस्ते {contact} जी, {business} की किस्त {amount} बाकी है। आप कब तक भुगतान कर पाएंगे? कोई सवाल हो तो मुझसे बात करें। – {officer}, Company A",
    en: "Hello {contact}, the EMI of {amount} for {business} is pending. When would you be able to pay? Call me if you have any questions. – {officer}, Company A",
  },
] as const;
