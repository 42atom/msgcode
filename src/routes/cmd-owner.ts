/**
 * msgcode: 管理域命令（owner）
 */

import { join } from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";

function getUserEnvPath(): string {
  return join(os.homedir(), ".config", "msgcode", ".env");
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function upsertEnvLine(lines: string[], key: string, value: string): string[] {
  const prefix = `${key}=`;
  let replaced = false;
  const next = lines.map(line => {
    if (line.startsWith(prefix) && !replaced) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) next.push(`${key}=${value}`);
  return next;
}

function readEnvLines(filePath: string): string[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    return raw.split(/\r?\n/);
  } catch {
    return [];
  }
}

function writeEnvLines(filePath: string, lines: string[]): void {
  const dir = join(os.homedir(), ".config", "msgcode");
  fs.mkdirSync(dir, { recursive: true });
  const content = lines.join("\n").replace(/\n+$/, "\n");
  const tmp = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

function readEnvValue(lines: string[], key: string): string | null {
  const prefix = `${key}=`;
  for (const line of lines) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return null;
}

function upsertCsvEnvValue(
  lines: string[],
  key: string,
  rawItem: string,
  kind: "email" | "phone"
): string[] {
  const current = readEnvValue(lines, key) ?? "";
  const items = splitCsv(current);

  const exists = items.some(existing => {
    if (kind === "email") {
      return existing.toLowerCase() === rawItem.toLowerCase();
    }
    const a = normalizePhone(existing);
    const b = normalizePhone(rawItem);
    if (!a || !b) return false;
    return a.includes(b) || b.includes(a);
  });

  if (exists) return lines;

  const nextValue = items.length === 0 ? rawItem : `${items.join(",")},${rawItem}`;
  return upsertEnvLine(lines, key, nextValue);
}

function validateOwnerIdentifier(value: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, reason: "owner 不能为空" };
  if (trimmed.includes("@")) return { ok: true };
  if (normalizePhone(trimmed).length >= 6) return { ok: true };
  return { ok: false, reason: "owner 格式不合法：请输入邮箱或电话号码（handle）" };
}

export async function handleOwnerCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { args } = options;
  const envPath = getUserEnvPath();

  if (args.length === 0) {
    const owner = process.env.MSGCODE_OWNER || "";
    const enabled = process.env.MSGCODE_OWNER_ONLY_IN_GROUP || "0";
    return {
      success: true,
      message: `owner 配置\n` +
        `\n` +
        `MSGCODE_OWNER_ONLY_IN_GROUP=${enabled}\n` +
        `MSGCODE_OWNER=${owner || "<未设置>"}\n` +
        `\n` +
        `配置文件: ${envPath}\n` +
        `\n` +
        `用法:\n` +
        `  /owner <你的邮箱或电话>\n` +
        `  /owner-only on|off|status\n` +
        `\n` +
        `修改后需要重启 msgcode 才会生效`,
    };
  }

  const requestedOwner = args[0] ?? "";
  const check = validateOwnerIdentifier(requestedOwner);
  if (!check.ok) {
    return { success: false, message: `设置失败: ${check.reason}` };
  }

  const owner = requestedOwner.trim();
  let lines = readEnvLines(envPath);
  lines = upsertEnvLine(lines, "MSGCODE_OWNER", owner);

  if (owner.includes("@")) {
    lines = upsertCsvEnvValue(lines, "MY_EMAIL", owner, "email");
  } else {
    lines = upsertCsvEnvValue(lines, "MY_PHONE", owner, "phone");
  }

  try {
    writeEnvLines(envPath, lines);
    return {
      success: true,
      message: `已写入 owner 配置\n` +
        `\n` +
        `MSGCODE_OWNER=${owner}\n` +
        `\n` +
        `下一步:\n` +
        `1) 重启 msgcode\n` +
        `2) 群里执行 /owner-only on（可选）\n` +
        `3) 再执行 /clear 清理会话`,
    };
  } catch (error) {
    return {
      success: false,
      message: `写入失败: ${error instanceof Error ? error.message : String(error)}\n` +
        `\n` +
        `请手动编辑: ${envPath}`,
    };
  }
}

export async function handleOwnerOnlyCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { args } = options;
  const envPath = getUserEnvPath();

  const raw = (args[0] ?? "status").trim().toLowerCase();
  const currentEnabled = process.env.MSGCODE_OWNER_ONLY_IN_GROUP || "0";
  const currentOwner = process.env.MSGCODE_OWNER || "";

  if (raw === "status") {
    return {
      success: true,
      message: `owner-only 状态\n` +
        `\n` +
        `MSGCODE_OWNER_ONLY_IN_GROUP=${currentEnabled}\n` +
        `MSGCODE_OWNER=${currentOwner || "<未设置>"}\n` +
        `\n` +
        `配置文件: ${envPath}`,
    };
  }

  const enable =
    raw === "on" || raw === "1" || raw === "true" || raw === "yes" || raw === "enable";
  const disable =
    raw === "off" || raw === "0" || raw === "false" || raw === "no" || raw === "disable";

  if (!enable && !disable) {
    return {
      success: false,
      message: `用法错误\n` +
        `\n` +
        `  /owner-only on\n` +
        `  /owner-only off\n` +
        `  /owner-only status`,
    };
  }

  if (enable && !currentOwner) {
    const fromFile = readEnvValue(readEnvLines(envPath), "MSGCODE_OWNER") ?? "";
    if (!fromFile) {
      return {
        success: false,
        message: `启用失败：未设置 MSGCODE_OWNER\n` +
          `\n` +
          `请先执行:\n` +
          `  /owner <你的邮箱或电话>`,
      };
    }
  }

  let lines = readEnvLines(envPath);
  lines = upsertEnvLine(lines, "MSGCODE_OWNER_ONLY_IN_GROUP", enable ? "1" : "0");

  try {
    writeEnvLines(envPath, lines);
    return {
      success: true,
      message: `已写入 owner-only 配置\n` +
        `\n` +
        `MSGCODE_OWNER_ONLY_IN_GROUP=${enable ? "1" : "0"}\n` +
        `\n` +
        `修改后需要重启 msgcode 才会生效`,
    };
  } catch (error) {
    return {
      success: false,
      message: `写入失败: ${error instanceof Error ? error.message : String(error)}\n` +
        `\n` +
        `请手动编辑: ${envPath}`,
    };
  }
}
