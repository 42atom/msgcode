export type RuntimeTransport = "imsg" | "feishu";

export function hasFeishuCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.FEISHU_APP_ID || "").trim() && !!(env.FEISHU_APP_SECRET || "").trim();
}

export function resolveDefaultTransports(env: NodeJS.ProcessEnv = process.env): RuntimeTransport[] {
  return hasFeishuCredentials(env) ? ["feishu"] : ["imsg"];
}

export function parseRuntimeTransports(env: NodeJS.ProcessEnv = process.env): RuntimeTransport[] {
  const raw = (env.MSGCODE_TRANSPORTS || "").trim();
  if (raw) {
    const items = raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const out: RuntimeTransport[] = [];
    for (const it of items) {
      if ((it === "imsg" || it === "feishu") && !out.includes(it)) {
        out.push(it);
      }
    }
    return out.length > 0 ? out : resolveDefaultTransports(env);
  }

  return resolveDefaultTransports(env);
}
