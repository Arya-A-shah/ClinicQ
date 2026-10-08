// Small input cleaners. Never trust what the browser sends.

export function cleanName(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 60) return null;
  // letters (any language, so Hindi/Marathi names work), spaces, . ' -
  if (!/^[\p{L}\p{M} .'-]+$/u.test(s)) return null;
  return s;
}

// Indian mobile: 10 digits starting 6-9, optional +91 / 0 prefix.
export function cleanPhone(v) {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const digits = v.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}
