// Usage: npm run seed | npm run seed:clear | node scripts/seed.js dry
import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const mode = process.argv[2] || "seed";
const ago = (n) => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4 - n * 864e5).toISOString().slice(0, 10);
let s = 42;
const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;

// [name, sku, category, cost, price, starting qty, minimum]
const P = [
  ["Claw hammer 16oz", "HW-001", "Hand tools", 450, 650, 40, 10],
  ["Screwdriver set 6pc", "HW-002", "Hand tools", 600, 950, 25, 8],
  ["Adjustable spanner 10in", "HW-003", "Hand tools", 520, 800, 30, 8],
  ["Tape measure 5m", "HW-004", "Hand tools", 180, 320, 60, 15],
  ["Hacksaw frame", "HW-005", "Hand tools", 350, 550, 18, 6],
  ["Cordless drill 18V", "PT-001", "Power tools", 6500, 8900, 10, 3],
  ["Angle grinder 4.5in", "PT-002", "Power tools", 4200, 5800, 8, 3],
  ["Jigsaw 650W", "PT-003", "Power tools", 3800, 5200, 6, 2],
  ["Drill bit set 13pc", "PT-004", "Power tools", 900, 1500, 22, 6],
  ["Wall plugs assorted box", "FS-001", "Fasteners", 120, 220, 120, 30],
  ["Wood screws 4x40mm box", "FS-002", "Fasteners", 250, 420, 90, 20],
  ["Nails 3in per kg", "FS-003", "Fasteners", 130, 200, 150, 40],
  ["Bolts and nuts M10 pack", "FS-004", "Fasteners", 300, 480, 45, 15],
  ["Cement 50kg", "BM-001", "Building", 700, 820, 200, 50],
  ["Binding wire per kg", "BM-002", "Building", 160, 240, 80, 20],
  ["Emulsion paint white 4L", "PN-001", "Paint", 1300, 1850, 35, 10],
  ["Paint brush 3in", "PN-002", "Paint", 120, 230, 70, 20],
  ["Wood varnish 1L", "PN-003", "Paint", 650, 950, 20, 6],
  ["PVC pipe 1/2in 3m", "PL-001", "Plumbing", 220, 350, 60, 15],
  ["Brass water tap 1/2in", "PL-002", "Plumbing", 280, 450, 3, 10],
  ["Gate valve 1in", "PL-003", "Plumbing", 380, 600, 25, 8],
  ["Electrical cable 2.5mm 100m", "EL-001", "Electrical", 6800, 8500, 12, 4],
  ["LED bulb 12W", "EL-002", "Electrical", 90, 180, 100, 30],
  ["Padlock 50mm", "SC-001", "Security", 350, 600, 0, 8],
];
// [type, description, amount, days ago]
const L = [
  ["Capital", "Owner opening capital", 1500000, 60],
  ["Loan", "Equity Bank working-capital loan", 300000, 58],
  ["Stock purchase", "Initial stock: tools and fasteners", 450000, 55],
  ["Stock purchase", "Cement and building materials", 250000, 30],
  ["Expense", "Shop rent", 45000, 28],
  ["Expense", "Staff salaries", 60000, 27],
  ["Expense", "Electricity and water", 8500, 20],
  ["Expense", "Transport and delivery", 12000, 14],
  ["Expense", "Shop rent", 45000, 3],
  ["Expense", "Staff salaries", 60000, 2],
];

const BR = [["Nairobi CBD", "Moi Avenue, Nairobi", "0700 111 222", "hardware"], ["Thika Road", "Thika Road Mall, Nairobi", "0700 333 444", "hardware"], ["Mombasa", "Nyali, Mombasa", "0700 555 666", "hardware"],
  ["Ruiru Town Water", "Ruiru Town, Kiambu", "0700 777 101", "water"], ["Ruiru Kimbo Water", "Kimbo, Ruiru", "0700 777 102", "water"], ["Ruiru Membley Water", "Membley, Ruiru", "0700 777 103", "water"]];
const HW = 3; // first 3 branches are hardware, the rest are water
const DEMOW = [["Grace Njeri", "grace.demo@example.com"], ["Samuel Mwangi", "samuel.demo@example.com"], ["Lucy Wambui", "lucy.demo@example.com"]];
const WI = [["5L refill", 5, 20], ["10L refill", 10, 35], ["20L refill", 20, 60], ["500ml bottle", 0.5, 25]];
L.push(["Expense", "Electricity and pumping, Ruiru Town", 18000, 6, 3], ["Expense", "Filters and chlorine, Ruiru Kimbo", 9000, 9, 4],
  ["Expense", "Electricity and pumping, Ruiru Membley", 16500, 5, 5], ["Expense", "Attendant salary, Ruiru Town", 20000, 2, 3]);
const DEMO = [["Amina Wanjiru", "amina.demo@example.com"], ["Brian Otieno", "brian.demo@example.com"], ["Cynthia Achieng", "cynthia.demo@example.com"], ["David Kamau", "david.demo@example.com"]];

let db, users;
if (mode === "dry") users = [{ id: "demo", name: "Demo" }];
else {
  const key = JSON.parse(readFileSync(new URL("../serviceAccountKey.json", import.meta.url)));
  initializeApp({ credential: cert(key) });
  db = getFirestore();
}
const id = (p, i) => `seed-${p}${String(i + 1).padStart(2, "0")}`;

if (mode === "clear") {
  for (const c of ["products", "sales", "ledger", "users", "branches", "waterItems", "waterSales", "waterLogs", "invoices"]) {
    const snap = await db.collection(c).get();
    const b = db.batch();
    snap.docs.filter((d) => d.id.startsWith("seed-")).forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  const us = await db.collection("users").get();
  const ub = db.batch();
  us.docs.filter((d) => String(d.data().branchId || "").startsWith("seed-")).forEach((d) => ub.update(d.ref, { branchId: "" }));
  await ub.commit();
  console.log("Sample data removed.");
  process.exit(0);
}

let real = [{ id: "demo", name: "Demo", branchId: "" }];
if (mode !== "dry") {
  real = (await db.collection("users").get()).docs.filter((d) => d.data().role !== "removed" && !d.id.startsWith("seed-"))
    .map((d) => ({ id: d.id, name: d.data().name || d.data().email, branchId: d.data().branchId || "" }));
  if (!real.length) throw new Error("No users found. Sign in to the app once first.");
}
real.forEach((u, i) => { if (!u.branchId) { u.branchId = id("b", i % HW); u.assign = true; } });
users = [...real, ...DEMO.map((d, i) => ({ id: id("u", i), name: d[0], email: d[1], branchId: id("b", (i + 1) % HW), demo: true })),
  ...DEMOW.map((d, i) => ({ id: id("u", DEMO.length + i), name: d[0], email: d[1], branchId: id("b", HW + i), demo: true, water: true }))];

const HWU = users.filter((x) => !x.water);
const left = P.map((p) => p[5]);
const sales = [];
for (let i = 0; i < 45; i++) {
  const ok = P.map((_, k) => k).filter((k) => left[k] > 0);
  const k = ok[Math.floor(rnd() * ok.length)];
  const q = Math.min(1 + Math.floor(rnd() * 4), left[k]);
  left[k] -= q;
  const u = HWU[i % HWU.length];
  sales.push({
    id: id("s", i), receiptNo: `HW-${String(i + 1).padStart(6, "0")}`, branchId: u.branchId, userId: u.id, userName: u.name, productId: id("p", k), productName: P[k][0],
    qty: q, unitPrice: P[k][4], unitCost: P[k][3], total: q * P[k][4],
    date: ago(Math.floor(rnd() * 30)), createdAt: Timestamp.now(),
  });
}
let wsq = 0;
const WSALES = [], WLOGS = [];
BR.forEach((br, bi) => {
  if (br[3] !== "water") return;
  const bId = id("b", bi), staff = users.find((u) => u.branchId === bId), leak = [0.02, 0.04, 0.14][bi - HW];
  let tank = 2000;
  for (let d = 13; d >= 0; d--) {
    const date = ago(d);
    let sold = 0, total = 0;
    for (let k = 0; k < 4; k++) {
      const ix = Math.floor(rnd() * WI.length), it = WI[ix], q = 1 + Math.floor(rnd() * (it[1] >= 10 ? 8 : 12));
      sold += q * it[1]; total += q * it[2];
      WSALES.push({ id: `seed-w-${bi}-${d}-${k}`, receiptNo: `WT-${String(++wsq).padStart(6, "0")}`, branchId: bId, userId: staff.id, userName: staff.name, itemId: `seed-i${ix}`, productId: `seed-i${ix}`, productName: it[0], qty: q, litres: q * it[1], unitPrice: it[2], unitCost: 0, total: q * it[2], date, createdAt: Timestamp.now() });
    }
    if (d >= 1) {
      const wasted = Math.round(sold * 0.01), lost = Math.round(sold * leak), used = sold + wasted + lost;
      const target = 1700 + Math.floor(rnd() * 400), received = Math.max(0, used + target - tank), closing = tank + received - used;
      const short = bi === HW + 2 && rnd() < 0.5 ? Math.round((total * 0.08) / 10) * 10 : 0;
      WLOGS.push({ id: `${bId}_${date}`, branchId: bId, branchName: br[0], date, userId: staff.id, userName: staff.name, opening: tank, received, closing, wasted, cash: total - short, notes: "", sold, salesTotal: total, used, lost,
        lossPct: used > 0 ? Math.round((lost / used) * 1000) / 10 : 0, lossValue: Math.round(lost * (sold ? total / sold : 0)), cashDiff: -short, createdAt: Timestamp.now() });
      tank = closing;
    }
  }
});
const mkInv = (i, s, name, phone, addr, frac, dueAgo) => {
  const paid = Math.round(s.total * frac);
  return { id: id("inv", i), no: `INV-${String(i + 1).padStart(6, "0")}`, branchId: s.branchId, userId: s.userId, userName: s.userName, customerName: name, customerPhone: phone, customerEmail: "", customerAddress: addr,
    date: s.date, dueDate: ago(dueAgo), items: [{ saleId: s.id, desc: s.productName, receiptNo: s.receiptNo, qty: s.qty, price: s.unitPrice, total: s.total, date: s.date }], vatRate: 0, payInfo: "", notes: "", total: s.total, paid,
    status: paid >= s.total ? "paid" : paid > 0 ? "partial" : "unpaid", payments: paid ? [{ date: s.date, amount: paid, method: "M-Pesa", by: s.userName }] : [], createdAt: Timestamp.now() };
};
const INVS = [mkInv(0, sales[0], "Kamau Builders Ltd", "0722 000 111", "Thika Road, Nairobi", 1, -7), mkInv(1, sales[1], "Wanjiru Hardware", "0733 000 222", "Ruiru Town", 0.5, -7), mkInv(2, WSALES[0], "Ruiru Hotel", "0711 000 333", "Kimbo, Ruiru", 0, 5)];
if (left.some((n) => n < 0)) throw new Error("Negative stock");
if (mode === "dry") { console.log(`OK: ${P.length} products, ${sales.length} sales, ${L.length} ledger entries, ${BR.length} branches, ${DEMO.length + DEMOW.length} demo staff, ${WSALES.length} water sales, ${WLOGS.length} daily closes, ${INVS.length} invoices`); process.exit(0); }

const cs = await db.doc("counters/receipts").get(), cn = cs.exists ? cs.data() : {};
const ci = await db.doc("counters/invoices").get(), cin = ci.exists ? ci.data() : {};
const b = db.batch();
b.set(db.doc("counters/receipts"), { hw: Math.max(cn.hw || 0, sales.length), wt: Math.max(cn.wt || 0, WSALES.length) });
P.forEach((p, i) => b.set(db.doc(`products/${id("p", i)}`), { name: p[0], sku: p[1], category: p[2], cost: p[3], price: p[4], qty: left[i], minQty: p[6] }));
sales.forEach(({ id: sid, ...d }) => b.set(db.doc(`sales/${sid}`), d));
L.forEach((l, i) => b.set(db.doc(`ledger/${id("l", i)}`), { type: l[0], description: l[1], amount: l[2], date: ago(l[3]), branchId: l[4] === undefined ? "" : id("b", l[4]) }));
WI.forEach((w, i) => b.set(db.doc(`waterItems/seed-i${i}`), { name: w[0], litres: w[1], price: w[2] }));
WSALES.forEach(({ id: wid, ...d }) => b.set(db.doc(`waterSales/${wid}`), d));
WLOGS.forEach(({ id: wid, ...d }) => b.set(db.doc(`waterLogs/${wid}`), d));
INVS.forEach(({ id: iid, ...d }) => b.set(db.doc(`invoices/${iid}`), d));
b.set(db.doc("counters/invoices"), { n: Math.max(cin.n || 0, INVS.length) });
BR.forEach((x, i) => b.set(db.doc(`branches/${id("b", i)}`), { name: x[0], location: x[1], phone: x[2], type: x[3], createdAt: Timestamp.now() }));
users.filter((u) => u.demo).forEach((u) => b.set(db.doc(`users/${u.id}`), { name: u.name, email: u.email, phone: "", role: "user", photoURL: "", verified: true, branchId: u.branchId, createdAt: Timestamp.now() }));
real.filter((u) => u.assign).forEach((u) => b.set(db.doc(`users/${u.id}`), { branchId: u.branchId }, { merge: true }));
await b.commit();
console.log(`Added ${P.length} products, ${sales.length} sales and ${L.length} ledger entries, ${BR.length} branches (3 water), ${DEMO.length + DEMOW.length} demo staff, ${WSALES.length} water sales and ${WLOGS.length} daily closes and ${INVS.length} invoices.`);
