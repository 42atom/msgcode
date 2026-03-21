import type { Diagnostic } from "../memory/types.js";

export function buildMissingWorkspaceError(workspacePath: string, input: string): Diagnostic {
  return {
    code: "APPLIANCE_WORKSPACE_MISSING",
    message: "工作区不存在",
    hint: "先初始化 workspace，或传绝对路径",
    details: { workspacePath, input },
  };
}

export function normalizeLineInput(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function normalizeMultilineInput(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
}
