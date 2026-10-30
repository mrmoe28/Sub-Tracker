// Pure parser for Chrome / Google Password Manager CSV exports
// (columns: name,url,username,password,note). No I/O so it's unit-testable.

export interface ImportedPassword {
  domain: string;
  url: string;
  username: string;
  password: string;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function hostOf(url: string): string | null {
  try {
    const withScheme = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function parsePasswordCsv(
  text: string,
  registrable: (host: string) => string,
): ImportedPassword[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h));
  const urlIdx = idx(["url", "login_uri", "website", "web site"]);
  const userIdx = idx(["username", "login_username", "login", "user name"]);
  const passIdx = idx(["password", "login_password"]);
  if (urlIdx < 0 || userIdx < 0 || passIdx < 0) return [];

  const out = new Map<string, ImportedPassword>();
  for (const r of rows.slice(1)) {
    const url = (r[urlIdx] ?? "").trim();
    const username = (r[userIdx] ?? "").trim();
    const password = r[passIdx] ?? "";
    if (!url || !username || !password) continue;
    const host = hostOf(url);
    if (!host || /^android:\/\//i.test(url)) continue;
    const domain = registrable(host);
    // First entry per domain wins; Chrome exports the most-used first.
    if (!out.has(domain)) out.set(domain, { domain, url, username, password });
  }
  return [...out.values()];
}
