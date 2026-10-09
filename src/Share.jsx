import { useEffect, useState } from "react";
import { EMAIL_RE, MIME, NOTICE, normalizePhone, waUrl, mailUrl, lastFour, saveBlob, canShareFile, safeName } from "./share.js";

// Props: title, base (file name without extension), business, detail, formats [[ext, label]], build(ext, password) -> Promise<Blob>,
// to {email, phone} (optional defaults), cc (default country code), onClose.
export default function ShareModal({ title, base, business = "", detail = "", formats, build, to = {}, cc = "254", onClose }) {
  const [fmt, setFmt] = useState(formats[0][0]);
  const [protect, setProtect] = useState(true);
  const [email, setEmail] = useState(to.email || "");
  const [phone, setPhone] = useState(to.phone || "");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  const lock = protect && fmt === "pdf";
  const ph = normalizePhone(phone, cc), phoneOk = ph !== null;
  const key = lock && ph ? lastFour(ph) : ""; // automatic password: last 4 digits of the recipient's number
  const pwOk = !lock || key.length === 4;

  useEffect(() => {
    setFile(null); setErr(""); setInfo(""); setBusy(false);
    if (!pwOk) return;
    let dead = false;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const blob = await build(fmt, key);
        if (!dead) setFile(new File([blob], `${safeName(base)}.${fmt}`, { type: MIME[fmt] }));
      } catch (e) { if (!dead) setErr(e.message || String(e)); }
      if (!dead) setBusy(false);
    }, 350);
    return () => { dead = true; clearTimeout(t); };
  }, [fmt, lock, key, pwOk, base]); // eslint-disable-line react-hooks/exhaustive-deps

  const em = email.trim(), emailOk = !em || EMAIL_RE.test(em);
  const ready = !!file && !busy && pwOk;
  const subject = `${business ? `${business} - ` : ""}${title} (Confidential)`;
  const lines = [`${business ? `${business}: ` : ""}${title}${detail ? ` (${detail})` : ""}`, "", NOTICE];
  if (lock) lines.push("", "This PDF is protected. To open it, enter the last 4 digits of the mobile number it was sent to (your WhatsApp number).");
  lines.push("", `File: ${file?.name || ""}`);
  const text = lines.join("\n");
  const native = canShareFile(file);

  const nativeShare = async () => {
    setErr(""); setInfo("");
    try { await navigator.share({ files: [file], title: subject, text }); }
    catch (e) { if (e?.name !== "AbortError") setErr(e.message || "Sharing failed. Use WhatsApp or Email instead."); }
  };
  const viaWhatsApp = () => {
    if (!ready || !phoneOk) return;
    setErr("");
    saveBlob(file, file.name);
    window.open(waUrl(ph, text), "_blank", "noopener");
    setInfo("The file was downloaded. Attach it in the WhatsApp chat that opened.");
  };
  const viaEmail = () => {
    if (!ready || !emailOk) return;
    setErr("");
    saveBlob(file, file.name);
    window.location.href = mailUrl(em, subject, text);
    setInfo("The file was downloaded. Attach it to the email that opened.");
  };
  return (
    <div className="modal d-block" style={{ background: "rgba(15,20,26,.55)", zIndex: 1600 }} onClick={onClose}>
      <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header py-2"><h6 className="modal-title"><i className="bi bi-shield-lock me-1" />Share securely: {title}</h6><button className="btn-close" onClick={onClose} aria-label="Close" /></div>
          <div className="modal-body">
            <div className="alert alert-warning py-2 small"><i className="bi bi-exclamation-triangle me-1" />{NOTICE}</div>

            {formats.length > 1 && (
              <div className="mb-3">
                <label className="form-label small mb-1">File format</label>
                <div className="btn-group d-flex" role="group">
                  {formats.map(([k, l]) => <button key={k} type="button" className={`btn btn-sm ${fmt === k ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setFmt(k)}>{l}</button>)}
                </div>
              </div>
            )}

            {fmt === "pdf" ? (
              <div className="mb-3">
                <div className="form-check form-switch mb-2">
                  <input className="form-check-input" type="checkbox" id="share-protect" checked={protect} onChange={(e) => setProtect(e.target.checked)} />
                  <label className="form-check-label small fw-semibold" htmlFor="share-protect">Password-protect the PDF</label>
                </div>
                {protect && (
                  <div className={`small ${pwOk ? "text-muted" : "text-danger"}`}>
                    <i className="bi bi-key me-1" />{pwOk ? <>Password is automatic: the last 4 digits of the number below (<b>{key}</b>). The recipient enters them to open the PDF, so send the file only to this number.</> : "Enter the recipient's WhatsApp / mobile number below. Its last 4 digits become the PDF password."}
                  </div>
                )}
              </div>
            ) : (
              <div className="alert alert-info py-2 small"><i className="bi bi-info-circle me-1" />Excel and CSV files cannot be password-protected here. Choose PDF for confidential sharing.</div>
            )}

            <div className="row g-2 mb-3">
              <div className="col-sm-6">
                <label className="form-label small mb-1">Recipient WhatsApp / mobile number</label>
                <div className="input-group input-group-sm"><span className="input-group-text"><i className="bi bi-whatsapp" /></span>
                  <input className={`form-control ${phoneOk ? "" : "is-invalid"}`} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={`0712 345 678 or +${cc}...`} autoComplete="off" /></div>
              </div>
              <div className="col-sm-6">
                <label className="form-label small mb-1">Email (optional)</label>
                <div className="input-group input-group-sm"><span className="input-group-text"><i className="bi bi-envelope" /></span>
                  <input className={`form-control ${emailOk ? "" : "is-invalid"}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="off" /></div>
              </div>
            </div>

            {err && <div className="alert alert-danger py-2 small">{err}</div>}
            {info && <div className="alert alert-success py-2 small">{info}</div>}
            <div className="small text-muted">
              {busy ? <><span className="spinner-border spinner-border-sm me-1" />Preparing file...</> : file ? <><i className="bi bi-file-earmark-check me-1" />{file.name} is ready ({Math.max(1, Math.round(file.size / 1024))} KB).</> : !pwOk ? "Enter the recipient's number to continue." : ""}
            </div>
          </div>
          <div className="modal-footer d-flex flex-wrap gap-2">
            {native && <button className="btn btn-dark" disabled={!ready} onClick={nativeShare} title="Attach the file directly in WhatsApp, Gmail, Signal, Telegram and other apps"><i className="bi bi-share me-1" />Share (attach file)</button>}
            <button className="btn btn-success" disabled={!ready || !phoneOk} onClick={viaWhatsApp}><i className="bi bi-whatsapp me-1" />WhatsApp</button>
            <button className="btn btn-primary" disabled={!ready || !emailOk} onClick={viaEmail}><i className="bi bi-envelope me-1" />Email</button>
            <button className="btn btn-light ms-auto" onClick={onClose}><i className="bi bi-x-lg me-1" />Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
