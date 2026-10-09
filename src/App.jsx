import { useEffect, useRef, useState } from "react";
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail,
  GoogleAuthProvider, signInWithPopup,
} from "firebase/auth";
import {
  collection, doc, onSnapshot, setDoc, addDoc, updateDoc, deleteDoc,
  runTransaction, serverTimestamp, query, where,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import pkg from "../package.json";
import { buildStatements, makePdf, makeXlsx, saveXlsx, xlsxBlob, makeInvoicePdf, invStatus, invTotals } from "./reports.js";
import ShareModal from "./Share.jsx";

/* ---------- helpers ---------- */
let pendingName = "";
const CUR = "KES"; // change currency here
const CC = "254"; // default country code for WhatsApp numbers typed without one (Kenya)
const APP_VERSION = pkg.version;
const IDLE = globalThis.__IDLE_MS ?? 600000, WARN = Math.min(60000, IDLE / 4); // auto sign-out after 10 minutes without activity
const DOC = { get: null }; // supplies business / staff details to every exported document
const LOSS_WARN = 5, LOSS_BAD = 10; // % of water unaccounted for that shows "Watch" / "High loss"
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const money = (n) => `${CUR} ${(+n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const ago = (n) => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4 - n * 864e5).toISOString().slice(0, 10);
const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { alert(e.message || String(e)); } };
const csvText = (rows0) => {
  const m = DOC.get?.();
  const rows = m ? [[m.business], [m.contacts], [`Prepared by: ${m.by}`], [`Generated: ${m.generated}`], [], ...rows0] : rows0;
  return "\ufeff" + rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
};
const csv = (rows0, name) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csvText(rows0)], { type: "text/csv" }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
function useCol(name, uid, skip, field = "userId") {
  const [d, setD] = useState([]);
  useEffect(() => {
    if (skip) { setD([]); return; }
    const ref = collection(db, name);
    return onSnapshot(uid ? query(ref, where(field, "==", uid)) : ref,
      (s) => setD(s.docs.map((x) => ({ id: x.id, ...x.data() }))),
      (e) => console.error(name, e));
  }, [name, uid, skip, field]);
  return d;
}

const BrandName = () => <span className="lh-1">Hardware &amp; Water<small className="d-block fw-normal opacity-75" style={{ fontSize: ".72rem" }}>Business Suite</small></span>;
const Spin = () => <div className="d-flex vh-100 justify-content-center align-items-center"><div className="spinner-border text-primary" /></div>;
const Icon = ({ n }) => <i className={`bi bi-${n} me-1`} />;
const Stat = ({ i, l, v }) => (
  <div className="card h-100"><div className="stat"><div className="stat-ico"><i className={`bi bi-${i}`} /></div><div><div className="stat-l">{l}</div><div className="stat-v">{v}</div></div></div></div>
);
const ICONS = { Name: "tag", SKU: "upc-scan", Category: "collection", Quantity: "hash", "Cost price": "cash-stack", "Selling price": "currency-exchange",
  "Minimum stock": "exclamation-triangle", Date: "calendar-event", "Report date (clear for all)": "calendar-event", Description: "card-text",
  Amount: "cash-coin", Location: "geo-alt", Phone: "telephone", "Full name": "person", Email: "envelope", Litres: "droplet", Price: "cash-coin", "Opening litres": "droplet", "Litres received": "truck", "Closing litres": "droplet-half", "Wasted litres": "trash3", "Cash collected": "wallet2", Notes: "chat-left-text", "Business name": "building", Tagline: "chat-quote", Address: "geo-alt", "KRA PIN": "card-heading", "Receipt footer": "card-text", "Customer name": "person-badge", "Due date": "calendar-check", "VAT rate (%)": "percent", "Payment terms (days)": "calendar-check", "Payment details": "bank" };
const Field = ({ label, cls = "col-sm-6 col-lg-3", suffix, ...p }) => (
  <div className={cls}><label className="form-label small mb-1">{label}</label>
    <div className="input-group"><span className="input-group-text"><i className={`bi bi-${ICONS[label] || "pencil"}`} /></span><input className="form-control" {...p} />{suffix}</div></div>
);
const Avatar = ({ u, size = "" }) => u?.photoURL
  ? <img src={u.photoURL} alt="" referrerPolicy="no-referrer" className={`avatar ${size}`} />
  : <span className={`avatar ${size}`}>{((u?.name || u?.email || "?").trim()[0] || "?").toUpperCase()}</span>;
const Verified = () => <i className="bi bi-patch-check-fill verified-tick" title="Email verified" aria-label="Email verified" />;
const VerifiedEmail = ({ email, cls = "" }) => email ? <span className={`verified-email ${cls}`}><span className="verified-text">{email}</span><Verified /></span> : null;
const toAvatar = (file) => new Promise((res, rej) => {
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => {
    const c = document.createElement("canvas"); c.width = c.height = 160;
    const m = Math.min(img.width, img.height);
    c.getContext("2d").drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, 160, 160);
    URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.8));
  };
  img.onerror = () => rej(new Error("Choose a valid image file."));
  img.src = url;
});

function Pager({ p, pages, size, sizes, total, setPage, setSize }) {
  const w = []; for (let i = Math.max(1, p - 2); i <= Math.min(pages, p + 2); i++) w.push(i);
  return (
    <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 p-3 border-top">
      <div className="d-flex align-items-center gap-2 small text-muted">
        <select className="form-select form-select-sm w-auto" value={size} aria-label="Rows per page" onChange={(e) => { setSize(+e.target.value); setPage(1); }}>
          {sizes.map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
        <span>{(p - 1) * size + 1}-{Math.min(p * size, total)} of {total}</span>
      </div>
      <ul className="pagination pagination-sm mb-0">
        <li className={`page-item ${p === 1 ? "disabled" : ""}`}><button className="page-link" aria-label="Previous page" onClick={() => setPage(p - 1)}><i className="bi bi-chevron-left" /></button></li>
        {w.map((i) => <li key={i} className={`page-item d-none d-sm-block ${i === p ? "active" : ""}`}><button className="page-link" onClick={() => setPage(i)}>{i}</button></li>)}
        <li className="page-item d-sm-none disabled"><span className="page-link">{p} / {pages}</span></li>
        <li className={`page-item ${p === pages ? "disabled" : ""}`}><button className="page-link" aria-label="Next page" onClick={() => setPage(p + 1)}><i className="bi bi-chevron-right" /></button></li>
      </ul>
    </div>
  );
}
function usePage(list, init = 10, sizes = [10, 25, 50]) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(init);
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(page, pages);
  const pager = list.length > sizes[0] ? <Pager {...{ p, pages, size, sizes, total: list.length, setPage, setSize }} /> : null;
  return { rows: list.slice((p - 1) * size, p * size), pager };
}

function Leaderboard({ sales, users, branches, title = "Top performing staff" }) {
  const m = {};
  sales.forEach((s) => { const x = (m[s.userId] = m[s.userId] || { id: s.userId, rev: 0, units: 0, n: 0 }); x.rev += s.total; x.units += s.qty; x.n += 1; });
  const rows = Object.values(m).sort((a, b) => b.rev - a.rev);
  const top = rows[0]?.rev || 1;
  const lp = usePage(rows, 5, [5, 10, 25]);
  return (
    <div className="card h-100">
      <div className="card-header fw-semibold"><Icon n="trophy" />{title}</div>
      <ul className="list-group list-group-flush">
        {lp.rows.map((r) => {
          const i = rows.indexOf(r), u = users.find((x) => x.id === r.id) || { name: "Former staff" };
          const b = branches.find((x) => x.id === u.branchId);
          return (
            <li key={r.id} className="list-group-item d-flex align-items-center gap-3 py-3">
              <span className="rank" style={i < 3 ? { background: ["#fdecc8", "#e8ebef", "#f6dfcc"][i], color: ["#a16207", "#475569", "#9a3412"][i] } : {}}>{i === 0 ? <i className="bi bi-trophy-fill" /> : i + 1}</span>
              <Avatar u={u} />
              <div className="flex-fill" style={{ minWidth: 0 }}>
                <div className="d-flex justify-content-between gap-2">
                  <span className="fw-semibold text-truncate">{u.name || u.email}{i === 0 && <span className="badge text-bg-warning ms-2">Top performer</span>}</span>
                  <span className="fw-semibold text-nowrap">{money(r.rev)}</span>
                </div>
                <div className="progress my-1" style={{ height: 6 }}><div className="progress-bar" style={{ width: `${(r.rev / top) * 100}%`, background: "#e8590c" }} /></div>
                <div className="small text-muted">{b ? `${b.name}, ` : ""}{r.units} units, {r.n} sales</div>
              </div>
            </li>
          );
        })}
        {!rows.length && <li className="list-group-item text-center text-muted py-4">No sales in this period.</li>}
      </ul>
      {lp.pager}
    </div>
  );
}

const serial = (p, n) => `${p}-${String(n).padStart(6, "0")}`;
function useBiz() {
  const [b, setB] = useState({});
  useEffect(() => onSnapshot(doc(db, "settings", "business"), (s) => setB(s.exists() ? s.data() : {}), () => setB({})), []);
  return { name: b.name || "Your Business Name", tagline: b.tagline || "", address: b.address || "", phone: b.phone || "", email: b.email || "", pin: b.pin || "", footer: b.footer || "Thank you for your business!", vatRate: Math.max(0, +b.vatRate || 0), dueDays: b.dueDays == null || b.dueDays === "" || !Number.isFinite(+b.dueDays) ? 14 : Math.max(0, Math.floor(+b.dueDays)), payInfo: b.payInfo || "" };
}
function ReceiptBody({ s, biz, branch }) {
  const d = s.createdAt?.toDate ? s.createdAt.toDate() : s.createdAt instanceof Date ? s.createdAt : null;
  return (
    <div className="receipt rc-print">
      <div className="text-center border-bottom pb-3 mb-3">
        <div className="rc-logo"><i className={`bi bi-${s.litres ? "droplet-half" : "tools"}`} /></div>
        <h5 className="fw-bold mb-0">{biz.name}</h5>
        {biz.tagline && <div className="small text-muted">{biz.tagline}</div>}
        {biz.address && <div className="small mt-1"><i className="bi bi-geo-alt me-1" />{biz.address}</div>}
        {(biz.phone || biz.email) && <div className="small">{biz.phone && <span className="me-2"><i className="bi bi-telephone me-1" />{biz.phone}</span>}{biz.email && <span><i className="bi bi-envelope me-1" />{biz.email}</span>}</div>}
        {biz.pin && <div className="small">PIN: {biz.pin}</div>}
      </div>
      <div className="d-flex justify-content-between align-items-center"><span className="fw-bold">RECEIPT</span><span className="fw-bold text-primary">{s.receiptNo || "Not numbered"}</span></div>
      <div className="small text-muted d-flex justify-content-between gap-2"><span>{s.date}{d ? `, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</span>{branch && <span>{branch.name}</span>}</div>
      <table className="table table-sm mt-3 mb-2">
        <thead><tr><th>Item</th><th className="text-end">Qty</th><th className="text-end">Price</th><th className="text-end">Total</th></tr></thead>
        <tbody><tr><td>{s.productName}{s.litres ? <div className="small text-muted">{s.litres} L</div> : null}</td><td className="text-end">{s.qty}</td><td className="text-end">{money(s.unitPrice)}</td><td className="text-end">{money(s.total)}</td></tr></tbody>
      </table>
      <div className="d-flex justify-content-between fs-5 fw-bold border-top pt-2"><span>TOTAL</span><span>{money(s.total)}</span></div>
      <div className="mt-3 small"><i className="bi bi-person-check me-1" />Served by: <b>{s.userName}</b></div>
      <div className="text-center small text-muted mt-3 border-top pt-3">{biz.footer}</div>
    </div>
  );
}
function Receipt({ sale, onClose }) {
  const biz = useBiz(), B = useCol("branches");
  return (
    <div className="modal d-block" style={{ background: "rgba(15,20,26,.55)" }} onClick={onClose}>
      <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header d-print-none py-2"><h6 className="modal-title"><Icon n="receipt" />Receipt {sale.receiptNo || ""}</h6><button className="btn-close" onClick={onClose} aria-label="Close" /></div>
          <div className="modal-body bg-light"><ReceiptBody s={sale} biz={biz} branch={B.find((b) => b.id === sale.branchId)} /></div>
          <div className="modal-footer d-print-none"><button className="btn btn-primary" onClick={() => window.print()}><Icon n="printer" />Print / Save as PDF</button><button className="btn btn-light" onClick={onClose}><Icon n="x-lg" />Close</button></div>
        </div>
      </div>
    </div>
  );
}

/* ---------- useMeta, alerts, statements ---------- */
function useMeta(me) {
  const biz = useBiz(), B = useCol("branches");
  const br = B.find((b) => b.id === me.branchId);
  return () => ({
    business: biz.name, currency: CUR, generated: new Date().toLocaleString(),
    contacts: [biz.address, biz.phone, biz.email, biz.pin && `PIN: ${biz.pin}`].filter(Boolean).join("  |  "),
    by: `${me.name || me.email} (${me.role === "admin" ? "Administrator" : "Staff"}), ${br ? br.name : "All branches"}`,
  });
}

/* ---------- notifications (with read state) ---------- */
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
function Alerts({ me, admin, water, go }) {
  const [open, setOpen] = useState(false);
  const P = useCol("products", undefined, water);
  const LG = useCol("waterLogs", admin ? undefined : me.branchId, !admin && !water, admin ? "userId" : "branchId");
  const WS = useCol("waterSales", undefined, !admin);
  const IV = useCol("invoices", admin ? undefined : me.branchId, !admin && !me.branchId, "branchId");
  const y = ago(1), t = today(), items = [];
  const low = P.filter((p) => p.qty <= p.minQty);
  if (low.length) items.push({ k: hash(`low:${low.map((p) => p.id).sort().join(",")}`), i: "exclamation-triangle", t: `${low.length} product${low.length > 1 ? "s" : ""} low or out of stock`, to: "products" });
  if (admin) {
    const flagged = LG.filter((l) => l.date >= ago(6) && (l.lossPct > LOSS_BAD || l.cashDiff < 0));
    if (flagged.length) items.push({ k: hash(`flag:${flagged.map((l) => l.id).sort().join(",")}`), i: "droplet-half", t: `${flagged.length} water close${flagged.length > 1 ? "s" : ""} flagged for loss or cash shortage (7 days)`, to: "water" });
    const done = new Set(LG.map((l) => `${l.branchId}_${l.date}`));
    const miss = [...new Set(WS.filter((s) => s.date === y && !done.has(`${s.branchId}_${y}`)).map((s) => s.branchId))].sort();
    if (miss.length) items.push({ k: hash(`miss:${y}:${miss.join(",")}`), i: "calendar-x", t: `${miss.length} water branch${miss.length > 1 ? "es" : ""} did not close yesterday`, to: "water" });
  }
  if (water && !LG.some((l) => l.date === t)) items.push({ k: hash(`close:${t}`), i: "clipboard-check", t: "Today's daily close is not done yet", to: "water" });
  const over = IV.filter((i) => invStatus(i, t) === "Overdue");
  if (over.length) items.push({ k: hash(`inv:${over.map((i) => i.id).sort().join(",")}`), i: "file-earmark-text", t: `${over.length} invoice${over.length > 1 ? "s are" : " is"} overdue`, to: "invoices" });
  const read = me.readAlerts || {}, unread = items.filter((it) => !read[it.k]);
  const save = (keys) => {
    const next = {};
    items.forEach((it) => { if (read[it.k] || keys.includes(it.k)) next[it.k] = true; });
    updateDoc(doc(db, "users", me.id), { readAlerts: next }).catch(() => {});
  };
  return (
    <div className="position-relative">
      <button className="btn btn-light position-relative" onClick={() => setOpen(!open)} aria-label="Notifications"><i className={`bi bi-bell${unread.length ? "-fill" : ""}`} />
        {unread.length > 0 && <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">{unread.length}</span>}</button>
      {open && (
        <div className="card shadow position-absolute end-0 mt-2" style={{ width: 330, maxWidth: "88vw", zIndex: 1050 }}>
          <div className="card-header d-flex align-items-center py-2">
            <span className="fw-semibold me-auto"><i className="bi bi-bell me-1" />Notifications</span>
            <button className="btn btn-sm btn-link p-0 text-decoration-none" disabled={!unread.length} onClick={() => save(unread.map((it) => it.k))}><i className="bi bi-check2-all me-1" />Mark all as read</button>
          </div>
          <ul className="list-group list-group-flush">
            {items.map((it) => {
              const isRead = !!read[it.k];
              return (
                <li key={it.k} role="button" className={`list-group-item list-group-item-action d-flex gap-2 align-items-start ${isRead ? "text-muted" : "fw-semibold"}`}
                  onClick={() => { if (!isRead) save([it.k]); go(it.to); setOpen(false); }}>
                  <i className={`bi bi-${isRead ? "check2-all" : it.i} ${isRead ? "" : "text-primary"}`} /><span className="small flex-fill">{it.t}</span>
                  {!isRead && <span className="badge rounded-pill bg-primary p-1"><span className="visually-hidden">unread</span></span>}
                </li>
              );
            })}
            {!items.length && <li className="list-group-item text-muted small"><i className="bi bi-check-circle text-success me-1" />No notifications.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------- document preview (shown before any download) ---------- */
const PV = { set: null };
const showPreview = (st, base) => PV.set?.({ st, base });
const stToCsv = (st) => [[st.title], [`Scope: ${st.scope}`], [`Period: ${st.from} to ${st.to}`], [],
  ...st.sections.flatMap((s) => [[s.name], ...(s.type === "fin" ? [["Item", `Amount (${CUR})`], ...s.rows.map((r) => [r.l, r.v ?? ""])] : [s.head, ...s.rows]), []])];
const previewSales = (rows, base, title, scope, day) => showPreview({ title, scope, from: day || "All dates", to: day || today(), sections: [{ name: "Sales", type: "table", money: [5, 6],
  head: ["Receipt", "Date", "Served by", "Item", "Qty", "Unit price", "Total"],
  rows: [...rows.map((s) => [s.receiptNo || "-", s.date, s.userName, s.productName, s.qty, s.unitPrice, s.total]), ["", "", "", "", "", "Grand total", rows.reduce((a, s) => a + s.total, 0)]] }] }, base);

function PaperView({ st, m }) {
  return (
    <div className="paper">
      <h4 className="fw-bold mb-0" style={{ color: "#e8590c" }}>{m.business}</h4>
      <div className="small text-muted">{m.contacts}</div><hr />
      <h5 className="fw-bold">{st.title}</h5>
      <div className="small text-muted mb-3">Scope: {st.scope}<br />Period: {st.from} to {st.to}<br />Prepared by: {m.by}<br />Generated: {m.generated}</div>
      {st.sections.map((s) => <StmtSection key={s.name} sec={s} />)}
    </div>
  );
}
function SheetView({ st, m }) {
  const [i, setI] = useState(0);
  const sec = st.sections[Math.min(i, st.sections.length - 1)], fin = sec.type === "fin";
  const head = fin ? ["Item", `Amount (${CUR})`] : sec.head, body = fin ? sec.rows.map((r) => [r.l, r.v ?? ""]) : sec.rows, mon = fin ? [1] : sec.money || [];
  const pg = usePage(body);
  const nf = (c, j) => (mon.includes(j) && typeof c === "number" ? c.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : c ?? "");
  return (
    <div className="card">
      <div className="card-header p-2 d-flex gap-1 flex-wrap">
        {st.sections.map((s, k) => <button key={s.name} className={`btn btn-sm ${k === i ? "btn-success" : "btn-outline-secondary"}`} onClick={() => setI(k)}><i className="bi bi-file-earmark-spreadsheet me-1" />{s.name}</button>)}
      </div>
      <div className="table-responsive"><table className="table table-bordered table-sm mb-0 sheet"><tbody>
        {[m.business, m.contacts, `${st.title} - ${sec.name}`, `Scope: ${st.scope}`, `Period: ${st.from} to ${st.to}`, `Prepared by: ${m.by}`, `Generated: ${m.generated}`].map((t, k) => <tr key={k}><td colSpan={head.length} className={k < 3 ? "fw-semibold" : "text-muted"}>{t}</td></tr>)}
        <tr className="table-success fw-bold">{head.map((h, j) => <td key={j} className={mon.includes(j) ? "text-end" : ""}>{h}</td>)}</tr>
        {pg.rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className={mon.includes(j) ? "text-end" : ""}>{nf(c, j)}</td>)}</tr>)}
      </tbody></table></div>{pg.pager}
    </div>
  );
}
function PreviewHost() {
  const [p, setP] = useState(null), [view, setView] = useState("doc"), [busy, setBusy] = useState(""), [sharing, setSharing] = useState(false);
  useEffect(() => { PV.set = (x) => { setView("doc"); setSharing(false); setP(x); }; return () => { PV.set = null; }; }, []);
  if (!p) return null;
  const { st, base } = p, m = DOC.get?.() || {};
  const acts = [["PDF", "file-earmark-pdf", async () => (await makePdf(st, m)).save(`${base}.pdf`)], ["Excel", "file-earmark-excel", async () => saveXlsx(await makeXlsx(st, m), `${base}.xlsx`)], ["CSV", "filetype-csv", async () => csv(stToCsv(st), `${base}.csv`)]];
  const go = async (label, fn) => { setBusy(label); try { await fn(); } catch (e) { alert(e.message || String(e)); } setBusy(""); };
  const build = async (fmt, pw) => fmt === "pdf" ? (await makePdf(st, m, { password: pw })).output("blob") : fmt === "xlsx" ? xlsxBlob(await makeXlsx(st, m)) : new Blob([csvText(stToCsv(st))], { type: "text/csv" });
  return (
    <>
    <div className="modal d-block" style={{ background: "rgba(15,20,26,.55)", zIndex: 1500 }} onClick={() => setP(null)}>
      <div className="modal-dialog modal-xl modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header py-2"><h6 className="modal-title"><Icon n="eye" />Preview: {st.title}</h6><button className="btn-close" onClick={() => setP(null)} aria-label="Close" /></div>
          <div className="modal-body bg-light">
            <ul className="nav nav-pills gap-1 mb-3">
              <li className="nav-item"><button className={`nav-link ${view === "doc" ? "active" : ""}`} onClick={() => setView("doc")}><i className="bi bi-file-earmark-text me-1" />Document (PDF)</button></li>
              <li className="nav-item"><button className={`nav-link ${view === "sheet" ? "active" : ""}`} onClick={() => setView("sheet")}><i className="bi bi-file-earmark-spreadsheet me-1" />Spreadsheet (Excel / CSV)</button></li>
            </ul>
            {view === "doc" ? <PaperView st={st} m={m} /> : <SheetView st={st} m={m} />}
          </div>
          <div className="modal-footer d-flex flex-wrap gap-2">
            <span className="text-muted small me-auto"><i className="bi bi-info-circle me-1" />Check the document, then download it or share it securely.</span>
            {acts.map(([l, i, fn]) => <button key={l} className="btn btn-primary" disabled={!!busy} onClick={() => go(l, fn)}>{busy === l ? <span className="spinner-border spinner-border-sm me-1" /> : <i className={`bi bi-${i} me-1`} />}Download {l}</button>)}
            <button className="btn btn-success" disabled={!!busy} onClick={() => setSharing(true)}><i className="bi bi-share me-1" />Share securely</button>
            <button className="btn btn-light" onClick={() => setP(null)}><i className="bi bi-x-lg me-1" />Close</button>
          </div>
        </div>
      </div>
    </div>
    {sharing && <ShareModal title={st.title} base={base} business={m.business || ""} detail={`${st.scope}, ${st.from} to ${st.to}`} cc={CC} formats={[["pdf", "PDF"], ["xlsx", "Excel"], ["csv", "CSV"]]} build={build} onClose={() => setSharing(false)} />}
    </>
  );
}

const rangeOf = (p, c) => {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth(), t = today(), d = (yy, mm, dd) => fmtD(new Date(yy, mm, dd));
  if (p === "month") return { from: d(y, m, 1), to: t };
  if (p === "lastmonth") return { from: d(y, m - 1, 1), to: d(y, m, 0) };
  if (p === "quarter") return { from: d(y, m - (m % 3), 1), to: t };
  if (p === "year") return { from: d(y, 0, 1), to: t };
  if (p === "lastyear") return { from: d(y - 1, 0, 1), to: d(y - 1, 11, 31) };
  if (p === "all") return { from: "2000-01-01", to: t };
  return c;
};
function StmtSection({ sec }) {
  const pg = usePage(sec.type === "table" ? sec.rows : []);
  const right = (j) => (sec.money || []).includes(j);
  return (
    <div className="card mb-3">
      <div className="card-header fw-semibold">{sec.name}{sec.note && <span className="text-muted fw-normal ms-2">({sec.note})</span>}</div>
      <div className="table-responsive"><table className="table table-sm mb-0 align-middle">
        {sec.type === "fin" ? (
          <tbody>{sec.rows.map((r, i) => (
            <tr key={i} className={r.k === "h" ? "table-light fw-bold" : r.k === "t" ? "fw-semibold" : ""}>
              <td style={{ whiteSpace: "pre-wrap" }}>{r.l}</td>
              <td className={`text-end ${typeof r.v === "number" && r.v < 0 ? "text-danger" : ""}`}>{typeof r.v === "number" ? money(r.v) : r.v ?? ""}</td>
            </tr>))}</tbody>
        ) : (
          <>
            <thead><tr>{sec.head.map((h, j) => <th key={j} className={right(j) ? "text-end" : ""}>{h}</th>)}</tr></thead>
            <tbody>
              {pg.rows.map((r, i) => <tr key={i} className={r[0] === "TOTAL" ? "fw-bold" : ""}>{r.map((c, j) => <td key={j} className={right(j) ? "text-end" : ""}>{right(j) && typeof c === "number" ? money(c) : c}</td>)}</tr>)}
              {!sec.rows.length && <tr><td colSpan={sec.head.length} className="text-center text-muted py-3">No records in this period.</td></tr>}
            </tbody>
          </>
        )}
      </table></div>{pg.pager}
    </div>
  );
}
function Statements({ me }) {
  const H = useCol("sales"), W = useCol("waterSales"), L = useCol("ledger"), P = useCol("products"), B = useCol("branches"), U = useCol("users");
  const [sc, setSc] = useState("all"), [pr, setPr] = useState("month"), [cu, setCu] = useState({ from: ago(29), to: today() });
  const { from, to } = rangeOf(pr, cu);
  const scope = sc.startsWith("b:") ? { kind: "branch", branchId: sc.slice(2) } : { kind: sc };
  const bid = (s) => s.branchId ?? U.find((u) => u.id === s.userId)?.branchId ?? "";
  const st = from <= to ? buildStatements({ H, W, L, P, B, bid, scope, from, to }) : null;
  const dl = () => {
    if (!st) return;
    showPreview(st, `financial-statements-${st.scope.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${from}-to-${to}`);
  };
  const fin = st ? st.sections.filter((s) => s.type === "fin") : [], rest = st ? st.sections.filter((s) => s.type !== "fin") : [];
  return (
    <>
      <div className="card card-body mb-3">
        <h6 className="fw-bold mb-3"><Icon n="file-earmark-bar-graph" />Financial statements</h6>
        <div className="row g-2 align-items-end">
          <div className="col-md-4"><label className="form-label small mb-1">Business entity / branch</label><div className="input-group"><span className="input-group-text"><i className="bi bi-diagram-3" /></span>
            <select className="form-select" value={sc} onChange={(e) => setSc(e.target.value)}>
              <option value="all">Whole business</option>
              <optgroup label="Business entities"><option value="hw">Hardware shops</option><option value="wt">Water refilling centers</option></optgroup>
              <optgroup label="Branches">{B.map((b) => <option key={b.id} value={`b:${b.id}`}>{b.name} ({b.type === "water" ? "water" : "hardware"})</option>)}</optgroup>
            </select></div></div>
          <div className="col-md-3"><label className="form-label small mb-1">Period</label><div className="input-group"><span className="input-group-text"><i className="bi bi-calendar-range" /></span>
            <select className="form-select" value={pr} onChange={(e) => setPr(e.target.value)}>
              {[["month", "This month"], ["lastmonth", "Last month"], ["quarter", "This quarter"], ["year", "This year"], ["lastyear", "Last year"], ["all", "All time"], ["custom", "Custom range"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></div></div>
          {pr === "custom" && <><Field cls="col-6 col-md-2" label="Date" type="date" value={cu.from} onChange={(e) => setCu({ ...cu, from: e.target.value })} /><Field cls="col-6 col-md-2" label="Date" type="date" value={cu.to} onChange={(e) => setCu({ ...cu, to: e.target.value })} /></>}
          <div className="col-12 col-md d-flex gap-2 justify-content-md-end">
            <button className="btn btn-primary" disabled={!st} onClick={dl}><Icon n="eye" />Preview &amp; download</button>
          </div>
        </div>
        <div className="small text-muted mt-2">Showing {from} to {to}. Capital, loans, stock purchases and expenses are allocated by the Branch field on each finance entry; entries marked General / head office appear only under Whole business.</div>
      </div>
      {!st && <div className="alert alert-warning">The start date must be before the end date.</div>}
      {st && (
        <>
          <div className="row g-3 mb-3">
            {[["cash-coin", "Revenue", money(st.summary.rev)], ["graph-up-arrow", "Gross profit", money(st.summary.gross)], ["receipt", "Operating expenses", money(st.summary.exp)], ["trophy", "Net profit", money(st.summary.net)]]
              .map(([i, l, v]) => <div className="col-6 col-lg-3" key={l}><Stat i={i} l={l} v={v} /></div>)}
          </div>
          <div className="row g-3">{fin.map((s) => <div className="col-xl-6" key={s.name}><StmtSection sec={s} /></div>)}</div>
          {rest.map((s) => <StmtSection key={s.name} sec={s} />)}
        </>
      )}
    </>
  );
}

/* ---------- footer and version history ---------- */
const APP_FULL = "Hardware & Water Business Suite";
const APP_DATE = "9 Oct 2026";
const CHANGELOG = [
  ["2.8.1", "Shared PDFs unlock automatically with the last 4 digits of the recipient's WhatsApp number."],
  ["2.8.0", "Share reports, statements and invoices securely by WhatsApp, email or any app, with optional PDF password protection and a confidentiality notice."],
  ["2.7.0", "All users are verified the moment they sign in; verified checkmark shown beside every staff email."],
  ["2.6.0", "Invoicing: auto-numbered invoices generated on request from sales, payments tracking, overdue alerts, printable and PDF invoices, VAT and payment terms."],
  ["2.5.0", "Footer with copyright, credits and this version history."],
  ["2.4.0", "Read / unread notifications, preview before every download, new app name, icons on buttons."],
  ["2.3.0", "Financial statements by branch or entity in PDF and Excel, document headers, alerts bell, 10-minute auto sign-out."],
  ["2.2.0", "Numbered printable receipts, business settings, daily / weekly / monthly / yearly charts per entity and branch."],
  ["2.1.0", "Water refilling centers: sales, daily close, loss control and price list, with hardware and water branch types."],
  ["2.0.0", "Pagination, profile photos, branches with staff, top-performing staff, redesigned forms."],
  ["1.4.0", "Automatic profile creation, remove-access flow, sample data and admin set-up commands."],
  ["1.3.0", "Google sign-in."],
  ["1.2.0", "New design with sidebar layout and Firebase configuration."],
  ["1.1.0", "Analytics and automatic insights."],
  ["1.0.0", "First release: login, products, sales, profiles, admin management and CSV downloads."],
];
function VersionModal({ onClose }) {
  return (
    <div className="modal d-block" style={{ background: "rgba(15,20,26,.55)", zIndex: 1500 }} onClick={onClose}>
      <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header py-2"><h6 className="modal-title"><Icon n="clock-history" />Version history</h6><button className="btn-close" onClick={onClose} aria-label="Close" /></div>
          <div className="modal-body">
            <div className="mb-3"><div className="fw-bold">{APP_FULL}</div><div className="small text-muted">Current version {APP_VERSION}, released {APP_DATE}</div></div>
            <ul className="list-group list-group-flush">
              {CHANGELOG.map(([v, t]) => (
                <li key={v} className="list-group-item px-0 d-flex gap-3">
                  <span className={`badge align-self-start ${v === APP_VERSION ? "text-bg-primary" : "text-bg-light border"}`}>v{v}</span>
                  <span className="small">{t}{v === APP_VERSION && <span className="badge text-bg-success ms-2">Current</span>}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="modal-footer"><button className="btn btn-light" onClick={onClose}><Icon n="x-lg" />Close</button></div>
        </div>
      </div>
    </div>
  );
}
function Footer() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <footer className="app-footer d-flex flex-column flex-lg-row align-items-center justify-content-between gap-1 text-center">
        <span><i className="bi bi-c-circle me-1" />{new Date().getFullYear()} {APP_FULL}. All rights reserved.</span>
        <span>
          <i className="bi bi-code-slash me-1" />Designed and developed by{" "}
          <a href="https://muindikelvin.github.io" target="_blank" rel="noopener noreferrer">MuindiKelvin</a>{" "}
          (<a href="https://muindikelvin.github.io" target="_blank" rel="noopener noreferrer">muindikelvin.github.io</a>)
        </span>
        <button className="btn btn-link btn-sm p-0 text-decoration-none" onClick={() => setOpen(true)} title="View version history"><i className="bi bi-tag me-1" />Version {APP_VERSION}</button>
      </footer>
      {open && <VersionModal onClose={() => setOpen(false)} />}
    </>
  );
}

/* ---------- app root ---------- */
export default function App() {
  const [user, setUser] = useState(undefined);
  const [me, setMe] = useState(undefined);
  const [err, setErr] = useState("");
  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setErr(""); if (!u) setMe(undefined); }), []);
  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, "users", user.uid),
      (s) => {
        if (s.exists()) {
          const d = s.data(); setMe({ id: s.id, ...d, verified: true });
          if (d.verified !== true) updateDoc(doc(db, "users", user.uid), { verified: true }).catch(() => {}); // every user is verified the moment they sign in
          if (!d.photoURL && user.photoURL) updateDoc(doc(db, "users", user.uid), { photoURL: user.photoURL }).catch(() => {});
          return;
        }
        setMe(null);
        setDoc(doc(db, "users", user.uid), { name: pendingName || user.displayName || "", email: user.email, phone: "", role: "user", photoURL: user.photoURL || "", verified: true, createdAt: serverTimestamp() })
          .catch((e) => setErr(e.message));
      },
      (e) => { setMe(null); setErr(e.message); });
  }, [user]);
  if (user === undefined) return <Spin />;
  if (!user) return <Login />;
  if (me === undefined) return <Spin />;
  if (me === null || me.role === "removed")
    return (
      <div className="container py-5 text-center" style={{ maxWidth: 520 }}>
        <h5>{me ? "Access removed" : err ? "Could not set up your profile" : "Setting up your profile…"}</h5>
        <p className="text-muted">{me ? "Contact the administrator to restore your access." : err || "This takes a moment."}</p>
        <button className="btn btn-outline-primary" onClick={() => signOut(auth)}>Sign out</button>
      </div>
    );
  return <Shell me={me} />;
}

/* ---------- login / register ---------- */
function Login() {
  const [m, setM] = useState("in");
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [idleMsg] = useState(() => { try { const v = sessionStorage.getItem("idleOut"); if (v) sessionStorage.removeItem("idleOut"); return !!v; } catch { return false; } });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const go = async (e) => {
    e.preventDefault(); setMsg(null); setBusy(true);
    try {
      const email = f.email.trim();
      if (!EMAIL.test(email)) throw new Error("Enter a valid email address.");
      if (m === "in") await signInWithEmailAndPassword(auth, email, f.password);
      else if (m === "up") {
        if (!f.name.trim()) throw new Error("Enter your name.");
        pendingName = f.name.trim();
        await createUserWithEmailAndPassword(auth, email, f.password);
      } else {
        await sendPasswordResetEmail(auth, email);
        setMsg({ ok: true, t: "Reset link sent. Check your inbox." });
      }
    } catch (x) { setMsg({ t: x.code ? x.code.replace("auth/", "").replace(/-/g, " ") : x.message }); }
    setBusy(false);
  };
  const google = async () => {
    setMsg(null); setBusy(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (x) {
      if (!["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(x.code))
        setMsg({ t: x.code ? x.code.replace("auth/", "").replace(/-/g, " ") : x.message });
    }
    setBusy(false);
  };
  return (
    <div className="auth">
      <div className="auth-hero">
        <div className="brand px-0"><span className="brand-mark"><i className="bi bi-tools" /></span><BrandName /></div>
        <h1 className="display-5 fw-bold mt-4">Every bolt and<br />every litre, accounted for.</h1>
        <p className="fs-5" style={{ maxWidth: 440, color: "#aeb7c2" }}>One system for your hardware shops and water refilling centers: stock, sales, receipts, loss control and finances.</p>
        <div className="feat"><i className="bi bi-box-seam" /><div><b className="text-white">Live stock levels</b><br />Low-stock alerts before shelves run empty.</div></div>
        <div className="feat"><i className="bi bi-receipt" /><div><b className="text-white">Daily sales in seconds</b><br />Every sale updates stock automatically.</div></div>
        <div className="feat"><i className="bi bi-graph-up" /><div><b className="text-white">Analytics and reports</b><br />Profit, balance sheet and downloadable files.</div></div>
      </div>
      <div className="auth-pane">
      <form onSubmit={go} className="card shadow-sm p-4 p-sm-5 w-100" style={{ maxWidth: 430 }}>
        <span className="brand-mark mb-3 d-lg-none"><i className="bi bi-tools" /></span>
        <h3 className="fw-bold mb-1">{m === "in" ? "Welcome back" : m === "up" ? "Join the team" : "Reset password"}</h3>
        <p className="text-muted small">{m === "in" ? "Sign in to continue" : m === "up" ? "Create your account" : "Reset your password"}</p>
        {m === "up" && <div className="mb-3"><label className="form-label small">Full name</label><div className="input-group"><span className="input-group-text"><i className="bi bi-person" /></span><input className="form-control" value={f.name} onChange={set("name")} required /></div></div>}
        <div className="mb-3"><label className="form-label small">Email</label><div className="input-group"><span className="input-group-text"><i className="bi bi-envelope" /></span><input type="email" className="form-control" value={f.email} onChange={set("email")} required autoComplete="email" /></div></div>
        {m !== "reset" && <div className="mb-3"><label className="form-label small">Password</label><div className="input-group"><span className="input-group-text"><i className="bi bi-lock" /></span><input type="password" className="form-control" value={f.password} onChange={set("password")} required minLength={6} autoComplete={m === "in" ? "current-password" : "new-password"} /></div></div>}
        {idleMsg && <div className="alert alert-warning py-2 small"><i className="bi bi-hourglass-split me-1" />You were signed out after 10 minutes of inactivity. Please sign in again.</div>}
        {msg && <div className={`alert py-2 small ${msg.ok ? "alert-success" : "alert-danger"}`}>{msg.t}</div>}
        <button className="btn btn-primary w-100" disabled={busy}><i className={`bi bi-${m === "in" ? "box-arrow-in-right" : m === "up" ? "person-plus" : "envelope"} me-2`} />{m === "in" ? "Sign in" : m === "up" ? "Create account" : "Send reset link"}</button>
        {m !== "reset" && (
          <>
            <div className="d-flex align-items-center gap-2 my-3 text-muted small"><hr className="flex-fill m-0" />or<hr className="flex-fill m-0" /></div>
            <button type="button" className="btn btn-outline-dark w-100" onClick={google} disabled={busy}><i className="bi bi-google me-2" />Continue with Google</button>
          </>
        )}
        <div className="d-flex justify-content-between mt-3 small">
          {m === "in" ? <><a href="#" onClick={(e) => { e.preventDefault(); setM("up"); setMsg(null); }}>Create account</a><a href="#" onClick={(e) => { e.preventDefault(); setM("reset"); setMsg(null); }}>Forgot password?</a></>
            : <a href="#" onClick={(e) => { e.preventDefault(); setM("in"); setMsg(null); }}>Back to sign in</a>}
        </div>
      </form>
      <Footer />
      </div>
    </div>
  );
}

/* ---------- shell ---------- */
function Shell({ me }) {
  const admin = me.role === "admin";
  const B = useCol("branches");
  const water = !admin && B.find((b) => b.id === me.branchId)?.type === "water";
  const [tab, setTab] = useState("dash");
  const [open, setOpen] = useState(false);
  const metaFn = useMeta(me);
  DOC.get = metaFn;
  const last = useRef(Date.now()), warnRef = useRef(false);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const bump = () => { if (!warnRef.current) last.current = Date.now(); };
    const evs = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true, capture: true }));
    const t = setInterval(() => {
      const idle = Date.now() - last.current;
      if (idle >= IDLE) { try { sessionStorage.setItem("idleOut", "1"); } catch { /* ignore */ } signOut(auth); }
      else if (idle >= IDLE - WARN) { warnRef.current = true; setLeft(Math.ceil((IDLE - idle) / 1000)); }
      else { warnRef.current = false; setLeft(0); }
    }, Math.min(1000, Math.max(50, IDLE / 10)));
    return () => { evs.forEach((e) => window.removeEventListener(e, bump, { capture: true })); clearInterval(t); };
  }, []);
  const stay = () => { last.current = Date.now(); warnRef.current = false; setLeft(0); };
  const items = [["dash", "speedometer2", "Dashboard"],
    ...(water ? [] : [["products", "box-seam", "Products"], ["sales", "receipt", "Sales"]]),
    ...(admin || water ? [["water", "droplet-half", "Water"]] : []),
    ...(admin || me.branchId ? [["invoices", "file-earmark-text", "Invoices"]] : []),
    ...(water ? [] : [["analytics", "graph-up", "Analytics"]]),
    ...(admin ? [["finance", "bank", "Finance"], ["statements", "file-earmark-bar-graph", "Statements"], ["branches", "shop", "Branches"], ["users", "people", "Users"], ["settings", "gear", "Settings"]] : []),
    ["profile", "person-circle", "Profile"]];
  const cur = items.find((x) => x[0] === tab) || items[0];
  const View = { dash: Dash, products: Products, sales: Sales, water: Water, invoices: Invoices, analytics: Analytics, finance: Finance, statements: Statements, branches: Branches, users: Users, settings: Settings, profile: Profile }[cur[0]];
  return (
    <>
      <aside className={`side ${open ? "open" : ""}`}>
        <div className="brand"><span className="brand-mark"><i className="bi bi-tools" /></span><BrandName /></div>
        <nav>
          {items.map(([k, i, l]) => (
            <a key={k} href="#" className={`side-link ${cur[0] === k ? "active" : ""}`} onClick={(e) => { e.preventDefault(); setTab(k); setOpen(false); }}><i className={`bi bi-${i}`} />{l}</a>
          ))}
        </nav>
        <div className="side-foot">
          <div className="d-flex align-items-center gap-2 mb-2">
            <Avatar u={me} />
            <div style={{ minWidth: 0 }}><div className="text-white fw-semibold text-truncate">{me.name || me.email}{me.name && <Verified />}</div><div className="small">{admin ? "Administrator" : "Staff"}</div></div>
          </div>
          <button className="btn btn-sm btn-outline-light w-100" onClick={() => signOut(auth)}><Icon n="box-arrow-right" />Sign out</button>
        </div>
      </aside>
      <PreviewHost />
      {left > 0 && (
        <div className="modal d-block" style={{ background: "rgba(15,20,26,.6)", zIndex: 2000 }}><div className="modal-dialog modal-dialog-centered"><div className="modal-content"><div className="modal-body text-center p-4">
          <i className="bi bi-hourglass-split fs-1 text-primary" /><h5 className="mt-2">Still there?</h5>
          <p className="text-muted">For your security you will be signed out in <b>{left}s</b> because the app has been inactive.</p>
          <button className="btn btn-primary me-2" onClick={stay}><i className="bi bi-shield-check me-1" />Stay signed in</button><button className="btn btn-light" onClick={() => signOut(auth)}><i className="bi bi-box-arrow-right me-1" />Sign out now</button>
        </div></div></div></div>
      )}
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <button className="btn btn-light menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><i className="bi bi-list fs-5" /></button>
          <h5 className="mb-0 fw-bold">{cur[2]}</h5>
          <div className="ms-auto"><Alerts me={me} admin={admin} water={water} go={setTab} /></div>
        </header>
        <main className="p-3 p-lg-4"><View me={me} admin={admin} water={water} /></main>
        <Footer />
      </div>
    </>
  );
}

/* ---------- dashboard ---------- */
function Dash(props) {
  return props.water ? <WaterDash me={props.me} /> : <HwDash {...props} />;
}
function HwDash({ me, admin }) {
  const P = useCol("products");
  const S1 = useCol("sales", admin ? undefined : me.id);
  const WS = useCol("waterSales", undefined, !admin);
  const S = [...S1, ...WS];
  const U = useCol("users", undefined, !admin), B = useCol("branches", undefined, !admin);
  const low = P.filter((p) => p.qty <= p.minQty);
  const cards = [["box-seam", "Products", P.length], ["stack", "Units in stock", P.reduce((a, p) => a + p.qty, 0)],
    ["exclamation-triangle", "Low or out of stock", low.length],
    ["cash-coin", admin ? "Sales today" : "Your sales today", money(S.filter((s) => s.date === today()).reduce((a, s) => a + s.total, 0))]];
  return (
    <>
      {!admin && !me.branchId && <div className="alert alert-info"><i className="bi bi-info-circle me-1" />You have not been assigned to a branch yet. Ask the administrator to assign you.</div>}
      <div className="row g-3 mb-4">
        {cards.map(([i, l, v]) => (
          <div className="col-6 col-lg-3" key={l}><Stat i={i} l={l} v={v} /></div>
        ))}
      </div>
      <div className="card"><div className="card-header fw-semibold">Needs restocking</div>
        <div className="table-responsive"><table className="table mb-0 align-middle">
          <thead><tr><th>Product</th><th>SKU</th><th className="text-end">In stock</th><th className="text-end">Minimum</th></tr></thead>
          <tbody>{low.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.sku}</td><td className="text-end">{p.qty}</td><td className="text-end">{p.minQty}</td></tr>)}
            {!low.length && <tr><td colSpan="4" className="text-center text-muted py-3">All products are above their minimum level.</td></tr>}</tbody>
        </table></div></div>
      {admin && <div className="mt-3"><Leaderboard sales={S.filter((s) => s.date >= ago(29))} users={U} branches={B} title="Top performing staff (last 30 days)" /></div>}
    </>
  );
}

/* ---------- products ---------- */
const blankP = { name: "", sku: "", category: "", qty: "", cost: "", price: "", minQty: "5" };
function Products({ admin }) {
  const items = useCol("products");
  const [q, setQ] = useState("");
  const [f, setF] = useState(null);
  const list = items.filter((p) => `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const pg = usePage(list);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = run(async (e) => {
    e.preventDefault();
    const { id, ...d } = f;
    const data = { name: d.name.trim(), sku: d.sku.trim(), category: d.category.trim(), qty: Math.floor(+d.qty), cost: +d.cost, price: +d.price, minQty: Math.floor(+d.minQty) };
    if ([data.qty, data.cost, data.price, data.minQty].some((n) => isNaN(n) || n < 0)) throw new Error("Quantities and prices must be numbers of 0 or more.");
    if (id) await updateDoc(doc(db, "products", id), data); else await addDoc(collection(db, "products"), data);
    setF(null);
  });
  const del = run(async (p) => { if (confirm(`Delete ${p.name}?`)) await deleteDoc(doc(db, "products", p.id)); });
  const badge = (p) => p.qty <= 0 ? <span className="badge text-bg-danger">Out</span> : p.qty <= p.minQty ? <span className="badge text-bg-warning">Low</span> : <span className="badge text-bg-success">In stock</span>;
  return (
    <>
      <div className="d-flex gap-2 mb-3">
        <div className="input-group"><span className="input-group-text"><i className="bi bi-search" /></span>
          <input className="form-control" placeholder="Search name, SKU or category" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {admin && <button className="btn btn-primary text-nowrap" onClick={() => setF(blankP)}><Icon n="plus-lg" />Add</button>}
      </div>
      {admin && f && (
        <form onSubmit={save} className="card card-body mb-3"><h6 className="fw-bold mb-3"><Icon n="box-seam" />{f.id ? "Edit product" : "New product"}</h6><div className="row g-2">
          <Field label="Name" value={f.name} onChange={set("name")} required />
          <Field label="SKU" value={f.sku} onChange={set("sku")} required />
          <Field label="Category" value={f.category} onChange={set("category")} />
          <Field label="Quantity" type="number" min="0" step="1" value={f.qty} onChange={set("qty")} required />
          <Field label="Cost price" type="number" min="0" step="0.01" value={f.cost} onChange={set("cost")} required />
          <Field label="Selling price" type="number" min="0" step="0.01" value={f.price} onChange={set("price")} required />
          <Field label="Minimum stock" type="number" min="0" step="1" value={f.minQty} onChange={set("minQty")} required />
          <div className="col-12 d-flex gap-2"><button className="btn btn-primary"><Icon n="check-lg" />Save product</button><button type="button" className="btn btn-light" onClick={() => setF(null)}><Icon n="x-lg" />Cancel</button></div>
        </div></form>
      )}
      <div className="card"><div className="table-responsive"><table className="table table-hover mb-0 align-middle">
        <thead><tr><th>Product</th><th>SKU</th><th>Category</th><th className="text-end">Qty</th>{admin && <th className="text-end">Cost</th>}<th className="text-end">Price</th><th>Status</th>{admin && <th />}</tr></thead>
        <tbody>
          {pg.rows.map((p) => (
            <tr key={p.id}><td>{p.name}</td><td>{p.sku}</td><td>{p.category}</td><td className="text-end">{p.qty}</td>
              {admin && <td className="text-end">{money(p.cost)}</td>}<td className="text-end">{money(p.price)}</td><td>{badge(p)}</td>
              {admin && <td className="text-nowrap text-end">
                <button className="btn btn-sm btn-outline-primary me-1" onClick={() => setF({ ...p })} aria-label="Edit"><i className="bi bi-pencil" /></button>
                <button className="btn btn-sm btn-outline-danger" onClick={() => del(p)} aria-label="Delete"><i className="bi bi-trash" /></button></td>}</tr>
          ))}
          {!list.length && <tr><td colSpan="8" className="text-center text-muted py-3">No products found.</td></tr>}
        </tbody></table></div>{pg.pager}</div>
    </>
  );
}

/* ---------- sales ---------- */
function Sales({ me, admin }) {
  const P = useCol("products");
  const S = useCol("sales", admin ? undefined : me.id);
  const [f, setF] = useState({ productId: "", qty: "1", date: today() });
  const [day, setDay] = useState(today());
  const rows = S.filter((s) => !day || s.date === day).sort((a, b) => b.date.localeCompare(a.date));
  const total = rows.reduce((a, s) => a + s.total, 0);
  const pg = usePage(rows);
  const [rc, setRc] = useState(null);
  const IVs = useCol("invoices", admin ? undefined : me.branchId, !admin && !me.branchId, "branchId");
  const [gen, setGen] = useState(null), [ivv, setIvv] = useState(null);
  const canInv = admin || !!me.branchId;
  const invOf = (s) => IVs.find((i) => i.status !== "cancelled" && (i.items || []).some((x) => x.saleId === s.id));
  const record = run(async (e) => {
    e.preventDefault();
    const q = Math.floor(+f.qty);
    if (!f.productId) throw new Error("Choose a product.");
    if (!(q > 0)) throw new Error("Quantity must be at least 1.");
    const sale = await runTransaction(db, async (t) => {
      const pr = doc(db, "products", f.productId), cr = doc(db, "counters", "receipts");
      const p = await t.get(pr), c = await t.get(cr);
      if (!p.exists()) throw new Error("Product not found.");
      const d = p.data();
      if (d.qty < q) throw new Error(`Only ${d.qty} in stock.`);
      const cd = c.exists() ? c.data() : { hw: 0, wt: 0 };
      const ref = doc(collection(db, "sales"));
      const data = {
        receiptNo: serial("HW", (cd.hw || 0) + 1), branchId: me.branchId || "", userId: me.id, userName: me.name || me.email, productId: p.id, productName: d.name,
        qty: q, unitPrice: d.price, unitCost: d.cost, total: q * d.price, date: f.date,
      };
      t.update(pr, { qty: d.qty - q });
      t.set(cr, { hw: (cd.hw || 0) + 1, wt: cd.wt || 0 });
      t.set(ref, { ...data, createdAt: serverTimestamp() });
      return { id: ref.id, ...data, createdAt: new Date() };
    });
    setF({ ...f, qty: "1" });
    setRc(sale);
  });
  const del = run(async (s) => {
    if (!confirm("Delete this sale and return the items to stock?")) return;
    await runTransaction(db, async (t) => {
      const pr = doc(db, "products", s.productId);
      const p = await t.get(pr);
      if (p.exists()) t.update(pr, { qty: p.data().qty + s.qty });
      t.delete(doc(db, "sales", s.id));
    });
  });
  return (
    <>
      {rc && <Receipt sale={rc} onClose={() => setRc(null)} />}
      {gen && <GenerateInvoice sale={gen} me={me} admin={admin} onClose={() => setGen(null)} onDone={(inv) => { setGen(null); setIvv({ id: inv.id, inv }); }} />}
      {ivv && <InvoiceView id={ivv.id} fallback={ivv.inv} me={me} onClose={() => setIvv(null)} />}
      <form onSubmit={record} className="card card-body mb-3"><h6 className="fw-bold mb-3"><Icon n="cart-plus" />Record a sale</h6><div className="row g-2 align-items-end">
        <div className="col-12 col-lg-5"><label className="form-label small mb-1">Product</label>
          <div className="input-group"><span className="input-group-text"><i className="bi bi-box-seam" /></span><select className="form-select" value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })} required>
            <option value="">Select product</option>
            {P.filter((p) => p.qty > 0).sort((a, b) => (a.name || "").localeCompare(b.name || "")).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.qty} left, {money(p.price)})</option>)}
          </select></div></div>
        <Field cls="col-6 col-lg-2" label="Quantity" type="number" min="1" step="1" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required />
        <Field cls="col-6 col-lg-3" label="Date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
        <div className="col-12 col-lg-2"><button className="btn btn-primary w-100"><Icon n="check-lg" />Record sale</button></div>
      </div></form>
      <div className="d-flex flex-wrap gap-2 align-items-end mb-3">
        <Field cls="" label="Report date (clear for all)" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <button className="btn btn-outline-primary" disabled={!rows.length} onClick={() => previewSales(rows, `sales-report-${day || "all"}`, "Sales Report", admin ? "All hardware branches" : "My sales", day)}><Icon n="eye" />Preview report</button>
        <div className="ms-auto fw-semibold">Total: {money(total)}</div>
      </div>
      <div className="card"><div className="table-responsive"><table className="table mb-0 align-middle">
        <thead><tr><th>Date</th>{admin && <th>Staff</th>}<th>Product</th><th className="text-end">Qty</th><th className="text-end">Unit price</th><th className="text-end">Total</th><th>Receipt</th>{canInv && <th>Invoice</th>}{admin && <th />}</tr></thead>
        <tbody>
          {pg.rows.map((s) => (
            <tr key={s.id}><td>{s.date}</td>{admin && <td>{s.userName}</td>}<td>{s.productName}</td><td className="text-end">{s.qty}</td><td className="text-end">{money(s.unitPrice)}</td><td className="text-end">{money(s.total)}</td><td><button className="btn btn-sm btn-outline-secondary text-nowrap" onClick={() => setRc(s)}><i className="bi bi-receipt me-1" />{s.receiptNo || "View"}</button></td>{canInv && <td>{(() => { const iv = invOf(s); return iv ? <button className="btn btn-sm btn-outline-primary text-nowrap" onClick={() => setIvv({ id: iv.id, inv: iv })}><i className="bi bi-file-earmark-text me-1" />{iv.no}</button> : <button className="btn btn-sm btn-outline-secondary text-nowrap" onClick={() => setGen(s)}><i className="bi bi-file-earmark-plus me-1" />Generate</button>; })()}</td>}
              {admin && <td className="text-end"><button className="btn btn-sm btn-outline-danger" onClick={() => del(s)} aria-label="Delete"><i className="bi bi-trash" /></button></td>}</tr>
          ))}
          {!rows.length && <tr><td colSpan="9" className="text-center text-muted py-3">No sales for this selection.</td></tr>}
        </tbody></table></div>{pg.pager}</div>
    </>
  );
}

/* ---------- analytics ---------- */
const GR = [["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"], ["year", "Yearly"]];
const fmtD = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const shift = (ds, k) => { const d = new Date(`${ds}T00:00:00`); d.setDate(d.getDate() + k); return fmtD(d); };
const monday = (ds) => { const d = new Date(`${ds}T00:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fmtD(d); };
const keyOf = (ds, g) => (g === "day" ? ds : g === "week" ? monday(ds) : g === "month" ? ds.slice(0, 7) : ds.slice(0, 4));
const bucketKeys = (g) => {
  const now = new Date(), out = [];
  if (g === "day") for (let i = 29; i >= 0; i--) { const k = ago(i); out.push({ key: k, label: k.slice(5) }); }
  else if (g === "week") for (let i = 11; i >= 0; i--) { const k = monday(ago(7 * i)); out.push({ key: k, label: k.slice(5) }); }
  else if (g === "month") for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString(undefined, { month: "short", year: "2-digit" }) });
  } else for (let i = 4; i >= 0; i--) { const k = String(now.getFullYear() - i); out.push({ key: k, label: k }); }
  return out;
};
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
function Chart({ data, h = 170 }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      <div className="d-flex" style={{ height: h }}>
        <div className="d-flex flex-column justify-content-between text-muted small text-end pe-2" style={{ minWidth: 48 }}><span>{short(max)}</span><span>{short(max / 2)}</span><span>0</span></div>
        <div className="flex-fill d-flex align-items-end gap-1 border-start border-bottom px-1" style={{ height: "100%" }}>
          {data.map((d, i) => <div key={i} title={`${d.label}: ${money(d.value)}`} className="flex-fill rounded-top" style={{ height: `${Math.max(1.5, (d.value / max) * 100)}%`, background: d.value ? "#e8590c" : "#e3e6ea", minWidth: 3 }} />)}
        </div>
      </div>
      <div className="d-flex justify-content-between small text-muted mt-1" style={{ paddingLeft: 52 }}><span>{data[0]?.label}</span><span>{data[Math.floor(data.length / 2)]?.label}</span><span>{data[data.length - 1]?.label}</span></div>
    </div>
  );
}
function Analytics({ me, admin }) {
  const P = useCol("products");
  const H0 = useCol("sales", admin ? undefined : me.id);
  const W0 = useCol("waterSales", undefined, !admin);
  const U = useCol("users", undefined, !admin), B = useCol("branches", undefined, !admin);
  const L = useCol("ledger", undefined, !admin);
  const [g, setG] = useState("day"), [en, setEn] = useState("all"), [br, setBr] = useState("");
  const match = (b) => en === "all" || (en === "wt") === (b.type === "water");
  const opts = B.filter(match);
  const brSel = opts.some((b) => b.id === br) ? br : "";
  const bid = (s) => s.branchId ?? U.find((u) => u.id === s.userId)?.branchId ?? "";
  const inBr = (s) => !brSel || bid(s) === brSel;
  const Hs = en === "wt" ? [] : H0.filter(inBr), Ws = en === "hw" ? [] : W0.filter(inBr);
  const keys = bucketKeys(g);
  const from = keys[0].key + (g === "month" ? "-01" : g === "year" ? "-01-01" : "");
  const nDays = Math.round((new Date(`${today()}T00:00:00`) - new Date(`${from}T00:00:00`)) / 864e5) + 1;
  const inWin = (s) => s.date >= from && s.date <= today();
  const R = [...Hs, ...Ws].filter(inWin);
  const prevFrom = shift(from, -nDays), prevTo = shift(from, -1);
  const prevRev = [...Hs, ...Ws].filter((s) => s.date >= prevFrom && s.date <= prevTo).reduce((a, s) => a + s.total, 0);
  const rev = sum(R, "total"), profit = R.reduce((a, s) => a + s.total - s.qty * s.unitCost, 0), units = sum(R, "qty");
  const series = (rows) => { const m = {}; rows.forEach((s) => { const k = keyOf(s.date, g); m[k] = (m[k] || 0) + s.total; }); return keys.map((k) => ({ label: k.label, value: m[k.key] || 0 })); };
  const best = series(R).reduce((b, d) => (d.value > b.value ? d : b), { label: "-", value: 0 });
  const m = {};
  R.forEach((s) => { const x = (m[s.productName] = m[s.productName] || { name: s.productName, rev: 0, units: 0, profit: 0 }); x.rev += s.total; x.units += s.qty; x.profit += s.total - s.qty * s.unitCost; });
  const top = Object.values(m).sort((a, b) => b.rev - a.rev).slice(0, 5);
  const soldBy = {};
  Hs.filter(inWin).forEach((s) => { soldBy[s.productId] = (soldBy[s.productId] || 0) + s.qty; });
  const reorder = P.map((p) => ({ ...p, rate: (soldBy[p.id] || 0) / nDays })).filter((p) => p.rate > 0 && p.qty / p.rate < 14)
    .map((p) => ({ ...p, cover: Math.floor(p.qty / p.rate) })).sort((a, b) => a.cover - b.cover);
  const slow = P.filter((p) => p.qty > 0 && !soldBy[p.id]);
  const chg = prevRev ? ((rev - prevRev) / prevRev) * 100 : null;
  const ALL = [...(en === "wt" ? [] : H0), ...(en === "hw" ? [] : W0)];
  const BB = opts.filter((b) => !brSel || b.id === brSel);
  const bp = usePage(BB, 6, [6, 12, 24]);
  const byBranch = BB.map((b) => {
    const rs = ALL.filter((s) => inWin(s) && bid(s) === b.id);
    const r = sum(rs, "total"), cogs = rs.reduce((x, s) => x + s.qty * s.unitCost, 0);
    const exp = L.filter((l) => l.type === "Expense" && l.branchId === b.id && l.date >= from && l.date <= today()).reduce((x, l) => x + l.amount, 0);
    return { ...b, rev: r, exp, net: r - cogs - exp };
  }).sort((x, y) => y.rev - x.rev);
  const word = GR.find((x) => x[0] === g)[1].toLowerCase();
  const charts = admin && en === "all" ? [["Hardware shops", "tools", Hs], ["Water refilling", "droplet-half", Ws]]
    : [[admin ? (en === "hw" ? "Hardware shops" : "Water refilling") : "Your sales", en === "wt" ? "droplet-half" : "tools", R]];
  const cards = [["cash-coin", "Revenue", money(rev)], ...(admin ? [["graph-up-arrow", "Gross profit", money(profit)]] : []),
    ["box-seam", "Units sold", units], ["calendar-check", `Best ${g}`, best.value ? `${best.label} (${money(best.value)})` : "-"]];
  return (
    <>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <h5 className="mb-0 me-auto"><Icon n="graph-up" />Analytics</h5>
        {admin && <ul className="nav nav-pills gap-1">{[["all", "All"], ["hw", "Hardware"], ["wt", "Water"]].map(([k, l]) => <li className="nav-item" key={k}><button className={`nav-link py-1 ${en === k ? "active" : ""}`} onClick={() => setEn(k)}>{l}</button></li>)}</ul>}
        {admin && <select className="form-select w-auto" value={brSel} onChange={(e) => setBr(e.target.value)}><option value="">All branches</option>{opts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
        <div className="btn-group">{GR.map(([k, l]) => <button key={k} className={`btn btn-sm ${g === k ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setG(k)}>{l}</button>)}</div>
      </div>
      <div className="row g-3 mb-3">
        {cards.map(([i, l, v]) => <div className="col-6 col-lg" key={l}><Stat i={i} l={l} v={v} /></div>)}
      </div>
      <div className="row g-3 mb-3">
        {charts.map(([t, i, rows]) => (
          <div className={charts.length > 1 ? "col-lg-6" : "col-12"} key={t}><div className="card h-100">
            <div className="card-header d-flex justify-content-between fw-semibold"><span><Icon n={i} />{t}, {word} revenue</span><span className="text-muted fw-normal">{money(sum(rows.filter(inWin), "total"))}</span></div>
            <div className="card-body"><Chart data={series(rows)} />{g === "week" && <div className="small text-muted mt-1">Weeks start on Monday.</div>}</div>
          </div></div>
        ))}
      </div>
      <div className="card mb-3"><div className="card-header fw-semibold"><Icon n="lightbulb" />Insights</div>
        <ul className="list-group list-group-flush">
          <li className="list-group-item">{chg === null ? "Not enough earlier sales to compare with the previous period." : `Revenue is ${chg >= 0 ? "up" : "down"} ${Math.abs(chg).toFixed(1)}% compared with the previous ${nDays} days.`}</li>
          {top[0] && <li className="list-group-item">Top seller: <b>{top[0].name}</b> with {top[0].units} units ({money(top[0].rev)}).</li>}
          {en !== "wt" && reorder.length > 0 && <li className="list-group-item text-danger">Reorder soon (under 14 days of stock at current pace): {reorder.slice(0, 6).map((p) => `${p.name} (~${p.cover}d)`).join(", ")}.</li>}
          {en !== "wt" && slow.length > 0 && <li className="list-group-item">{slow.length} product{slow.length > 1 ? "s have" : " has"} not sold in this period: {slow.slice(0, 5).map((p) => p.name).join(", ")}{slow.length > 5 ? "…" : ""}.</li>}
          {!R.length && <li className="list-group-item text-muted">No sales in this period yet.</li>}
        </ul></div>
      {admin && (
        <>
          <h6 className="fw-bold mb-2"><Icon n="shop" />Charts by branch ({word} revenue)</h6>
          <div className="row g-3 mb-3">
            {bp.rows.map((b) => (
              <div className="col-md-6 col-xl-4" key={b.id}><div className="card h-100">
                <div className="card-header d-flex justify-content-between"><span className="fw-semibold text-truncate"><i className={`bi bi-${b.type === "water" ? "droplet-half" : "shop"} me-1`} />{b.name}</span><span className="text-muted small">{money(sum(ALL.filter((s) => inWin(s) && bid(s) === b.id), "total"))}</span></div>
                <div className="card-body"><Chart data={series(ALL.filter((s) => bid(s) === b.id))} h={110} /></div>
              </div></div>
            ))}
            {!BB.length && <div className="col-12 text-muted">No branches for this selection.</div>}
          </div>
          {bp.pager && <div className="card mb-3">{bp.pager}</div>}
          <div className="row g-3">
            <div className="col-lg-5"><Leaderboard sales={R} users={U} branches={B} /></div>
            <div className="col-lg-7"><div className="card h-100"><div className="card-header fw-semibold"><Icon n="shop" />Branch performance (net of expenses)</div><div className="table-responsive"><table className="table mb-0">
              <thead><tr><th>Branch</th><th className="text-end">Revenue</th><th className="text-end">Expenses</th><th className="text-end">Net</th></tr></thead>
              <tbody>{byBranch.map((b) => <tr key={b.id}><td>{b.name}</td><td className="text-end">{money(b.rev)}</td><td className="text-end">{money(b.exp)}</td><td className={`text-end fw-semibold ${b.net < 0 ? "text-danger" : ""}`}>{money(b.net)}</td></tr>)}
                {!byBranch.length && <tr><td colSpan="4" className="text-center text-muted py-3">Add branches to compare them.</td></tr>}</tbody></table></div></div></div>
          </div>
        </>
      )}
      <div className="card mt-3"><div className="card-header fw-semibold"><Icon n="trophy" />Top products</div><div className="table-responsive"><table className="table mb-0">
        <thead><tr><th>Product</th><th className="text-end">Units</th><th className="text-end">Revenue</th>{admin && <th className="text-end">Profit</th>}</tr></thead>
        <tbody>{top.map((r) => <tr key={r.name}><td>{r.name}</td><td className="text-end">{r.units}</td><td className="text-end">{money(r.rev)}</td>{admin && <td className="text-end">{money(r.profit)}</td>}</tr>)}
          {!top.length && <tr><td colSpan="4" className="text-center text-muted py-3">No data</td></tr>}</tbody></table></div></div>
    </>
  );
}

/* ---------- finance (admin) ---------- */
const TYPES = ["Capital", "Loan", "Expense", "Stock purchase"];
function Finance() {
  const P = useCol("products"), S1 = useCol("sales"), W = useCol("waterSales"), L = useCol("ledger"), B = useCol("branches");
  const S = [...S1, ...W];
  const blank = { type: "Expense", description: "", amount: "", date: today(), branchId: "" };
  const [f, setF] = useState(blank);
  const sum = (t) => L.filter((l) => l.type === t).reduce((a, l) => a + l.amount, 0);
  const rev = S.reduce((a, s) => a + s.total, 0), cogs = S.reduce((a, s) => a + s.qty * s.unitCost, 0);
  const inv = P.reduce((a, p) => a + p.qty * p.cost, 0);
  const cap = sum("Capital"), loan = sum("Loan"), exp = sum("Expense"), buy = sum("Stock purchase");
  const cash = cap + loan + rev - exp - buy, assets = cash + inv, equity = assets - loan;
  const rows = [
    ["BALANCE SHEET"], ["Assets"], ["Cash", cash], ["Inventory at cost", inv], ["Total assets", assets],
    ["Liabilities"], ["Loans", loan], ["Total liabilities", loan],
    ["Equity"], ["Owner capital", cap], ["Retained earnings", equity - cap], ["Total equity", equity],
    ["Total liabilities and equity", loan + equity],
    ["INCOME STATEMENT"], ["Revenue", rev], ["Cost of goods sold", cogs], ["Gross profit", rev - cogs],
    ["Operating expenses", exp], ["Net profit", rev - cogs - exp],
  ];
  const save = run(async (e) => {
    e.preventDefault();
    const { id, ...d } = f; const a = +d.amount;
    if (!(a > 0)) throw new Error("Amount must be greater than 0.");
    const data = { type: d.type, description: d.description.trim(), amount: a, date: d.date, branchId: d.branchId || "" };
    if (id) await updateDoc(doc(db, "ledger", id), data); else await addDoc(collection(db, "ledger"), data);
    setF(blank);
  });
  const del = run(async (l) => { if (confirm("Delete this entry?")) await deleteDoc(doc(db, "ledger", l.id)); });
  const lp = usePage([...L].sort((a, b) => b.date.localeCompare(a.date)));
  return (
    <div className="row g-3">
      <div className="col-lg-5">
        <div className="card"><div className="card-header d-flex justify-content-between align-items-center fw-semibold">Financial statements
          <button className="btn btn-sm btn-outline-primary" onClick={() => showPreview({ title: "Financial Position Summary", scope: "Whole business", from: "All dates", to: today(), sections: [{ name: "Summary", type: "fin", rows: rows.map((r) => (r.length === 1 ? { l: r[0], k: "h" } : { l: r[0], v: r[1], k: /^(Total|Gross|Net)/.test(r[0]) ? "t" : "" })) }] }, `financial-summary-${today()}`)}><Icon n="eye" />Preview</button></div>
          <table className="table mb-0"><tbody>
            {rows.map((r, i) => r.length === 1
              ? <tr key={i} className="table-light"><th colSpan="2">{r[0]}</th></tr>
              : <tr key={i} className={/^(Total|Gross|Net)/.test(r[0]) ? "fw-semibold" : ""}><td>{r[0]}</td><td className="text-end">{money(r[1])}</td></tr>)}
          </tbody></table></div>
        <div className="d-grid gap-2 mt-3">
          <button className="btn btn-outline-primary" disabled={!S.length} onClick={() => previewSales([...S].sort((a, b) => a.date.localeCompare(b.date)), `all-sales-${today()}`, "All Sales Report", "Whole business", "")}><Icon n="eye" />Preview all sales</button>
          <button className="btn btn-outline-primary" disabled={!L.length} onClick={() => showPreview({ title: "Ledger", scope: "Whole business", from: "All dates", to: today(), sections: [{ name: "Ledger", type: "table", money: [4], head: ["Date", "Type", "Description", "Branch", "Amount"], rows: L.map((l) => [l.date, l.type, l.description, B.find((b) => b.id === l.branchId)?.name || "General", l.amount]) }] }, `ledger-${today()}`)}><Icon n="eye" />Preview ledger</button>
        </div>
      </div>
      <div className="col-lg-7">
        <form onSubmit={save} className="card card-body mb-3"><h6 className="fw-bold mb-3"><Icon n="journal-plus" />{f.id ? "Edit entry" : "New ledger entry"}</h6><div className="row g-2 align-items-end">
          <div className="col-sm-6 col-lg-2"><label className="form-label small mb-1">Type</label>
            <div className="input-group"><span className="input-group-text"><i className="bi bi-tags" /></span><select className="form-select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div></div>
          <Field cls="col-sm-6 col-lg-3" label="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required />
          <Field cls="col-sm-6 col-lg-2" label="Amount" type="number" min="0.01" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required />
          <Field cls="col-sm-6 col-lg-2" label="Date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
          <div className="col-sm-6 col-lg-3"><label className="form-label small mb-1">Branch</label><div className="input-group"><span className="input-group-text"><i className="bi bi-shop" /></span>
            <select className="form-select" value={f.branchId || ""} onChange={(e) => setF({ ...f, branchId: e.target.value })}><option value="">General / head office</option>{B.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div></div>
          <div className="col-12 d-flex gap-2"><button className="btn btn-primary"><Icon n={f.id ? "check-lg" : "plus-lg"} />{f.id ? "Update entry" : "Add entry"}</button>{f.id && <button type="button" className="btn btn-light" onClick={() => setF(blank)}><Icon n="x-lg" />Cancel</button>}</div>
        </div></form>
        <div className="card"><div className="table-responsive"><table className="table mb-0 align-middle">
          <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Branch</th><th className="text-end">Amount</th><th /></tr></thead>
          <tbody>
            {lp.rows.map((l) => (
              <tr key={l.id}><td>{l.date}</td><td>{l.type}</td><td>{l.description}</td><td>{B.find((b) => b.id === l.branchId)?.name || "General"}</td><td className="text-end">{money(l.amount)}</td>
                <td className="text-nowrap text-end"><button className="btn btn-sm btn-outline-primary me-1" onClick={() => setF({ ...l, amount: String(l.amount) })} aria-label="Edit"><i className="bi bi-pencil" /></button>
                  <button className="btn btn-sm btn-outline-danger" onClick={() => del(l)} aria-label="Delete"><i className="bi bi-trash" /></button></td></tr>
            ))}
            {!L.length && <tr><td colSpan="6" className="text-center text-muted py-3">No entries yet. Add capital, loans, expenses and stock purchases.</td></tr>}
          </tbody></table></div>{lp.pager}</div>
      </div>
    </div>
  );
}

/* ---------- water refilling ---------- */
const sum = (rows, k) => rows.reduce((a, x) => a + (+x[k] || 0), 0);
const num = (v) => (v === "" || v == null ? NaN : +v);
const lossBadge = (p) => p > LOSS_BAD ? <span className="badge text-bg-danger">High loss</span> : p > LOSS_WARN ? <span className="badge text-bg-warning">Watch</span> : <span className="badge text-bg-success">OK</span>;

function WaterDash({ me }) {
  const WS = useCol("waterSales", me.branchId, !me.branchId, "branchId");
  const LG = useCol("waterLogs", me.branchId, !me.branchId, "branchId");
  const t = today(), ts = WS.filter((s) => s.date === t), closed = LG.some((l) => l.date === t);
  const cards = [["cash-coin", "Sales today", money(sum(ts, "total"))], ["droplet-half", "Litres sold today", `${sum(ts, "litres").toLocaleString()} L`],
    ["receipt", "Transactions today", ts.length], ["clipboard-check", "Daily close", closed ? "Done" : "Pending"]];
  return (
    <>
      <div className="row g-3 mb-3">{cards.map(([i, l, v]) => <div className="col-6 col-lg-3" key={l}><Stat i={i} l={l} v={v} /></div>)}</div>
      {!closed && <div className="alert alert-warning d-flex align-items-center gap-2"><i className="bi bi-exclamation-triangle" />Complete today's close in the Water tab before leaving, so any water or cash loss is recorded.</div>}
    </>
  );
}

function Water({ me, admin }) {
  const B = useCol("branches");
  const WB = B.filter((b) => b.type === "water").sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const [tab, setTab] = useState("sell");
  const [sel, setSel] = useState("");
  const bid = admin ? (WB.some((b) => b.id === sel) ? sel : WB[0]?.id || "") : me.branchId || "";
  const branch = B.find((b) => b.id === bid);
  const tabs = [["sell", "cart-plus", "Sell"], ["close", "clipboard-check", "Daily close"], ...(admin ? [["loss", "shield-exclamation", "Loss control"], ["prices", "tags", "Price list"]] : [])];
  const scoped = tab === "sell" || tab === "close";
  return (
    <>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <ul className="nav nav-pills gap-1">
          {tabs.map(([k, i, l]) => <li className="nav-item" key={k}><button className={`nav-link ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}><i className={`bi bi-${i} me-1`} />{l}</button></li>)}
        </ul>
        {scoped && admin && WB.length > 0 && (
          <div className="input-group w-auto ms-lg-auto"><span className="input-group-text"><i className="bi bi-droplet-half" /></span>
            <select className="form-select" value={bid} onChange={(e) => setSel(e.target.value)}>{WB.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        )}
        {scoped && !admin && branch && <span className="badge text-bg-info ms-lg-auto fs-6"><i className="bi bi-droplet-half me-1" />{branch.name}</span>}
      </div>
      {scoped && !bid && <div className="card card-body text-center text-muted py-5"><i className="bi bi-droplet-half fs-1" />{admin ? "Add a branch of type Water refilling in the Branches tab first." : "You are not assigned to a water branch yet. Ask the administrator."}</div>}
      {scoped && bid && tab === "sell" && <WaterSell key={bid} me={me} admin={admin} bid={bid} branch={branch} />}
      {scoped && bid && tab === "close" && <WaterClose key={bid} me={me} admin={admin} bid={bid} branch={branch} />}
      {tab === "loss" && <WaterLoss />}
      {tab === "prices" && <WaterPrices />}
    </>
  );
}

function WaterSell({ me, admin, bid, branch }) {
  const items = useCol("waterItems");
  const WS = useCol("waterSales", bid, !bid, "branchId");
  const LG = useCol("waterLogs", bid, !bid, "branchId");
  const [f, setF] = useState({ itemId: "", qty: "1", date: today() });
  const [day, setDay] = useState(today());
  const list = [...items].sort((a, b) => a.litres - b.litres);
  const it = items.find((i) => i.id === f.itemId);
  const rows = WS.filter((s) => !day || s.date === day).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  const pg = usePage(rows);
  const [rc, setRc] = useState(null);
  const IVs = useCol("invoices", admin ? undefined : me.branchId, !admin && !me.branchId, "branchId");
  const [gen, setGen] = useState(null), [ivv, setIvv] = useState(null);
  const canInv = admin || !!me.branchId;
  const invOf = (s) => IVs.find((i) => i.status !== "cancelled" && (i.items || []).some((x) => x.saleId === s.id));
  const record = run(async (e) => {
    e.preventDefault();
    const q = Math.floor(+f.qty);
    if (!it) throw new Error("Choose an item.");
    if (!(q > 0)) throw new Error("Quantity must be at least 1.");
    if (!admin && LG.some((l) => l.date === f.date)) throw new Error("This day is already closed.");
    const sale = await runTransaction(db, async (t) => {
      const cr = doc(db, "counters", "receipts"), c = await t.get(cr);
      const cd = c.exists() ? c.data() : { hw: 0, wt: 0 };
      const ref = doc(collection(db, "waterSales"));
      const data = {
        receiptNo: serial("WT", (cd.wt || 0) + 1), branchId: bid, userId: me.id, userName: me.name || me.email, itemId: it.id, productId: it.id, productName: it.name,
        qty: q, litres: q * it.litres, unitPrice: it.price, unitCost: 0, total: q * it.price, date: f.date,
      };
      t.set(cr, { hw: cd.hw || 0, wt: (cd.wt || 0) + 1 });
      t.set(ref, { ...data, createdAt: serverTimestamp() });
      return { id: ref.id, ...data, createdAt: new Date() };
    });
    setF({ ...f, qty: "1" });
    setRc(sale);
  });
  const del = run(async (s) => { if (confirm("Delete this sale?")) await deleteDoc(doc(db, "waterSales", s.id)); });
  return (
    <>
      {rc && <Receipt sale={rc} onClose={() => setRc(null)} />}
      {gen && <GenerateInvoice sale={gen} me={me} admin={admin} onClose={() => setGen(null)} onDone={(inv) => { setGen(null); setIvv({ id: inv.id, inv }); }} />}
      {ivv && <InvoiceView id={ivv.id} fallback={ivv.inv} me={me} onClose={() => setIvv(null)} />}
      <form onSubmit={record} className="card card-body mb-3">
        <h6 className="fw-bold mb-3"><Icon n="cart-plus" />Record a water sale</h6>
        <div className="row g-2 mb-3">
          {list.map((i) => (
            <div className="col-6 col-md-3" key={i.id}>
              <button type="button" className={`tile ${f.itemId === i.id ? "on" : ""}`} onClick={() => setF({ ...f, itemId: i.id })}>
                <div className="fw-semibold"><i className="bi bi-droplet me-1 text-primary" />{i.name}</div><div className="small text-muted">{money(i.price)}</div>
              </button>
            </div>
          ))}
          {!list.length && <div className="col-12 text-muted">No items yet. The administrator adds them under Price list.</div>}
        </div>
        <div className="row g-2 align-items-end">
          <Field cls="col-6 col-lg-3" label="Quantity" type="number" min="1" step="1" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required />
          <Field cls="col-6 col-lg-3" label="Date" type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
          <div className="col-12 col-lg-3"><div className="small text-muted">Total</div><div className="fs-5 fw-bold">{money((it?.price || 0) * (Math.floor(+f.qty) || 0))}</div></div>
          <div className="col-12 col-lg-3"><button className="btn btn-primary w-100"><Icon n="check-lg" />Record sale</button></div>
        </div>
      </form>
      <div className="d-flex flex-wrap gap-2 align-items-end mb-3">
        <Field cls="" label="Report date (clear for all)" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <button className="btn btn-outline-primary" disabled={!rows.length} onClick={() => previewSales(rows, `water-sales-${day || "all"}`, "Water Sales Report", branch?.name || "Water branch", day)}><Icon n="eye" />Preview report</button>
        <div className="ms-auto fw-semibold">{sum(rows, "litres").toLocaleString()} L, {money(sum(rows, "total"))}</div>
      </div>
      <div className="card"><div className="table-responsive"><table className="table mb-0 align-middle">
        <thead><tr><th>Date</th>{admin && <th>Staff</th>}<th>Item</th><th className="text-end">Qty</th><th className="text-end">Litres</th><th className="text-end">Total</th><th>Receipt</th>{canInv && <th>Invoice</th>}{admin && <th />}</tr></thead>
        <tbody>
          {pg.rows.map((s) => (
            <tr key={s.id}><td>{s.date}</td>{admin && <td>{s.userName}</td>}<td>{s.productName}</td><td className="text-end">{s.qty}</td><td className="text-end">{s.litres}</td><td className="text-end">{money(s.total)}</td><td><button className="btn btn-sm btn-outline-secondary text-nowrap" onClick={() => setRc(s)}><i className="bi bi-receipt me-1" />{s.receiptNo || "View"}</button></td>{canInv && <td>{(() => { const iv = invOf(s); return iv ? <button className="btn btn-sm btn-outline-primary text-nowrap" onClick={() => setIvv({ id: iv.id, inv: iv })}><i className="bi bi-file-earmark-text me-1" />{iv.no}</button> : <button className="btn btn-sm btn-outline-secondary text-nowrap" onClick={() => setGen(s)}><i className="bi bi-file-earmark-plus me-1" />Generate</button>; })()}</td>}
              {admin && <td className="text-end"><button className="btn btn-sm btn-outline-danger" onClick={() => del(s)} aria-label="Delete"><i className="bi bi-trash" /></button></td>}</tr>
          ))}
          {!rows.length && <tr><td colSpan="9" className="text-center text-muted py-3">No sales for this selection.</td></tr>}
        </tbody></table></div>{pg.pager}</div>
    </>
  );
}

function WaterClose({ me, admin, bid, branch }) {
  const items = useCol("waterItems");
  const WS = useCol("waterSales", bid, !bid, "branchId");
  const LG = useCol("waterLogs", bid, !bid, "branchId");
  const blank = { date: today(), opening: "", received: "", closing: "", wasted: "0", cash: "", notes: "" };
  const [f, setF] = useState(blank);
  const prev = [...LG].filter((l) => l.date < f.date).sort((a, b) => b.date.localeCompare(a.date))[0];
  const existing = LG.find((l) => l.date === f.date);
  const day = WS.filter((s) => s.date === f.date);
  const sold = sum(day, "litres"), total = sum(day, "total");
  const opening = f.opening === "" ? (prev ? prev.closing : NaN) : +f.opening;
  const rec = num(f.received), clo = num(f.closing), was = num(f.wasted), cash = num(f.cash);
  const used = opening + rec - clo, lost = used - sold - was;
  const pct = used > 0 ? (lost / used) * 100 : 0;
  const avgRate = items.length ? items.reduce((a, i) => a + i.price / i.litres, 0) / items.length : 0;
  const lossValue = Math.max(lost, 0) * (sold ? total / sold : avgRate);
  const cashDiff = cash - total;
  const ready = [opening, rec, clo, was, cash].every((v) => Number.isFinite(v) && v >= 0) && used >= 0;
  const hist = usePage([...LG].sort((a, b) => b.date.localeCompare(a.date)));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = run(async (e) => {
    e.preventDefault();
    if (!ready) throw new Error("Fill in every litre and cash figure with numbers of 0 or more, and check that the closing litres are not higher than opening plus received.");
    if (existing && !admin) throw new Error("This day is already closed. Ask the administrator to correct it.");
    const r = (x) => Math.round(x * 100) / 100;
    await setDoc(doc(db, "waterLogs", `${bid}_${f.date}`), {
      branchId: bid, branchName: branch?.name || "", date: f.date, userId: me.id, userName: me.name || me.email,
      opening: r(opening), received: r(rec), closing: r(clo), wasted: r(was), cash: r(cash), notes: f.notes.trim(),
      sold: r(sold), salesTotal: r(total), used: r(used), lost: r(lost), lossPct: r(pct), lossValue: r(lossValue), cashDiff: r(cashDiff), createdAt: serverTimestamp(),
    });
    setF(blank);
  });
  const edit = (l) => { setF({ date: l.date, opening: String(l.opening), received: String(l.received), closing: String(l.closing), wasted: String(l.wasted), cash: String(l.cash), notes: l.notes || "" }); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const del = run(async (l) => { if (confirm("Delete this daily close?")) await deleteDoc(doc(db, "waterLogs", l.id)); });
  const fmt = (v) => (ready ? v : "-");
  return (
    <>
      <form onSubmit={save} className="card mb-3">
        <div className="card-header fw-semibold"><Icon n="clipboard-check" />Daily close{existing && <span className="badge text-bg-secondary ms-2">{admin ? "Updating an existing close" : "Already closed"}</span>}</div>
        <div className="card-body">
          <div className="row g-3 mb-3">
            <Field cls="col-sm-6 col-lg-3" label="Date" type="date" max={today()} value={f.date} onChange={set("date")} required />
            <Field cls="col-sm-6 col-lg-3" label="Opening litres" type="number" min="0" step="any" placeholder={prev ? String(prev.closing) : "Litres in tank"} value={f.opening} onChange={set("opening")} />
            <Field cls="col-sm-6 col-lg-3" label="Litres received" type="number" min="0" step="any" value={f.received} onChange={set("received")} required />
            <Field cls="col-sm-6 col-lg-3" label="Closing litres" type="number" min="0" step="any" value={f.closing} onChange={set("closing")} required />
            <Field cls="col-sm-6 col-lg-3" label="Wasted litres" type="number" min="0" step="any" value={f.wasted} onChange={set("wasted")} required />
            <Field cls="col-sm-6 col-lg-3" label="Cash collected" type="number" min="0" step="any" value={f.cash} onChange={set("cash")} required />
            <Field cls="col-lg-6" label="Notes" value={f.notes} onChange={set("notes")} />
          </div>
          <div className="small text-muted mb-3">Wasted litres are backwash, rinsing and spills you can account for. Cash collected includes M-Pesa and cash.</div>
          <div className="row g-3">
            <div className="col-6 col-lg-3"><Stat i="droplet-half" l="Litres sold (recorded)" v={`${sold.toLocaleString()} L`} /></div>
            <div className="col-6 col-lg-3"><Stat i="cash-coin" l="Sales recorded" v={money(total)} /></div>
            <div className="col-6 col-lg-3"><Stat i="exclamation-triangle" l="Litres unaccounted" v={ready ? <>{lost.toFixed(1)} L ({pct.toFixed(1)}%) {lossBadge(pct)}</> : "-"} /></div>
            <div className="col-6 col-lg-3"><Stat i="wallet2" l="Cash vs sales" v={ready ? <span className={cashDiff < 0 ? "text-danger" : ""}>{money(cashDiff)}</span> : "-"} /></div>
          </div>
        </div>
        <div className="card-footer bg-white d-flex gap-2"><button className="btn btn-primary"><Icon n="lock" />Save daily close</button>{admin && <button type="button" className="btn btn-light" onClick={() => setF(blank)}><Icon n="arrow-counterclockwise" />Reset</button>}<span className="ms-auto small text-muted align-self-center d-none d-md-inline">{fmt(`Water through meter: ${used.toFixed(1)} L`)}</span></div>
      </form>
      <div className="card"><div className="card-header fw-semibold"><Icon n="clock-history" />Close history</div><div className="table-responsive"><table className="table mb-0 align-middle">
        <thead><tr><th>Date</th><th className="text-end">Sold L</th><th className="text-end">Lost L</th><th className="text-end">Loss %</th><th className="text-end">Cash diff</th><th>Status</th>{admin && <th />}</tr></thead>
        <tbody>
          {hist.rows.map((l) => (
            <tr key={l.id}><td>{l.date}</td><td className="text-end">{l.sold}</td><td className="text-end">{l.lost}</td><td className="text-end">{l.lossPct}%</td>
              <td className={`text-end ${l.cashDiff < 0 ? "text-danger" : ""}`}>{money(l.cashDiff)}</td><td>{lossBadge(l.lossPct)}</td>
              {admin && <td className="text-nowrap text-end"><button className="btn btn-sm btn-outline-primary me-1" onClick={() => edit(l)} aria-label="Edit"><i className="bi bi-pencil" /></button>
                <button className="btn btn-sm btn-outline-danger" onClick={() => del(l)} aria-label="Delete"><i className="bi bi-trash" /></button></td>}</tr>
          ))}
          {!LG.length && <tr><td colSpan="7" className="text-center text-muted py-3">No closes yet.</td></tr>}
        </tbody></table></div>{hist.pager}</div>
    </>
  );
}

function WaterLoss() {
  const B = useCol("branches"), LG = useCol("waterLogs"), WS = useCol("waterSales");
  const [n, setN] = useState(30), [bf, setBf] = useState("");
  const WB = B.filter((b) => b.type === "water");
  const from = ago(n - 1);
  const R = LG.filter((l) => l.date >= from && (!bf || l.branchId === bf)).sort((a, b) => b.date.localeCompare(a.date));
  const pg = usePage(R);
  const closed = new Set(LG.map((l) => `${l.branchId}_${l.date}`));
  const unclosed = {};
  WS.forEach((s) => { if (s.date >= from && s.date < today() && !closed.has(`${s.branchId}_${s.date}`)) (unclosed[s.branchId] = unclosed[s.branchId] || new Set()).add(s.date); });
  const rows = WB.filter((b) => !bf || b.id === bf).map((b) => {
    const r = R.filter((l) => l.branchId === b.id), used = sum(r, "used"), lost = sum(r, "lost");
    return { b, n: r.length, lost, pct: used > 0 ? (lost / used) * 100 : 0, val: sum(r, "lossValue"), short: r.reduce((a, l) => a + Math.min(+l.cashDiff || 0, 0), 0), un: unclosed[b.id]?.size || 0 };
  }).sort((x, y) => y.val - x.val);
  const cards = [["droplet-half", "Litres unaccounted", `${sum(R, "lost").toFixed(0)} L`], ["cash-coin", "Value of lost water", money(sum(R, "lossValue"))],
    ["wallet2", "Cash shortages", money(Math.abs(rows.reduce((a, r) => a + r.short, 0)))], ["calendar-x", "Days not closed", rows.reduce((a, r) => a + r.un, 0)]];
  return (
    <>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <h5 className="mb-0 me-auto"><Icon n="shield-exclamation" />Loss control</h5>
        <select className="form-select w-auto" value={bf} onChange={(e) => setBf(e.target.value)}><option value="">All water branches</option>{WB.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <select className="form-select w-auto" value={n} onChange={(e) => setN(+e.target.value)}>{[7, 14, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select>
        <button className="btn btn-outline-primary" disabled={!R.length} onClick={() => showPreview({ title: "Water Loss Control Report", scope: bf ? WB.find((b) => b.id === bf)?.name || "Branch" : "All water branches", from, to: today(), sections: [{ name: "Daily Closes", type: "table", money: [6, 7, 8, 9], head: ["Date", "Branch", "Staff", "Sold L", "Lost L", "Loss %", "Loss value", "Sales", "Cash collected", "Cash difference"], rows: R.map((l) => [l.date, l.branchName, l.userName, l.sold, l.lost, l.lossPct, l.lossValue, l.salesTotal, l.cash, l.cashDiff]) }] }, `water-loss-report-${today()}`)}><Icon n="eye" />Preview report</button>
      </div>
      <div className="row g-3 mb-3">{cards.map(([i, l, v]) => <div className="col-6 col-lg-3" key={l}><Stat i={i} l={l} v={v} /></div>)}</div>
      <div className="card mb-3"><div className="card-header fw-semibold"><Icon n="droplet-half" />Branch comparison</div><div className="table-responsive"><table className="table mb-0 align-middle">
        <thead><tr><th>Branch</th><th className="text-end">Closes</th><th className="text-end">Litres lost</th><th className="text-end">Loss %</th><th className="text-end">Value lost</th><th className="text-end">Cash short</th><th className="text-end">Days not closed</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.b.id}><td>{r.b.name}</td><td className="text-end">{r.n}</td><td className="text-end">{r.lost.toFixed(0)}</td><td className="text-end">{r.pct.toFixed(1)}% {lossBadge(r.pct)}</td>
              <td className="text-end">{money(r.val)}</td><td className={`text-end ${r.short < 0 ? "text-danger" : ""}`}>{money(Math.abs(r.short))}</td><td className={`text-end ${r.un ? "text-danger fw-semibold" : ""}`}>{r.un}</td></tr>
          ))}
          {!rows.length && <tr><td colSpan="7" className="text-center text-muted py-3">No water branches yet.</td></tr>}
        </tbody></table></div></div>
      <div className="card"><div className="card-header fw-semibold"><Icon n="journal-text" />Daily closes</div><div className="table-responsive"><table className="table mb-0 align-middle">
        <thead><tr><th>Date</th><th>Branch</th><th>Staff</th><th className="text-end">Sold L</th><th className="text-end">Lost L</th><th className="text-end">Loss %</th><th className="text-end">Cash diff</th><th>Status</th></tr></thead>
        <tbody>
          {pg.rows.map((l) => (
            <tr key={l.id}><td>{l.date}</td><td>{l.branchName}</td><td>{l.userName}</td><td className="text-end">{l.sold}</td><td className="text-end">{l.lost}</td><td className="text-end">{l.lossPct}%</td>
              <td className={`text-end ${l.cashDiff < 0 ? "text-danger" : ""}`}>{money(l.cashDiff)}</td><td>{lossBadge(l.lossPct)}</td></tr>
          ))}
          {!R.length && <tr><td colSpan="8" className="text-center text-muted py-3">No daily closes in this period.</td></tr>}
        </tbody></table></div>{pg.pager}</div>
    </>
  );
}

function WaterPrices() {
  const I = useCol("waterItems");
  const [f, setF] = useState(null);
  const pg = usePage([...I].sort((a, b) => a.litres - b.litres));
  const save = run(async (e) => {
    e.preventDefault();
    const { id, ...d } = f;
    const data = { name: d.name.trim(), litres: +d.litres, price: +d.price };
    if (!data.name || !(data.litres > 0) || !(data.price >= 0)) throw new Error("Enter a name, litres above 0 and a price of 0 or more.");
    if (id) await updateDoc(doc(db, "waterItems", id), data); else await addDoc(collection(db, "waterItems"), data);
    setF(null);
  });
  const del = run(async (i) => { if (confirm(`Delete ${i.name}? Past sales keep their recorded prices.`)) await deleteDoc(doc(db, "waterItems", i.id)); });
  return (
    <>
      <div className="d-flex mb-3"><h5 className="mb-0 me-auto"><Icon n="tags" />Price list</h5><button className="btn btn-primary" onClick={() => setF({ name: "", litres: "", price: "" })}><Icon n="plus-lg" />Add item</button></div>
      {f && (
        <form onSubmit={save} className="card card-body mb-3"><h6 className="fw-bold mb-3"><Icon n="droplet" />{f.id ? "Edit item" : "New item"}</h6>
          <div className="row g-2">
            <Field cls="col-md-4" label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
            <Field cls="col-md-4" label="Litres" type="number" min="0.1" step="any" value={f.litres} onChange={(e) => setF({ ...f, litres: e.target.value })} required />
            <Field cls="col-md-4" label="Price" type="number" min="0" step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required />
            <div className="col-12 d-flex gap-2"><button className="btn btn-primary"><Icon n="check-lg" />Save item</button><button type="button" className="btn btn-light" onClick={() => setF(null)}><Icon n="x-lg" />Cancel</button></div>
          </div></form>
      )}
      <div className="card"><div className="table-responsive"><table className="table mb-0 align-middle">
        <thead><tr><th>Item</th><th className="text-end">Litres</th><th className="text-end">Price</th><th className="text-end">Per litre</th><th /></tr></thead>
        <tbody>
          {pg.rows.map((i) => (
            <tr key={i.id}><td>{i.name}</td><td className="text-end">{i.litres}</td><td className="text-end">{money(i.price)}</td><td className="text-end">{money(i.price / i.litres)}</td>
              <td className="text-nowrap text-end"><button className="btn btn-sm btn-outline-primary me-1" onClick={() => setF({ ...i })} aria-label="Edit"><i className="bi bi-pencil" /></button>
                <button className="btn btn-sm btn-outline-danger" onClick={() => del(i)} aria-label="Delete"><i className="bi bi-trash" /></button></td></tr>
          ))}
          {!I.length && <tr><td colSpan="5" className="text-center text-muted py-3">No items yet.</td></tr>}
        </tbody></table></div>{pg.pager}</div>
    </>
  );
}

/* ---------- invoices ---------- */
const InvBadge = ({ inv }) => {
  const s = invStatus(inv, today());
  return <span className={`badge text-bg-${{ Paid: "success", "Partially paid": "info", Unpaid: "warning", Overdue: "danger", Cancelled: "secondary" }[s]}`}>{s}</span>;
};
function useDocById(col, id) {
  const [d, setD] = useState(null);
  useEffect(() => { if (!id) return; return onSnapshot(doc(db, col, id), (s) => setD(s.exists() ? { id: s.id, ...s.data() } : null), () => setD(null)); }, [col, id]);
  return d;
}
async function createInvoice({ me, admin, sales, f, due, biz }) {
  if (!f.name.trim()) throw new Error("Enter the customer's name.");
  if (!sales.length) throw new Error("Select at least one sale to invoice.");
  const branchId = admin ? sales[0].branchId || "" : me.branchId || "";
  if (admin && sales.some((s) => (s.branchId || "") !== branchId)) throw new Error("Select sales from one branch only.");
  const items = sales.map((s) => ({ saleId: s.id, desc: s.productName, receiptNo: s.receiptNo || "", qty: s.qty, price: s.unitPrice, total: s.total, date: s.date }));
  return runTransaction(db, async (t) => {
    const cr = doc(db, "counters", "invoices"), c = await t.get(cr), n = (c.exists() ? c.data().n || 0 : 0) + 1;
    const ref = doc(collection(db, "invoices"));
    const data = {
      no: serial("INV", n), branchId, userId: me.id, userName: me.name || me.email, customerName: f.name.trim(), customerPhone: f.phone.trim(), customerEmail: f.email.trim(), customerAddress: f.address.trim(),
      date: today(), dueDate: due, items, vatRate: biz.vatRate, payInfo: biz.payInfo, notes: f.notes.trim(), total: items.reduce((a, x) => a + x.total, 0), paid: 0, status: "unpaid", payments: [],
    };
    t.set(cr, { n });
    t.set(ref, { ...data, createdAt: serverTimestamp() });
    return { id: ref.id, ...data, createdAt: new Date() };
  });
}
const recordPayment = run(async (inv, p, me) => {
  const amt = +p.amount;
  await runTransaction(db, async (t) => {
    const r = doc(db, "invoices", inv.id), s = await t.get(r);
    if (!s.exists()) throw new Error("Invoice not found.");
    const d = s.data(), bal = d.total - (d.paid || 0);
    if (d.status === "cancelled") throw new Error("This invoice is cancelled.");
    if (!(amt > 0) || amt > bal + 0.005) throw new Error(`Enter an amount between 0.01 and ${bal.toFixed(2)}.`);
    const payments = [...(d.payments || []), { date: p.date, amount: amt, method: p.method, by: me.name || me.email }];
    const paid = payments.reduce((a, x) => a + x.amount, 0);
    t.update(r, { payments, paid, status: paid >= d.total - 0.005 ? "paid" : "partial" });
  });
});

function InvoiceBody({ inv, biz, branch }) {
  const { vat, net } = invTotals(inv.items || [], inv.vatRate), bal = inv.total - (inv.paid || 0);
  return (
    <div className="invoice rc-print">
      <div className="d-flex flex-wrap justify-content-between gap-3">
        <div>
          <div className="d-flex align-items-center gap-2"><div className="rc-logo m-0" style={{ width: 44, height: 44, fontSize: "1.2rem" }}><i className="bi bi-building" /></div><h4 className="fw-bold mb-0" style={{ color: "#e8590c" }}>{biz.name}</h4></div>
          {biz.address && <div className="small mt-2"><i className="bi bi-geo-alt me-1" />{biz.address}</div>}
          {(biz.phone || biz.email) && <div className="small">{biz.phone && <span className="me-2"><i className="bi bi-telephone me-1" />{biz.phone}</span>}{biz.email && <span><i className="bi bi-envelope me-1" />{biz.email}</span>}</div>}
          {biz.pin && <div className="small">PIN: {biz.pin}</div>}
        </div>
        <div className="text-end"><h3 className="fw-bold mb-0">INVOICE</h3><div className="fw-bold text-primary">{inv.no}</div><div className="small">Date: {inv.date}</div><div className="small">Due: {inv.dueDate}</div><InvBadge inv={inv} /></div>
      </div>
      <hr />
      <div className="row g-3 mb-3">
        <div className="col-sm-6"><div className="small text-muted fw-semibold">BILL TO</div><div className="fw-bold">{inv.customerName}</div>
          {inv.customerPhone && <div className="small"><i className="bi bi-telephone me-1" />{inv.customerPhone}</div>}{inv.customerEmail && <div className="small"><i className="bi bi-envelope me-1" />{inv.customerEmail}</div>}{inv.customerAddress && <div className="small"><i className="bi bi-geo-alt me-1" />{inv.customerAddress}</div>}</div>
        <div className="col-sm-6"><div className="small text-muted fw-semibold">ISSUED BY</div><div className="fw-bold">{inv.userName}</div>{branch && <div className="small"><i className="bi bi-shop me-1" />{branch.name}</div>}</div>
      </div>
      <div className="table-responsive"><table className="table table-sm align-middle">
        <thead><tr><th>Description</th><th>Receipt</th><th className="text-end">Qty</th><th className="text-end">Unit price</th><th className="text-end">Amount</th></tr></thead>
        <tbody>{(inv.items || []).map((x, i) => <tr key={i}><td>{x.desc}</td><td>{x.receiptNo || "-"}</td><td className="text-end">{x.qty}</td><td className="text-end">{money(x.price)}</td><td className="text-end">{money(x.total)}</td></tr>)}</tbody>
      </table></div>
      <div className="ms-auto" style={{ maxWidth: 300 }}>
        {vat > 0 && <><div className="d-flex justify-content-between small"><span>Subtotal (excl. VAT)</span><span>{money(net)}</span></div><div className="d-flex justify-content-between small"><span>VAT ({inv.vatRate}%) included</span><span>{money(vat)}</span></div></>}
        <div className="d-flex justify-content-between fw-bold border-top pt-1"><span>Total</span><span>{money(inv.total)}</span></div>
        <div className="d-flex justify-content-between small"><span>Amount paid</span><span>{money(inv.paid || 0)}</span></div>
        <div className="d-flex justify-content-between fs-5 fw-bold" style={{ color: "#e8590c" }}><span>Balance due</span><span>{money(bal)}</span></div>
      </div>
      {(inv.payments || []).length > 0 && <div className="mt-3"><div className="small fw-semibold text-muted mb-1">PAYMENTS RECEIVED</div>
        <table className="table table-sm small mb-0"><tbody>{inv.payments.map((p, i) => <tr key={i}><td>{p.date}</td><td>{p.method}</td><td>{p.by}</td><td className="text-end">{money(p.amount)}</td></tr>)}</tbody></table></div>}
      {inv.notes && <div className="small mt-3"><b>Notes:</b> {inv.notes}</div>}
      {inv.payInfo && <div className="small mt-1"><b>Payment details:</b> {inv.payInfo}</div>}
      <div className="text-center small text-muted mt-3 border-top pt-3">{biz.footer}</div>
    </div>
  );
}
function InvoiceView({ id, fallback, me, onClose }) {
  const live = useDocById("invoices", id), inv = live || fallback;
  const biz = useBiz(), B = useCol("branches");
  const [p, setP] = useState({ amount: "", date: today(), method: "Cash" }), [sharing, setSharing] = useState(false);
  if (!inv) return null;
  const bal = inv.total - (inv.paid || 0), open = inv.status !== "cancelled" && bal > 0.005, branch = B.find((b) => b.id === inv.branchId);
  const pay = async (e) => { e.preventDefault(); await recordPayment(inv, p, me); setP({ amount: "", date: today(), method: "Cash" }); };
  const pdf = run(async () => { (await makeInvoicePdf(inv, DOC.get?.() || { business: biz.name, currency: CUR }, branch?.name || "")).save(`${inv.no}.pdf`); });
  const buildInv = async (fmt, pw) => (await makeInvoicePdf(inv, DOC.get?.() || { business: biz.name, currency: CUR }, branch?.name || "", { password: pw })).output("blob");
  return (
    <>
    <div className="modal d-block" style={{ background: "rgba(15,20,26,.55)", zIndex: 1400 }} onClick={onClose}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header d-print-none py-2"><h6 className="modal-title"><Icon n="file-earmark-text" />Invoice {inv.no}</h6><button className="btn-close" onClick={onClose} aria-label="Close" /></div>
          <div className="modal-body bg-light">
            <InvoiceBody inv={inv} biz={biz} branch={branch} />
            {open && (
              <form onSubmit={pay} className="card card-body mt-3 d-print-none">
                <h6 className="fw-bold mb-2"><Icon n="cash-coin" />Record a payment <span className="text-muted fw-normal small">(balance {money(bal)})</span></h6>
                <div className="row g-2 align-items-end">
                  <Field cls="col-6 col-md-3" label="Amount" type="number" min="0.01" step="0.01" max={bal.toFixed(2)} value={p.amount} onChange={(e) => setP({ ...p, amount: e.target.value })} required />
                  <Field cls="col-6 col-md-3" label="Date" type="date" max={today()} value={p.date} onChange={(e) => setP({ ...p, date: e.target.value })} required />
                  <div className="col-6 col-md-3"><label className="form-label small mb-1">Method</label><div className="input-group"><span className="input-group-text"><i className="bi bi-credit-card" /></span>
                    <select className="form-select" value={p.method} onChange={(e) => setP({ ...p, method: e.target.value })}>{["Cash", "M-Pesa", "Bank transfer", "Cheque"].map((m) => <option key={m}>{m}</option>)}</select></div></div>
                  <div className="col-6 col-md-3"><button className="btn btn-primary w-100"><Icon n="check-lg" />Save payment</button></div>
                </div>
              </form>
            )}
          </div>
          <div className="modal-footer d-print-none">
            <button className="btn btn-primary" onClick={pdf}><Icon n="file-earmark-pdf" />Download PDF</button>
            <button className="btn btn-success" onClick={() => setSharing(true)}><Icon n="share" />Share securely</button>
            <button className="btn btn-outline-primary" onClick={() => window.print()}><Icon n="printer" />Print</button>
            <button className="btn btn-light" onClick={onClose}><Icon n="x-lg" />Close</button>
          </div>
        </div>
      </div>
    </div>
    {sharing && <ShareModal title={`Invoice ${inv.no}`} base={inv.no} business={biz.name} detail={`Due ${inv.dueDate}`} cc={CC} formats={[["pdf", "PDF"]]} build={buildInv} to={{ email: inv.customerEmail || "", phone: inv.customerPhone || "" }} onClose={() => setSharing(false)} />}
    </>
  );
}
function InvoiceForm({ sales, me, admin, onDone }) {
  const biz = useBiz();
  const [f, setF] = useState({ name: "", phone: "", email: "", address: "", due: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const due = f.due || fmtD(new Date(Date.now() + biz.dueDays * 864e5));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const go = run(async (e) => {
    e.preventDefault(); setBusy(true);
    try { onDone(await createInvoice({ me, admin, sales, f, due, biz })); } finally { setBusy(false); }
  });
  return (
    <form onSubmit={go}>
      <div className="row g-2">
        <Field cls="col-md-6" label="Customer name" value={f.name} onChange={set("name")} required />
        <Field cls="col-md-6" label="Phone" type="tel" value={f.phone} onChange={set("phone")} />
        <Field cls="col-md-6" label="Email" type="email" value={f.email} onChange={set("email")} />
        <Field cls="col-md-6" label="Address" value={f.address} onChange={set("address")} />
        <Field cls="col-md-4" label="Due date" type="date" value={due} onChange={set("due")} required />
        <Field cls="col-md-8" label="Notes" value={f.notes} onChange={set("notes")} />
        <div className="col-12 d-flex flex-wrap align-items-center gap-2">
          <span className="me-auto small text-muted">{sales.length} sale{sales.length === 1 ? "" : "s"}, total {money(sum(sales, "total"))}{biz.vatRate > 0 ? `, VAT ${biz.vatRate}% included` : ""}</span>
          <button className="btn btn-primary" disabled={busy || !sales.length}><Icon n="file-earmark-plus" />Generate invoice</button>
        </div>
      </div>
    </form>
  );
}
function GenerateInvoice({ sale, me, admin, onClose, onDone }) {
  return (
    <div className="modal d-block" style={{ background: "rgba(15,20,26,.55)", zIndex: 1300 }} onClick={onClose}>
      <div className="modal-dialog modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header py-2"><h6 className="modal-title"><Icon n="file-earmark-plus" />Generate invoice</h6><button className="btn-close" onClick={onClose} aria-label="Close" /></div>
          <div className="modal-body">
            <div className="alert alert-light border small"><i className="bi bi-receipt me-1" />{sale.receiptNo || "Sale"}: {sale.qty} x {sale.productName}, {money(sale.total)}</div>
            <InvoiceForm sales={[sale]} me={me} admin={admin} onDone={onDone} />
          </div>
        </div>
      </div>
    </div>
  );
}
function NewInvoice({ me, admin, sales, taken, B, onDone, onClose }) {
  const [nb, setNb] = useState(admin ? "" : me.branchId || ""), [sel, setSel] = useState({}), [day, setDay] = useState("");
  const pool = sales.filter((s) => !taken.has(s.id) && (s.branchId || "") === nb && (!day || s.date === day)).sort((a, b) => b.date.localeCompare(a.date));
  const pg = usePage(pool, 5, [5, 10, 25]);
  const chosen = pool.filter((s) => sel[s.id]);
  return (
    <div className="card mb-3">
      <div className="card-header d-flex align-items-center"><span className="fw-semibold me-auto"><Icon n="file-earmark-plus" />New invoice</span><button className="btn btn-sm btn-light" onClick={onClose}><Icon n="x-lg" />Close</button></div>
      <div className="card-body">
        <div className="row g-2 mb-3">
          {admin && <div className="col-md-4"><label className="form-label small mb-1">Branch</label><div className="input-group"><span className="input-group-text"><i className="bi bi-shop" /></span>
            <select className="form-select" value={nb} onChange={(e) => { setNb(e.target.value); setSel({}); }}><option value="">Select branch</option>{B.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div></div>}
          <Field cls="col-md-4" label="Date" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          <div className="col-md-4 d-flex align-items-end gap-2"><button type="button" className="btn btn-outline-secondary" onClick={() => setSel(Object.fromEntries(pool.map((s) => [s.id, true])))}><Icon n="check2-all" />Select all</button><button type="button" className="btn btn-outline-secondary" onClick={() => setSel({})}><Icon n="x-circle" />Clear</button></div>
        </div>
        <div className="table-responsive border rounded mb-3"><table className="table table-sm mb-0 align-middle">
          <thead><tr><th style={{ width: 40 }} /><th>Date</th><th>Receipt</th><th>Item</th><th className="text-end">Qty</th><th className="text-end">Total</th></tr></thead>
          <tbody>
            {pg.rows.map((s) => <tr key={s.id}><td><input type="checkbox" className="form-check-input" checked={!!sel[s.id]} onChange={(e) => setSel({ ...sel, [s.id]: e.target.checked })} aria-label="Select sale" /></td><td>{s.date}</td><td>{s.receiptNo || "-"}</td><td>{s.productName}</td><td className="text-end">{s.qty}</td><td className="text-end">{money(s.total)}</td></tr>)}
            {!pool.length && <tr><td colSpan="6" className="text-center text-muted py-3">{nb ? "No sales waiting to be invoiced." : "Select a branch to see its sales."}</td></tr>}
          </tbody></table>{pg.pager}</div>
        <InvoiceForm sales={chosen} me={me} admin={admin} onDone={onDone} />
      </div>
    </div>
  );
}
function Invoices({ me, admin }) {
  const mine = me.branchId || "", B = useCol("branches");
  const IV = useCol("invoices", admin ? undefined : mine, !admin && !mine, "branchId");
  const H = useCol("sales", admin ? undefined : me.id, !admin && !mine);
  const W = useCol("waterSales", admin ? undefined : mine, !admin && !mine, "branchId");
  const [q, setQ] = useState(""), [sf, setSf] = useState(""), [bf, setBf] = useState(""), [view, setView] = useState(null), [nw, setNw] = useState(false);
  const t = today(), bal = (i) => (i.status === "cancelled" ? 0 : i.total - (i.paid || 0));
  const taken = new Set(IV.filter((i) => i.status !== "cancelled").flatMap((i) => (i.items || []).map((x) => x.saleId)));
  const list = IV.filter((i) => (!bf || i.branchId === bf) && (!sf || invStatus(i, t) === sf) && `${i.no} ${i.customerName}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no));
  const pg = usePage(list);
  const cancel = run(async (i) => { if (confirm(`Cancel ${i.no}? Its sales can be invoiced again.`)) await updateDoc(doc(db, "invoices", i.id), { status: "cancelled" }); });
  const cards = [["cash-coin", "Outstanding", money(IV.reduce((a, i) => a + bal(i), 0))], ["exclamation-triangle", "Overdue", money(IV.filter((i) => invStatus(i, t) === "Overdue").reduce((a, i) => a + bal(i), 0))],
    ["check2-circle", "Collected", money(IV.filter((i) => i.status !== "cancelled").reduce((a, i) => a + (i.paid || 0), 0))], ["file-earmark-text", "Invoices", IV.filter((i) => i.status !== "cancelled").length]];
  return (
    <>
      <div className="row g-3 mb-3">{cards.map(([i, l, v]) => <div className="col-6 col-lg-3" key={l}><Stat i={i} l={l} v={v} /></div>)}</div>
      <div className="row g-2 mb-3">
        <div className="col-md"><div className="input-group"><span className="input-group-text"><i className="bi bi-search" /></span><input className="form-control" placeholder="Search invoice number or customer" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        <div className="col-6 col-md-2"><select className="form-select" value={sf} onChange={(e) => setSf(e.target.value)} aria-label="Status"><option value="">All statuses</option>{["Unpaid", "Partially paid", "Overdue", "Paid", "Cancelled"].map((s) => <option key={s}>{s}</option>)}</select></div>
        {admin && <div className="col-6 col-md-2"><select className="form-select" value={bf} onChange={(e) => setBf(e.target.value)} aria-label="Branch"><option value="">All branches</option>{B.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
        <div className="col-12 col-md-auto d-flex gap-2">
          <button className="btn btn-outline-primary" disabled={!list.length} onClick={() => showPreview({ title: "Invoice Register", scope: bf ? B.find((b) => b.id === bf)?.name || "Branch" : admin ? "All branches" : "My branch", from: "All dates", to: t,
            sections: [{ name: "Invoices", type: "table", money: [4, 5, 6], head: ["Invoice", "Date", "Customer", "Status", "Total", "Paid", "Balance"], rows: list.map((i) => [i.no, i.date, i.customerName, invStatus(i, t), i.total, i.paid || 0, bal(i)]) }] }, `invoice-register-${t}`)}><Icon n="eye" />Preview list</button>
          <button className="btn btn-primary" onClick={() => setNw(true)}><Icon n="plus-lg" />New invoice</button>
        </div>
      </div>
      {nw && <NewInvoice me={me} admin={admin} sales={[...H, ...W]} taken={taken} B={B} onClose={() => setNw(false)} onDone={(inv) => { setNw(false); setView({ id: inv.id, inv }); }} />}
      <div className="card"><div className="table-responsive"><table className="table table-hover mb-0 align-middle">
        <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th>{admin && <th>Branch</th>}<th className="text-end">Total</th><th className="text-end">Balance</th><th>Status</th><th /></tr></thead>
        <tbody>
          {pg.rows.map((i) => (
            <tr key={i.id}><td className="fw-semibold text-nowrap">{i.no}</td><td>{i.date}</td><td>{i.customerName}</td>{admin && <td>{B.find((b) => b.id === i.branchId)?.name || "-"}</td>}
              <td className="text-end">{money(i.total)}</td><td className="text-end">{money(bal(i))}</td><td><InvBadge inv={i} /></td>
              <td className="text-nowrap text-end"><button className="btn btn-sm btn-outline-primary me-1" onClick={() => setView({ id: i.id, inv: i })} aria-label="View invoice" title="View / record payment"><i className="bi bi-eye" /></button>
                {admin && i.status !== "cancelled" && <button className="btn btn-sm btn-outline-danger" onClick={() => cancel(i)} aria-label="Cancel invoice" title="Cancel invoice"><i className="bi bi-x-circle" /></button>}</td></tr>
          ))}
          {!list.length && <tr><td colSpan="8" className="text-center text-muted py-3">No invoices yet. Use New invoice, or Generate on any sale.</td></tr>}
        </tbody></table></div>{pg.pager}</div>
      {view && <InvoiceView id={view.id} fallback={view.inv} me={me} onClose={() => setView(null)} />}
    </>
  );
}

/* ---------- settings (admin) ---------- */
function Settings({ me }) {
  const biz = useBiz();
  const [f, setF] = useState(null);
  const [ok, setOk] = useState(false);
  const cur = f || biz;
  const set = (k) => (e) => setF({ ...cur, [k]: e.target.value });
  const save = run(async (e) => {
    e.preventDefault();
    const t = (k) => (cur[k] || "").trim();
    await setDoc(doc(db, "settings", "business"), { name: t("name"), tagline: t("tagline"), address: t("address"), phone: t("phone"), email: t("email"), pin: t("pin"), footer: t("footer"), vatRate: Math.max(0, +cur.vatRate || 0), dueDays: Math.max(0, Math.floor(+cur.dueDays) || 0), payInfo: t("payInfo") });
    setF(null); setOk(true); setTimeout(() => setOk(false), 2500);
  });
  const sample = { receiptNo: "HW-000123", date: today(), createdAt: new Date(), userName: me.name || me.email, productName: "Claw hammer 16oz", qty: 2, unitPrice: 650, total: 1300 };
  return (
    <div className="row g-3">
      <div className="col-lg-7"><form onSubmit={save} className="card">
        <div className="card-header fw-semibold"><Icon n="building" />Business details (shown on receipts)</div>
        <div className="card-body"><div className="row g-3">
          <Field cls="col-md-6" label="Business name" value={cur.name} onChange={set("name")} required />
          <Field cls="col-md-6" label="Tagline" value={cur.tagline} onChange={set("tagline")} />
          <Field cls="col-12" label="Address" value={cur.address} onChange={set("address")} />
          <Field cls="col-md-6" label="Phone" type="tel" value={cur.phone} onChange={set("phone")} />
          <Field cls="col-md-6" label="Email" type="email" value={cur.email} onChange={set("email")} />
          <Field cls="col-md-6" label="KRA PIN" value={cur.pin} onChange={set("pin")} />
          <Field cls="col-md-6" label="Receipt footer" value={cur.footer} onChange={set("footer")} />
          <Field cls="col-md-6" label="VAT rate (%)" type="number" min="0" step="0.01" value={cur.vatRate} onChange={set("vatRate")} />
          <Field cls="col-md-6" label="Payment terms (days)" type="number" min="0" step="1" value={cur.dueDays} onChange={set("dueDays")} />
          <Field cls="col-12" label="Payment details" value={cur.payInfo} onChange={set("payInfo")} />
        </div></div>
        <div className="card-footer bg-white d-flex align-items-center gap-3"><button className="btn btn-primary"><Icon n="check-lg" />Save details</button>{ok && <span className="text-success small"><i className="bi bi-check-circle me-1" />Saved</span>}</div>
      </form></div>
      <div className="col-lg-5"><div className="card"><div className="card-header fw-semibold"><Icon n="eye" />Receipt preview</div><div className="card-body bg-light"><ReceiptBody s={sample} biz={{ ...biz, ...Object.fromEntries(Object.entries(cur).filter(([, v]) => v)) }} /></div></div></div>
    </div>
  );
}

/* ---------- branches (admin) ---------- */
function Branches() {
  const B = useCol("branches"), U = useCol("users"), S0 = useCol("sales"), W0 = useCol("waterSales");
  const S = [...S0, ...W0];
  const [f, setF] = useState(null);
  const since = ago(29);
  const bid = (s) => s.branchId ?? U.find((u) => u.id === s.userId)?.branchId ?? "";
  const waiting = U.filter((u) => !u.branchId && u.role === "user");
  const pg = usePage([...B].sort((a, b) => (a.name || "").localeCompare(b.name || "")), 6, [6, 12, 24]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = run(async (e) => {
    e.preventDefault();
    const { id, ...d } = f;
    const data = { name: d.name.trim(), location: (d.location || "").trim(), phone: (d.phone || "").trim(), type: d.type === "water" ? "water" : "hardware" };
    if (id) await updateDoc(doc(db, "branches", id), data); else await addDoc(collection(db, "branches"), { ...data, createdAt: serverTimestamp() });
    setF(null);
  });
  const del = run(async (b) => {
    if (!confirm(`Delete ${b.name}? Its staff become unassigned.`)) return;
    await Promise.all(U.filter((u) => u.branchId === b.id).map((u) => updateDoc(doc(db, "users", u.id), { branchId: "" })));
    await deleteDoc(doc(db, "branches", b.id));
  });
  const assign = run(async (u, branchId) => { if (u) await updateDoc(doc(db, "users", u.id), { branchId }); });
  return (
    <>
      <div className="d-flex align-items-center mb-3">
        <div className="text-muted">{B.length} branch{B.length === 1 ? "" : "es"}</div>
        <button className="btn btn-primary ms-auto" onClick={() => setF({ name: "", location: "", phone: "", type: "hardware" })}><Icon n="plus-lg" />Add branch</button>
      </div>
      {f && (
        <form onSubmit={save} className="card card-body mb-3">
          <h6 className="fw-bold mb-3"><Icon n="shop" />{f.id ? "Edit branch" : "New branch"}</h6>
          <div className="row g-2">
            <Field cls="col-md-3" label="Name" value={f.name} onChange={set("name")} required />
            <Field cls="col-md-3" label="Location" value={f.location || ""} onChange={set("location")} />
            <Field cls="col-md-3" label="Phone" type="tel" value={f.phone || ""} onChange={set("phone")} />
            <div className="col-md-3"><label className="form-label small mb-1">Type</label><div className="input-group"><span className="input-group-text"><i className="bi bi-diagram-3" /></span>
              <select className="form-select" value={f.type || "hardware"} onChange={set("type")}><option value="hardware">Hardware shop</option><option value="water">Water refilling</option></select></div></div>
            <div className="col-12 d-flex gap-2"><button className="btn btn-primary"><Icon n="check-lg" />Save branch</button><button type="button" className="btn btn-light" onClick={() => setF(null)}><Icon n="x-lg" />Cancel</button></div>
          </div>
        </form>
      )}
      {waiting.length > 0 && (
        <div className="card border-warning mb-3"><div className="card-header fw-semibold"><Icon n="person-plus" />New staff waiting for a branch ({waiting.length})</div>
          <ul className="list-group list-group-flush">
            {waiting.map((u) => (
              <li className="list-group-item d-flex flex-wrap align-items-center gap-2" key={u.id}>
                <Avatar u={u} />
                <div className="me-auto" style={{ minWidth: 0 }}><div className="fw-semibold text-truncate">{u.name || u.email}</div><div className="small text-muted text-truncate"><VerifiedEmail email={u.email} /></div></div>
                <select className="form-select w-auto" value="" onChange={(e) => e.target.value && assign(u, e.target.value)}>
                  <option value="">Assign to branch</option>{B.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.type === "water" ? "Water" : "Hardware"})</option>)}
                </select>
              </li>
            ))}
          </ul></div>
      )}
      <div className="row g-3">
        {pg.rows.map((b) => {
          const staff = U.filter((u) => u.branchId === b.id && u.role !== "removed");
          const rev = S.filter((s) => s.date >= since && bid(s) === b.id).reduce((a, s) => a + s.total, 0);
          return (
            <div className="col-md-6 col-xl-4" key={b.id}>
              <div className="card h-100">
                <div className="card-header d-flex align-items-center gap-2">
                  <span className="stat-ico" style={{ width: 38, height: 38, fontSize: "1rem" }}><i className={`bi bi-${b.type === "water" ? "droplet-half" : "shop"}`} /></span>
                  <div className="me-auto" style={{ minWidth: 0 }}>
                    <div className="fw-bold text-truncate">{b.name}<span className={`badge ms-2 ${b.type === "water" ? "text-bg-info" : "text-bg-secondary"}`}>{b.type === "water" ? "Water" : "Hardware"}</span></div>
                    <div className="small text-muted text-truncate"><i className="bi bi-geo-alt me-1" />{b.location || "No location"}{b.phone ? `, ${b.phone}` : ""}</div>
                  </div>
                  <button className="btn btn-sm btn-outline-primary" onClick={() => setF({ ...b })} aria-label="Edit branch"><i className="bi bi-pencil" /></button>
                  <button className="btn btn-sm btn-outline-danger" onClick={() => del(b)} aria-label="Delete branch"><i className="bi bi-trash" /></button>
                </div>
                <div className="card-body">
                  <div className="row text-center mb-3">
                    <div className="col-5"><div className="fs-5 fw-bold">{staff.length}</div><div className="small text-muted">Staff</div></div>
                    <div className="col-7"><div className="fs-5 fw-bold">{money(rev)}</div><div className="small text-muted">Sales, 30 days</div></div>
                  </div>
                  <ul className="list-unstyled mb-3">
                    {staff.map((u) => (
                      <li className="d-flex align-items-center gap-2 mb-2" key={u.id}>
                        <Avatar u={u} />
                        <div className="me-auto" style={{ minWidth: 0 }}><div className="text-truncate">{u.name || u.email}</div><div className="small text-muted text-truncate"><VerifiedEmail email={u.email} /></div></div>
                        <button className="btn btn-sm btn-outline-secondary" title="Remove from branch" aria-label="Remove from branch" onClick={() => assign(u, "")}><i className="bi bi-x-lg" /></button>
                      </li>
                    ))}
                    {!staff.length && <li className="text-muted small">No staff assigned yet.</li>}
                  </ul>
                  <div className="input-group">
                    <span className="input-group-text"><i className="bi bi-person-plus" /></span>
                    <select className="form-select" value="" onChange={(e) => e.target.value && assign(U.find((u) => u.id === e.target.value), b.id)}>
                      <option value="">Add staff member</option>
                      {U.filter((u) => u.branchId !== b.id && u.role !== "removed").map((u) => <option key={u.id} value={u.id}>{u.name || u.email}{u.branchId ? " (moves from another branch)" : ""}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {!B.length && <div className="col-12"><div className="card card-body text-center text-muted py-5"><i className="bi bi-shop fs-1" />Add your first branch, then assign staff to it.</div></div>}
      </div>
      {pg.pager && <div className="card mt-3">{pg.pager}</div>}
    </>
  );
}

/* ---------- users (admin) ---------- */
function Users({ me }) {
  const U = useCol("users"), B = useCol("branches");
  const [q, setQ] = useState(""), [bf, setBf] = useState("");
  const list = U.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()) && (!bf || u.branchId === bf))
    .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || ""));
  const pg = usePage(list);
  const set = run(async (u, d) => updateDoc(doc(db, "users", u.id), d));
  const del = run(async (u) => { if (confirm(`Remove access for ${u.email}? You can restore it later by changing their role.`)) await updateDoc(doc(db, "users", u.id), { role: "removed" }); });
  return (
    <>
      <div className="row g-2 mb-3">
        <div className="col-md"><div className="input-group"><span className="input-group-text"><i className="bi bi-search" /></span>
          <input className="form-control" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        <div className="col-md-4"><div className="input-group"><span className="input-group-text"><i className="bi bi-shop" /></span>
          <select className="form-select" value={bf} onChange={(e) => setBf(e.target.value)}><option value="">All branches</option>{B.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div></div>
      </div>
      <div className="card"><div className="table-responsive"><table className="table table-hover mb-0 align-middle">
        <thead><tr><th>Staff</th><th>Email</th><th>Phone</th><th>Branch</th><th>Role</th><th /></tr></thead>
        <tbody>
          {pg.rows.map((u) => (
            <tr key={u.id}>
              <td><div className="d-flex align-items-center gap-2"><Avatar u={u} /><span className="text-nowrap">{u.name || "-"}</span></div></td>
              <td><VerifiedEmail email={u.email} /></td><td>{u.phone}</td>
              <td><select className="form-select form-select-sm" style={{ minWidth: 130 }} value={u.branchId || ""} onChange={(e) => set(u, { branchId: e.target.value })}>
                <option value="">No branch</option>{B.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></td>
              <td><select className="form-select form-select-sm" style={{ minWidth: 100 }} value={u.role} disabled={u.id === me.id} onChange={(e) => set(u, { role: e.target.value })}>
                <option value="user">User</option><option value="admin">Admin</option><option value="removed">Removed</option></select></td>
              <td className="text-end"><button className="btn btn-sm btn-outline-danger" disabled={u.id === me.id} onClick={() => del(u)} aria-label="Remove access" title="Remove access"><i className="bi bi-person-x" /></button></td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan="6" className="text-center text-muted py-3">No users found.</td></tr>}
        </tbody></table></div>{pg.pager}</div>
    </>
  );
}

/* ---------- profile ---------- */
function Profile({ me }) {
  const B = useCol("branches");
  const [f, setF] = useState({ name: me.name || "", phone: me.phone || "" });
  const [ok, setOk] = useState("");
  const flash = (t) => { setOk(t); setTimeout(() => setOk(""), 2500); };
  const save = run(async (e) => { e.preventDefault(); await updateDoc(doc(db, "users", me.id), { name: f.name.trim(), phone: f.phone.trim() }); flash("Profile saved"); });
  const pick = run(async (e) => {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    await updateDoc(doc(db, "users", me.id), { photoURL: await toAvatar(file) }); flash("Photo updated");
  });
  const clear = run(async () => { await updateDoc(doc(db, "users", me.id), { photoURL: "" }); flash("Photo removed"); });
  const branch = B.find((b) => b.id === me.branchId);
  return (
    <div className="row g-3">
      <div className="col-lg-4"><div className="card h-100"><div className="card-body text-center py-4">
        <Avatar u={me} size="avatar-lg" />
        <h5 className="mt-3 mb-0">{me.name || "Unnamed"}</h5>
        <div className="text-muted small mb-2 text-break"><VerifiedEmail email={me.email} /></div>
        <span className="badge text-bg-warning me-1">{me.role === "admin" ? "Administrator" : "Staff"}</span>
        <span className="badge text-bg-light border"><i className="bi bi-shop me-1" />{branch ? branch.name : "No branch yet"}</span>
        <div className="d-flex justify-content-center gap-2 mt-3">
          <label className="btn btn-sm btn-outline-primary mb-0"><i className="bi bi-camera me-1" />Change photo<input type="file" accept="image/*" hidden onChange={pick} /></label>
          {me.photoURL && <button className="btn btn-sm btn-outline-secondary" onClick={clear}><i className="bi bi-trash me-1" />Remove</button>}
        </div>
      </div></div></div>
      <div className="col-lg-8"><form onSubmit={save} className="card"><div className="card-header fw-semibold"><Icon n="person-vcard" />Personal details</div>
        <div className="card-body"><div className="row g-3">
          <Field cls="col-12" label="Email" value={me.email || ""} disabled readOnly suffix={<span className="input-group-text bg-white verified-label"><Verified /><span className="small ms-1">Verified</span></span>} />
          <Field cls="col-md-6" label="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          <Field cls="col-md-6" label="Phone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </div></div>
        <div className="card-footer bg-white d-flex align-items-center gap-3"><button className="btn btn-primary"><Icon n="check-lg" />Save profile</button>{ok && <span className="text-success small"><i className="bi bi-check-circle me-1" />{ok}</span>}</div>
      </form></div>
    </div>
  );
}
