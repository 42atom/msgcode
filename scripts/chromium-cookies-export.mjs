#!/usr/bin/env node
/**
 * Thin CLI: export Chromium-family cookies by reading the profile Cookies SQLite
 * and decrypting encrypted_value via macOS Keychain "Safe Storage" password.
 *
 * Philosophy:
 * - Do one thing well: cookies DB -> (optionally decrypt) -> Playwright cookies JSON.
 * - No Tool Bus integration here. Use from bash, or reference from skills.
 * - Fail-closed by default: no values printed unless explicitly requested.
 *
 * Limitations:
 * - macOS only (Keychain-based decryption).
 * - Supports v10/v11 AES-128-CBC ("saltysalt") encrypted cookies.
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function die(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = (i + 1 < argv.length && !argv[i + 1].startsWith("--")) ? argv[++i] : "true";
    args[k] = v;
  }
  return args;
}

function chromeRootForBrowser(browser) {
  const home = os.homedir();
  switch (browser) {
    case "chrome":
      return path.join(home, "Library", "Application Support", "Google", "Chrome");
    case "chromium":
      return path.join(home, "Library", "Application Support", "Chromium");
    case "brave":
      return path.join(home, "Library", "Application Support", "BraveSoftware", "Brave-Browser");
    case "edge":
      return path.join(home, "Library", "Application Support", "Microsoft Edge");
    case "arc":
      return path.join(home, "Library", "Application Support", "Arc");
    default:
      die(`unknown --browser '${browser}' (expected chrome|edge|brave|arc|chromium)`);
  }
}

function keychainServiceForBrowser(browser) {
  switch (browser) {
    case "arc":
      return "Arc Safe Storage";
    case "brave":
      return "Brave Safe Storage";
    case "edge":
      return "Microsoft Edge Safe Storage";
    case "chromium":
      return "Chromium Safe Storage";
    case "chrome":
    default:
      return "Chrome Safe Storage";
  }
}

function listProfiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  return fs
    .readdirSync(rootDir)
    .filter((name) => name === "Default" || name.startsWith("Profile "))
    .sort();
}

function readLocalStateProfileNames(rootDir) {
  // Local State contains profile.info_cache mapping directory -> display name.
  // This is useful when AI needs multiple roles/profiles, but we avoid printing emails here.
  try {
    const p = path.join(rootDir, "Local State");
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, "utf8");
    const json = JSON.parse(raw);
    const cache = json?.profile?.info_cache;
    if (!cache || typeof cache !== "object") return {};
    const out = {};
    for (const [dir, info] of Object.entries(cache)) {
      const name = info && typeof info === "object" ? info.name : undefined;
      if (typeof dir === "string" && typeof name === "string" && name.trim()) {
        out[dir] = name.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

function readKeychainPassword(service) {
  try {
    const out = execFileSync("security", ["find-generic-password", "-w", "-s", service], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
    });
    const pw = out.trim();
    return pw ? pw : null;
  } catch {
    return null;
  }
}

function decryptChromiumCookieValue(encryptedBuf, password) {
  // Chromium on macOS uses "v10" prefix and AES-128-CBC with key derived from Keychain.
  if (!Buffer.isBuffer(encryptedBuf) || encryptedBuf.length < 4) return null;
  const prefix = encryptedBuf.subarray(0, 3).toString("utf8");
  if (prefix !== "v10" && prefix !== "v11") {
    return null;
  }
  const key = crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const iv = Buffer.alloc(16, 0x20); // 16 spaces
  const data = encryptedBuf.subarray(3);
  try {
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    const text = decrypted.toString("utf8").trim();
    return text || null;
  } catch {
    return null;
  }
}

function chromeExpiresUtcToUnixSeconds(expiresUtc) {
  // expires_utc: microseconds since 1601-01-01
  const n = Number(expiresUtc);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const unixSeconds = (n / 1_000_000) - 11_644_473_600;
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return undefined;
  return Math.floor(unixSeconds);
}

function sameSiteFromChromiumEnum(v) {
  const n = Number(v);
  // Observed values: 0=unspecified, 1=Lax, 2=Strict, 3=None
  if (n === 1) return "Lax";
  if (n === 2) return "Strict";
  if (n === 3) return "None";
  return undefined;
}

function copyToTemp(srcPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-cookies-"));
  const dst = path.join(tmpDir, "Cookies");
  fs.copyFileSync(srcPath, dst);
  return { tmpDir, dst };
}

function runSqliteJson(dbPath, sql) {
  // Use sqlite3 CLI to avoid native bindings.
  // -json outputs an array of objects.
  try {
    const out = execFileSync("sqlite3", ["-readonly", "-json", dbPath, sql], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const trimmed = out.trim();
    return trimmed ? JSON.parse(trimmed) : [];
  } catch (e) {
    const msg = e && typeof e === "object" && "stderr" in e
      ? String(e.stderr || "")
      : (e instanceof Error ? e.message : String(e));
    throw new Error(`sqlite3 query failed: ${msg}`.trim());
  }
}

function buildDomainWhere(domain) {
  const d = String(domain || "").trim().toLowerCase();
  if (!d) die("--domain is required");
  // SQLite escaping: avoid single quotes breaking the query.
  if (d.includes("'")) die("--domain must not contain single quote");
  // host_key is either exact, or prefixed with dot, or subdomain endings.
  return `(host_key = '${d}' OR host_key = '.${d}' OR host_key LIKE '%.' || '${d}')`;
}

function exportCookiesFromProfile(params) {
  const whereDomain = buildDomainWhere(params.domain);
  const whereName = params.name ? `AND name = '${String(params.name).replace(/'/g, "")}'` : "";
  const sql = `
    SELECT
      host_key AS hostKey,
      name,
      value,
      hex(encrypted_value) AS encryptedHex,
      path,
      expires_utc AS expiresUtc,
      is_secure AS isSecure,
      is_httponly AS isHttpOnly,
      samesite AS sameSite
    FROM cookies
    WHERE ${whereDomain}
      ${whereName}
    ORDER BY host_key, name
    LIMIT ${params.limit};
  `;
  const rows = runSqliteJson(params.cookieDbCopyPath, sql);
  const pw = params.keychainPassword;
  const result = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const name = typeof row.name === "string" ? row.name : "";
    const hostKey = typeof row.hostKey === "string" ? row.hostKey : "";
    const cookieDomain = hostKey || "";
    const cookiePath = typeof row.path === "string" ? row.path : "/";
    const secure = Boolean(row.isSecure);
    const httpOnly = Boolean(row.isHttpOnly);
    const sameSite = sameSiteFromChromiumEnum(row.sameSite);
    const expires = chromeExpiresUtcToUnixSeconds(row.expiresUtc);

    let value = (typeof row.value === "string" ? row.value : "") || "";
    if (!value) {
      const hex = typeof row.encryptedHex === "string" ? row.encryptedHex : "";
      if (hex) {
        const buf = Buffer.from(hex.replace(/[^0-9A-Fa-f]/g, ""), "hex");
        const decrypted = pw ? decryptChromiumCookieValue(buf, pw) : null;
        if (decrypted) value = decrypted;
      }
    }

    // Playwright cookie format. We omit url to avoid accidental mismatches.
    result.push({
      name,
      value,
      domain: cookieDomain,
      path: cookiePath,
      expires,
      httpOnly,
      secure,
      sameSite,
    });
  }
  return result;
}

function summarize(cookies) {
  const names = new Set();
  for (const c of cookies) {
    if (c && typeof c.name === "string" && c.name) names.add(c.name);
  }
  return {
    cookieCount: cookies.length,
    uniqueNames: names.size,
    sampleNames: Array.from(names).slice(0, 20),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browser = String(args.browser || "chrome").toLowerCase();
  const rootDir = chromeRootForBrowser(browser);
  const profiles = listProfiles(rootDir);
  if (profiles.length === 0) {
    die(`no profiles found under: ${rootDir}`);
  }
  const profileNames = readLocalStateProfileNames(rootDir);

  const domain = args.domain ? String(args.domain) : "";
  const profile = args.profile ? String(args.profile) : "";
  const outPath = args.out ? String(args.out) : "";
  const outDir = args["out-dir"] ? String(args["out-dir"]) : "";
  const redact = String(args.redact || "false") === "true";
  const listOnly = String(args.list || "false") === "true";
  const limit = Math.max(1, Math.min(50_000, Number(args.limit || 20_000)));
  const cookieName = args.name ? String(args.name) : "";

  if (listOnly) {
    process.stdout.write(JSON.stringify({
      ok: true,
      browser,
      rootDir,
      profiles: profiles.map((p) => ({ dir: p, name: profileNames[p] || "" })),
    }, null, 2) + "\n");
    return;
  }

  if (!domain.trim()) {
    die("--domain is required (e.g. --domain google.com)");
  }

  const service = keychainServiceForBrowser(browser);
  const keychainPassword = readKeychainPassword(service);
  if (!keychainPassword) {
    die(`Keychain password missing/unreadable for service '${service}'. Try unlocking Keychain / approving the prompt, then retry.`);
  }

  const targetProfiles = profile ? [profile] : profiles;
  const perProfile = [];

  for (const prof of targetProfiles) {
    const cookieDb = path.join(rootDir, prof, "Cookies");
    if (!fs.existsSync(cookieDb)) continue;
    const { tmpDir, dst } = copyToTemp(cookieDb);
    try {
      const cookies = exportCookiesFromProfile({
        domain,
        name: cookieName || undefined,
        limit,
        cookieDbCopyPath: dst,
        keychainPassword,
      });
      const sum = summarize(cookies);
      perProfile.push({
        profile: prof,
        profileName: profileNames[prof] || "",
        cookieDb,
        ...sum,
        // Safety: never print cookie values in summary.
        // Values are only written when --out is set.
      });

      if (outPath && outDir) {
        die("use either --out or --out-dir (not both)");
      }

      if (outPath) {
        if (!profile) {
          die("--out requires --profile. For multiple profiles, use --out-dir <dir>.");
        }
        const payload = redact ? cookies.map((c) => ({ ...c, value: c.value ? "(redacted)" : "" })) : cookies;
        fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
      } else if (outDir) {
        fs.mkdirSync(outDir, { recursive: true });
        const safeProf = prof.replace(/[^A-Za-z0-9._ -]/g, "_");
        const safeDomain = domain.trim().toLowerCase().replace(/[^A-Za-z0-9._-]/g, "_");
        const fileName = `${browser}-${safeProf}-${safeDomain}.cookies.json`;
        const dstPath = path.join(outDir, fileName);
        const payload = redact ? cookies.map((c) => ({ ...c, value: c.value ? "(redacted)" : "" })) : cookies;
        fs.writeFileSync(dstPath, JSON.stringify(payload, null, 2), "utf8");
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    browser,
    rootDir,
    domain,
    profile: profile || "(auto-scan)",
    outPath: outPath || "",
    outDir: outDir || "",
    note: (outPath || outDir)
      ? (redact ? "cookies were written to file(s) with values redacted" : "cookies were written to file(s); values were NOT printed to stdout")
      : "summary only (no values printed)",
    results: perProfile,
  }, null, 2) + "\n");
}

main().catch((e) => {
  die(e instanceof Error ? e.message : String(e));
});
