// Pure helpers for sharing reports and statements over WhatsApp, email and other apps.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MIME = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
};
export const NOTICE = "CONFIDENTIAL: intended only for the named recipient. Do not forward or share this document with anyone else.";

// Returns "" when empty, null when invalid, otherwise digits only with country code (e.g. 254712345678).
export function normalizePhone(raw, cc = "254") {
  const s = String(raw || "").trim();
  if (!s) return "";
  let d = s.replace(/\D/g, "");
  if (!d) return null;
  if (!s.startsWith("+")) {
    if (d.startsWith("00")) d = d.slice(2);
    else if (d.startsWith("0")) d = cc + d.slice(1);
    else if (d.length <= 9) d = cc + d;
  }
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export const waUrl = (phone, text) => `https://wa.me/${phone || ""}?text=${encodeURIComponent(text)}`;
export const mailUrl = (to, subject, body) => `mailto:${String(to || "").trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
export const safeName = (s) => String(s || "file").replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "file";

// The PDF password is the last 4 digits of the recipient's mobile number (the one used for WhatsApp).
export const lastFour = (phone) => String(phone || "").replace(/\D/g, "").slice(-4);

export function saveBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const canShareFile = (file) => {
  try { return !!(file && typeof navigator !== "undefined" && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch { return false; }
};
