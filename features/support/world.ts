import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import type { IWorldOptions } from "@cucumber/cucumber";
import { setWorldConstructor } from "@cucumber/cucumber";

export class MsgcodeWorld {
  tmpRoot: string;
  tmpHome: string;
  workspaceRoot: string;
  routesFilePath: string;
  stateFilePath: string;
  lastResult: { success: boolean; message: string } | null = null;

  private originalEnv: Record<string, string | undefined>;

  constructor(_options: IWorldOptions) {
    this.originalEnv = {
      HOME: process.env.HOME,
      WORKSPACE_ROOT: process.env.WORKSPACE_ROOT,
      ROUTES_FILE_PATH: process.env.ROUTES_FILE_PATH,
      STATE_FILE_PATH: process.env.STATE_FILE_PATH,
    };

    this.tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-bdd-"));
    this.tmpHome = path.join(this.tmpRoot, "home");
    this.workspaceRoot = path.join(this.tmpRoot, "workspaces");
    this.routesFilePath = path.join(this.tmpRoot, "routes.json");
    this.stateFilePath = path.join(this.tmpRoot, "state.json");

    fs.mkdirSync(this.tmpHome, { recursive: true });
    fs.mkdirSync(this.workspaceRoot, { recursive: true });

    process.env.HOME = this.tmpHome;
    process.env.WORKSPACE_ROOT = this.workspaceRoot;
    process.env.ROUTES_FILE_PATH = this.routesFilePath;
    process.env.STATE_FILE_PATH = this.stateFilePath;
  }

  cleanup(): void {
    // restore env
    process.env.HOME = this.originalEnv.HOME;
    process.env.WORKSPACE_ROOT = this.originalEnv.WORKSPACE_ROOT;
    process.env.ROUTES_FILE_PATH = this.originalEnv.ROUTES_FILE_PATH;
    process.env.STATE_FILE_PATH = this.originalEnv.STATE_FILE_PATH;

    try {
      fs.rmSync(this.tmpRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }

  getWorkspacePath(relative: string): string {
    return path.join(this.workspaceRoot, relative);
  }
}

setWorldConstructor(MsgcodeWorld);
