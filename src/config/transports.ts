export type RuntimeTransport = "feishu";

export function resolveDefaultTransports(env: NodeJS.ProcessEnv = process.env): RuntimeTransport[] {
  void env;
  return ["feishu"];
}

export function parseRuntimeTransports(env: NodeJS.ProcessEnv = process.env): RuntimeTransport[] {
  const raw = (env.MSGCODE_TRANSPORTS || "").trim();
  if (!raw) {
    return resolveDefaultTransports(env);
  }

  const items = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (items.length === 0) {
    return resolveDefaultTransports(env);
  }

  const unsupported = items.filter((it) => it !== "feishu");
  if (unsupported.length > 0) {
    if ((env.MSGCODE_ENV_BOOTSTRAPPED || "").trim() !== "1") {
      return resolveDefaultTransports(env);
    }
    throw new Error(
      `MSGCODE_TRANSPORTS 已退役为 Feishu-only；请删除该配置或仅保留 feishu（收到: ${unsupported.join(", ")}）`
    );
  }

  return ["feishu"];
}
