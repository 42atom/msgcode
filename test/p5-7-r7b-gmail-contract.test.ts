/**
 * msgcode: P5.7-R7B Gmail 合同回归锁
 */

import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";

describe("P5.7-R7B: Gmail contract", () => {
  it("help-docs --json 应暴露 gmail-readonly 合同", () => {
    const output = execSync("NODE_OPTIONS='--import tsx' node src/cli.ts help-docs --json", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const envelope = JSON.parse(output);
    expect(envelope.status).toBe("pass");

    const command = envelope.data.commands.find(
      (item: { name: string }) => item.name === "msgcode browser gmail-readonly"
    );

    expect(command).toBeDefined();
    expect(command.errorCodes).toContain("GMAIL_LOGIN_REQUIRED");
    expect(command.errorCodes).toContain("BROWSER_SITE_CHANGED");
    expect(command.options.required).toHaveProperty("--profile-id");
  });

  it("browser --help 应显示 gmail-readonly 子命令", () => {
    const output = execSync("NODE_OPTIONS='--import tsx' node src/cli.ts browser --help", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    expect(output).toContain("gmail-readonly");
    expect(output).toContain("Gmail");
  });
});
