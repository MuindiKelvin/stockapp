// Pure statement builders plus PDF / Excel generators. Heavy libraries load only when a file is exported.
const fmt = (v, cur) => `${cur} ${(+v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sum = (rows, f) => rows.reduce((a, r) => a + (+f(r) || 0), 0);
const grp = (rows, kf, vf) => {
  const m = new Map();
  rows.forEach((r) => { const k = String(kf(r) || "Unspecified").trim(), lk = k.toLowerCase(), e = m.get(lk) || { l: k, v: 0 }; e.v += vf(r); m.set(lk, e); });
  return [...m.values()].sort((a, b) => b.v - a.v);
};

// Optional PDF password protection (opens with the user password; owner password is random and discarded).
const hex = (n) => [...globalThis.crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const pdfOpts = (password) => ({ unit: "pt", format: "a4", ...(password ? { encryption: { userPassword: password, ownerPassword: hex(16), userPermissions: ["print"] } } : {}) });

export function buildStatements({ H = [], W = [], L = [], P = [], B = [], bid, scope, from, to }) {
  const kind = scope.kind, branchId = scope.branchId || "";
  const bt = (id) => { const b = B.find((x) => x.id === id); return b ? (b.type === "water" ? "wt" : "hw") : ""; };
  const bn = (id) => B.find((x) => x.id === id)?.name || "";
  let Hs = kind === "wt" ? [] : H, Ws = kind === "hw" ? [] : W;
  if (kind === "branch") { Hs = H.filter((s) => bid(s) === branchId); Ws = W.filter((s) => bid(s) === branchId); }
  const Ls = L.filter((l) => kind === "all" || (kind === "branch" ? l.branchId === branchId : bt(l.branchId) === kind));
  const S = [...Hs, ...Ws], inP = (d) => d >= from && d <= to;
  const SP = S.filter((s) => inP(s.date)), LP = Ls.filter((l) => inP(l.date));
  const tot = (rows, t) => sum(rows.filter((l) => l.type === t), (l) => l.amount);
  const rev = sum(SP, (s) => s.total), cogs = sum(SP, (s) => s.qty * (s.unitCost || 0));
  const gross = rev - cogs, exp = tot(LP, "Expense"), net = gross - exp, buy = tot(LP, "Stock purchase"), cap = tot(LP, "Capital"), loan = tot(LP, "Loan");
  const cashTo = (pred) => { const ll = Ls.filter((l) => pred(l.date)); return sum(S.filter((s) => pred(s.date)), (s) => s.total) + tot(ll, "Capital") + tot(ll, "Loan") - tot(ll, "Expense") - tot(ll, "Stock purchase"); };
  const opening = cashTo((d) => d < from), closing = cashTo((d) => d <= to);
  const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
  const hL = grp(Hs.filter((s) => inP(s.date)), (s) => s.productName, (s) => s.total), wL = grp(Ws.filter((s) => inP(s.date)), (s) => s.productName, (s) => s.total);
  const eL = grp(LP.filter((l) => l.type === "Expense"), (l) => l.description, (l) => +l.amount || 0);
  const IS = [{ l: "REVENUE", k: "h" }];
  if (hL.length) { IS.push({ l: "Hardware sales", k: "t" }, ...hL.map((x) => ({ l: `   ${x.l}`, v: x.v }))); }
  if (wL.length) { IS.push({ l: "Water refilling sales", k: "t" }, ...wL.map((x) => ({ l: `   ${x.l}`, v: x.v }))); }
  IS.push({ l: "Total revenue", v: rev, k: "t" }, { l: "COST OF SALES", k: "h" }, { l: "Cost of goods sold", v: cogs }, { l: "GROSS PROFIT", v: gross, k: "t" }, { l: "Gross margin", v: pct(gross, rev) },
    { l: "OPERATING EXPENSES", k: "h" }, ...eL.map((x) => ({ l: `   ${x.l}`, v: x.v })), { l: "Total operating expenses", v: exp, k: "t" },
    { l: "NET PROFIT / (LOSS)", v: net, k: "t" }, { l: "Net margin", v: pct(net, rev) });
  const CF = [{ l: "Opening cash", v: opening, k: "t" }, { l: "OPERATING ACTIVITIES", k: "h" }, { l: "Cash received from sales", v: rev }, { l: "Operating expenses paid", v: -exp }, { l: "Stock purchases", v: -buy },
    { l: "Net cash from operating activities", v: rev - exp - buy, k: "t" }, { l: "FINANCING ACTIVITIES", k: "h" }, { l: "Owner capital introduced", v: cap }, { l: "Loans received", v: loan },
    { l: "Net cash from financing activities", v: cap + loan, k: "t" }, { l: "NET CHANGE IN CASH", v: rev - exp - buy + cap + loan, k: "t" }, { l: "Closing cash", v: closing, k: "t" }];
  const sections = [{ name: "Income Statement", type: "fin", rows: IS }, { name: "Cash Flow", type: "fin", rows: CF }];
  if (kind === "all") {
    const lt = Ls.filter((l) => l.date <= to), capA = tot(lt, "Capital"), loanA = tot(lt, "Loan"), inv = sum(P, (p) => p.qty * p.cost), assets = closing + inv, equity = assets - loanA;
    sections.push({ name: "Balance Sheet", note: `as at ${to}`, type: "fin", rows: [{ l: "ASSETS", k: "h" }, { l: "Cash and cash equivalents", v: closing }, { l: "Inventory at cost (current stock)", v: inv }, { l: "Total assets", v: assets, k: "t" },
      { l: "LIABILITIES", k: "h" }, { l: "Loans", v: loanA }, { l: "Total liabilities", v: loanA, k: "t" }, { l: "EQUITY", k: "h" }, { l: "Owner capital", v: capA }, { l: "Retained earnings", v: equity - capA },
      { l: "Total equity", v: equity, k: "t" }, { l: "Total liabilities and equity", v: loanA + equity, k: "t" }] });
  }
  if (kind !== "branch") {
    const br = B.filter((b) => kind === "all" || bt(b.id) === kind).map((b) => {
      const ss = SP.filter((s) => bid(s) === b.id), r = sum(ss, (s) => s.total), c = sum(ss, (s) => s.qty * (s.unitCost || 0)), e = sum(LP.filter((l) => l.type === "Expense" && l.branchId === b.id), (l) => l.amount);
      return [b.name, b.type === "water" ? "Water refilling" : "Hardware shop", r, c, r - c, e, r - c - e];
    });
    if (kind === "all") {
      const un = SP.filter((s) => !B.some((b) => b.id === bid(s))), ur = sum(un, (s) => s.total), uc = sum(un, (s) => s.qty * (s.unitCost || 0));
      const ue = sum(LP.filter((l) => l.type === "Expense" && !B.some((b) => b.id === l.branchId)), (l) => l.amount);
      if (ur || ue) br.push(["Head office / unallocated", "General", ur, uc, ur - uc, ue, ur - uc - ue]);
    }
    br.push(["TOTAL", "", ...[2, 3, 4, 5, 6].map((i) => sum(br, (r) => r[i]))]);
    sections.push({ name: "Branch Breakdown", type: "table", head: ["Branch", "Type", "Revenue", "COGS", "Gross profit", "Expenses", "Net profit"], rows: br, money: [2, 3, 4, 5, 6] });
  }
  sections.push({ name: "Sales Detail", type: "table", head: ["Date", "Receipt", "Branch", "Served by", "Item", "Qty", "Unit price", "Total"], money: [6, 7],
    rows: [...SP].sort((a, b) => a.date.localeCompare(b.date)).map((s) => [s.date, s.receiptNo || "-", bn(bid(s)) || "-", s.userName || "", s.productName || "", s.qty, s.unitPrice, s.total]) },
  { name: "Ledger Detail", type: "table", head: ["Date", "Type", "Description", "Branch", "Amount"], money: [4],
    rows: [...LP].sort((a, b) => a.date.localeCompare(b.date)).map((l) => [l.date, l.type, l.description || "", bn(l.branchId) || "Head office", l.amount]) });
  const label = kind === "all" ? "Whole business (all branches)" : kind === "hw" ? "Hardware shops (entity)" : kind === "wt" ? "Water refilling centers (entity)" : `${bn(branchId) || "Branch"} (${bt(branchId) === "wt" ? "water refilling" : "hardware"} branch)`;
  return { title: "Financial Statements", scope: label, from, to, sections, summary: { rev, cogs, gross, exp, net, closing } };
}

export async function makePdf(st, meta, opts = {}) {
  const jm = await import("jspdf"), am = await import("jspdf-autotable");
  const jsPDF = jm.jsPDF || jm.default?.jsPDF || jm.default;
  const autoTable = typeof am.default === "function" ? am.default : am.default?.default || am.autoTable;
  const doc = new jsPDF(pdfOpts(opts.password)), cur = meta.currency || "KES";
  const f = (v) => (typeof v === "number" ? fmt(v, cur) : v ?? "");
  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(232, 89, 12); doc.text(meta.business || "", 40, 46);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90);
  let y = 62;
  if (meta.contacts) { doc.text(meta.contacts, 40, y); y += 14; }
  doc.setDrawColor(220); doc.line(40, y, 555, y); y += 20;
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(28, 33, 40); doc.text(st.title, 40, y); y += 16;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(70);
  [`Scope: ${st.scope}`, `Period: ${st.from} to ${st.to}`, `Prepared by: ${meta.by}`, `Generated: ${meta.generated}`].forEach((t) => { doc.text(t, 40, y); y += 13; });
  y += 8;
  st.sections.forEach((sec) => {
    if (y > 730) { doc.addPage(); y = 40; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(28, 33, 40); doc.text(sec.name + (sec.note ? ` (${sec.note})` : ""), 40, y);
    const fin = sec.type === "fin";
    autoTable(doc, {
      startY: y + 8, head: [fin ? ["Item", `Amount (${cur})`] : sec.head], theme: "striped", margin: { left: 40, right: 40 },
      body: fin ? sec.rows.map((r) => [r.l, f(r.v)]) : sec.rows.map((r) => r.map((c, i) => (sec.money?.includes(i) && typeof c === "number" ? f(c) : c ?? ""))),
      styles: { fontSize: 8.5, cellPadding: 4 }, headStyles: { fillColor: [28, 33, 40] },
      columnStyles: fin ? { 1: { halign: "right" } } : Object.fromEntries((sec.money || []).map((i) => [i, { halign: "right" }])),
      didParseCell: (d) => {
        if (d.section === "head" && (fin ? d.column.index === 1 : (sec.money || []).includes(d.column.index))) d.cell.styles.halign = "right";
        if (fin && d.section === "body") {
          const k = sec.rows[d.row.index]?.k;
          if (k === "h") { d.cell.styles.fontStyle = "bold"; d.cell.styles.fillColor = [253, 234, 221]; } else if (k === "t") d.cell.styles.fontStyle = "bold";
        }
      },
    });
    y = doc.lastAutoTable.finalY + 26;
  });
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120); doc.text(`${meta.business} | ${st.title} | Page ${i} of ${n}`, 40, 820); }
  return doc;
}

export async function makeXlsx(st, meta) {
  const XLSX = await import("xlsx"), wb = XLSX.utils.book_new(), cur = meta.currency || "KES";
  st.sections.forEach((sec) => {
    const fin = sec.type === "fin";
    const top = [[meta.business], [meta.contacts || ""], [`${st.title} - ${sec.name}`], [`Scope: ${st.scope}`], [`Period: ${st.from} to ${st.to}`], [`Prepared by: ${meta.by}`], [`Generated: ${meta.generated}`], []];
    const head = fin ? ["Item", `Amount (${cur})`] : sec.head, body = fin ? sec.rows.map((r) => [r.l, r.v ?? ""]) : sec.rows;
    const ws = XLSX.utils.aoa_to_sheet([...top, head, ...body]);
    body.forEach((r, i) => (fin ? [1] : sec.money || []).forEach((c) => { const cell = ws[XLSX.utils.encode_cell({ r: top.length + 1 + i, c })]; if (cell && cell.t === "n") cell.z = "#,##0.00"; }));
    ws["!cols"] = head.map((h, i) => ({ wch: Math.min(48, Math.max(String(h).length + 2, ...body.slice(0, 200).map((r) => String(r[i] ?? "").length + 2))) }));
    XLSX.utils.book_append_sheet(wb, ws, sec.name.replace(/[\\/?*[\]:]/g, "").slice(0, 31));
  });
  return { wb, XLSX };
}
export const saveXlsx = ({ wb, XLSX }, name) => XLSX.writeFile(wb, name);
export const xlsxBlob = ({ wb, XLSX }) => new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

// ---------- invoices ----------
const todayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
export const invStatus = (inv, t = todayStr()) => (inv.status === "cancelled" ? "Cancelled" : (inv.paid || 0) >= inv.total - 0.005 ? "Paid" : inv.dueDate && inv.dueDate < t ? "Overdue" : (inv.paid || 0) > 0 ? "Partially paid" : "Unpaid");
export const invTotals = (items, rate) => { const total = sum(items, (x) => x.total), vat = rate > 0 ? total - total / (1 + rate / 100) : 0; return { total, vat, net: total - vat }; };

export async function makeInvoicePdf(inv, meta, branchName = "", opts = {}) {
  const jm = await import("jspdf"), am = await import("jspdf-autotable");
  const jsPDF = jm.jsPDF || jm.default?.jsPDF || jm.default;
  const autoTable = typeof am.default === "function" ? am.default : am.default?.default || am.autoTable;
  const doc = new jsPDF(pdfOpts(opts.password)), cur = meta.currency || "KES", f = (v) => fmt(v, cur);
  const { vat, net } = invTotals(inv.items || [], inv.vatRate), bal = inv.total - (inv.paid || 0);
  doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(232, 89, 12); doc.text(meta.business || "", 40, 48);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90); doc.text(doc.splitTextToSize(meta.contacts || "", 300), 40, 64);
  doc.setFont("helvetica", "bold"); doc.setFontSize(24); doc.setTextColor(28, 33, 40); doc.text("INVOICE", 555, 48, { align: "right" });
  doc.setFontSize(11); doc.setTextColor(232, 89, 12); doc.text(inv.no, 555, 66, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(70);
  [`Date: ${inv.date}`, `Due: ${inv.dueDate}`, `Status: ${invStatus(inv)}`].forEach((t, i) => doc.text(t, 555, 82 + i * 13, { align: "right" }));
  doc.setDrawColor(220); doc.line(40, 124, 555, 124);
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(120); doc.text("BILL TO", 40, 144); doc.text("ISSUED BY", 330, 144);
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(28, 33, 40); doc.text(inv.customerName || "", 40, 160); doc.text(inv.userName || "", 330, 160);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(70);
  [inv.customerPhone, inv.customerEmail, inv.customerAddress].filter(Boolean).forEach((t, i) => doc.text(String(t), 40, 174 + i * 12));
  if (branchName) doc.text(branchName, 330, 174);
  autoTable(doc, {
    startY: 218, theme: "striped", margin: { left: 40, right: 40 }, styles: { fontSize: 9, cellPadding: 5 }, headStyles: { fillColor: [28, 33, 40] },
    head: [["Description", "Receipt", "Qty", "Unit price", "Amount"]], body: (inv.items || []).map((x) => [x.desc, x.receiptNo || "-", x.qty, f(x.price), f(x.total)]),
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    didParseCell: (d) => { if (d.section === "head" && d.column.index >= 2) d.cell.styles.halign = "right"; },
  });
  let y = doc.lastAutoTable.finalY + 20;
  if (y > 640) { doc.addPage(); y = 50; }
  const line = (l, v, bold) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(bold ? 11 : 9); doc.setTextColor(bold ? 232 : 70, bold ? 89 : 70, bold ? 12 : 70); doc.text(l, 400, y); doc.text(v, 555, y, { align: "right" }); y += bold ? 18 : 14; };
  if (vat > 0) { line("Subtotal (excl. VAT)", f(net)); line(`VAT (${inv.vatRate}%) included`, f(vat)); }
  line("Total", f(inv.total), true); line("Amount paid", f(inv.paid || 0)); line("Balance due", f(bal), true);
  if ((inv.payments || []).length) {
    autoTable(doc, { startY: y + 6, theme: "grid", margin: { left: 40, right: 40 }, styles: { fontSize: 8.5, cellPadding: 4 }, headStyles: { fillColor: [90, 100, 110] },
      head: [["Payment date", "Method", "Received by", "Amount"]], body: inv.payments.map((p) => [p.date, p.method, p.by || "", f(p.amount)]), columnStyles: { 3: { halign: "right" } },
      didParseCell: (d) => { if (d.section === "head" && d.column.index === 3) d.cell.styles.halign = "right"; } });
    y = doc.lastAutoTable.finalY + 16;
  }
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(70);
  [inv.notes && `Notes: ${inv.notes}`, inv.payInfo && `Payment details: ${inv.payInfo}`].filter(Boolean).forEach((t) => { const ls = doc.splitTextToSize(t, 515); doc.text(ls, 40, y); y += ls.length * 12 + 4; });
  doc.setFont("helvetica", "bold"); doc.setTextColor(120); doc.text("Thank you for your business.", 40, y + 10);
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120); doc.text(`${meta.business} | ${inv.no} | Page ${i} of ${n}`, 40, 820); }
  return doc;
}
