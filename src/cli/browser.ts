/**
 * msgcode: Browser CLI 命令（P5.7-R7A）
 *
 * 约束：
 * - 只走 Patchright + connectOverCDP
 * - 所有操作显式使用 instanceId/tabId
 * - 不内置站点业务流程
 */

import { Command } from "commander";
import type { Diagnostic } from "../memory/types.js";
import { createEnvelope } from "./command-runner.js";
import {
  BROWSER_ERROR_CODES,
  BrowserCommandError,
  executeBrowserOperation,
  type BrowserOperation,
} from "../runners/browser-patchright.js";
import {
  GMAIL_ERROR_CODES,
  GmailReadonlyError,
  runGmailReadonlyAcceptance,
} from "../browser/gmail-readonly.js";
import {
  CHROME_ROOT_ERROR_CODES,
  ChromeRootCommandError,
  ensureChromeRoot,
  getChromeRootInfo,
} from "../browser/chrome-root.js";

function createBrowserDiagnostic(
  code: string,
  message: string,
  details?: Record<string, unknown>
): Diagnostic {
  const diagnostic: Diagnostic = { code, message };
  if (details) {
    diagnostic.details = details;
  }
  return diagnostic;
}

function formatTextOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

async function runChromeRootCommand(
  command: string,
  options: {
    json?: boolean;
    ensure?: boolean;
    name?: string;
    port?: string;
    profileDirectory?: string;
  }
): Promise<void> {
  const startTime = Date.now();
  const warnings: Diagnostic[] = [];
  const errors: Diagnostic[] = [];

  try {
    const port = options.port !== undefined ? Number(options.port) : undefined;
    const data = options.ensure
      ? await ensureChromeRoot({
        name: options.name,
        port,
        profileDirectory: options.profileDirectory,
      })
      : getChromeRootInfo({
        name: options.name,
        port,
        profileDirectory: options.profileDirectory,
      });

    const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);
    if (options.json) {
      console.log(JSON.stringify(envelope, null, 2));
    } else {
      console.log(`workspaceRoot: ${data.workspaceRoot}`);
      console.log(`profilesRoot: ${data.profilesRoot}`);
      console.log(`chromeRoot: ${data.chromeRoot}`);
      console.log(`exists: ${data.exists ? "yes" : "no"}`);
      console.log(`remoteDebuggingPort: ${data.remoteDebuggingPort}`);
      if (data.profileDirectory) {
        console.log(`profileDirectory: ${data.profileDirectory}`);
      }
      console.log("");
      console.log("launchCommand:");
      console.log(data.launchCommand);
    }
    process.exit(0);
  } catch (error) {
    const rootError = error instanceof ChromeRootCommandError
      ? error
      : new ChromeRootCommandError(
        CHROME_ROOT_ERROR_CODES.ROOT_CREATE_FAILED,
        error instanceof Error ? error.message : String(error)
      );

    errors.push(createBrowserDiagnostic(rootError.code, rootError.message, rootError.details));
    const envelope = createEnvelope<Record<string, unknown>>(
      command,
      startTime,
      "error",
      {},
      warnings,
      errors
    );
    if (options.json) {
      console.log(JSON.stringify(envelope, null, 2));
    } else {
      console.error(`${rootError.code}: ${rootError.message}`);
    }
    process.exit(1);
  }
}

async function runBrowserCliCommand(
  command: string,
  options: { json?: boolean },
  operation: BrowserOperation,
  input: Record<string, unknown>,
  formatText: (data: Record<string, unknown>) => string
): Promise<void> {
  const startTime = Date.now();
  const warnings: Diagnostic[] = [];
  const errors: Diagnostic[] = [];

  try {
    const result = await executeBrowserOperation({
      operation,
      ...input,
    });

    const envelope = createEnvelope(command, startTime, "pass", result.data, warnings, errors);
    if (options.json) {
      console.log(JSON.stringify(envelope, null, 2));
    } else {
      console.log(formatText(result.data));
    }
    process.exit(0);
  } catch (error) {
    const browserError = error instanceof BrowserCommandError
      ? error
      : new BrowserCommandError(
        BROWSER_ERROR_CODES.HTTP_ERROR,
        error instanceof Error ? error.message : String(error)
      );

    errors.push(
      createBrowserDiagnostic(browserError.code, browserError.message, browserError.details)
    );

    const envelope = createEnvelope<Record<string, unknown>>(
      command,
      startTime,
      "error",
      {},
      warnings,
      errors
    );

    if (options.json) {
      console.log(JSON.stringify(envelope, null, 2));
    } else {
      console.error(`${browserError.code}: ${browserError.message}`);
    }
    process.exit(1);
  }
}

function createProfilesListCommand(): Command {
  const cmd = new Command("list");

  cmd
    .description("列出可用 browser profiles")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      await runBrowserCliCommand(
        "msgcode browser profiles list",
        options,
        "profiles.list",
        {},
        (data) => {
          const profiles = Array.isArray(data.profiles) ? data.profiles : [];
          if (profiles.length === 0) {
            return "[]";
          }
          return JSON.stringify(profiles, null, 2);
        }
      );
    });

  return cmd;
}

function createInstancesListCommand(): Command {
  const cmd = new Command("list");

  cmd
    .description("列出运行中的 browser instances")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      await runBrowserCliCommand(
        "msgcode browser instances list",
        options,
        "instances.list",
        {},
        (data) => JSON.stringify(data.instances ?? [], null, 2)
      );
    });

  return cmd;
}

function createInstancesLaunchCommand(): Command {
  const cmd = new Command("launch");

  cmd
    .description("启动 browser instance")
    .option("--mode <mode>", "运行模式：headed|headless", "headless")
    .option("--root-name <name>", "显式 Chrome rootName", "work-default")
    .option("--port <port>", "显式绑定端口")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      await runBrowserCliCommand(
        "msgcode browser instances launch",
        options,
        "instances.launch",
        {
          mode: options.mode,
          rootName: options.rootName,
          port: options.port,
        },
        (data) => JSON.stringify(data, null, 2)
      );
    });

  return cmd;
}

function createInstancesStopCommand(): Command {
  const cmd = new Command("stop");

  cmd
    .description("停止 browser instance")
    .requiredOption("--instance-id <id>", "显式 instanceId")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      await runBrowserCliCommand(
        "msgcode browser instances stop",
        options,
        "instances.stop",
        {
          instanceId: options.instanceId,
        },
        (data) => JSON.stringify(data, null, 2)
      );
    });

  return cmd;
}

function createTabsOpenCommand(): Command {
  const cmd = new Command("open");

  cmd
    .description("在指定 instance 中打开 tab")
    .option("--instance-id <id>", "显式 instanceId")
    .requiredOption("--url <url>", "目标 URL")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      await runBrowserCliCommand(
        "msgcode browser tabs open",
        options,
        "tabs.open",
        {
          instanceId: options.instanceId,
          url: options.url,
        },
        (data) => JSON.stringify(data, null, 2)
      );
    });

  return cmd;
}

function createTabsListCommand(): Command {
  const cmd = new Command("list");

  cmd
    .description("列出指定 instance 的 tabs")
    .requiredOption("--instance-id <id>", "显式 instanceId")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      await runBrowserCliCommand(
        "msgcode browser tabs list",
        options,
        "tabs.list",
        {
          instanceId: options.instanceId,
        },
        (data) => JSON.stringify(data.tabs ?? [], null, 2)
      );
    });

  return cmd;
}

function createSnapshotCommand(): Command {
  const cmd = new Command("snapshot");

  cmd
    .description("读取 tab snapshot")
    .requiredOption("--tab-id <id>", "显式 tabId")
    .option("--interactive", "只读取交互节点")
    .option("--compact", "紧凑格式")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      await runBrowserCliCommand(
        "msgcode browser snapshot",
        options,
        "tabs.snapshot",
        {
          tabId: options.tabId,
          interactive: !!options.interactive,
          compact: !!options.compact,
        },
        (data) => formatTextOutput(data.snapshot)
      );
    });

  return cmd;
}

function createTextCommand(): Command {
  const cmd = new Command("text");

  cmd
    .description("提取 tab 可读文本")
    .requiredOption("--tab-id <id>", "显式 tabId")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      await runBrowserCliCommand(
        "msgcode browser text",
        options,
        "tabs.text",
        {
          tabId: options.tabId,
        },
        (data) => formatTextOutput(data.text)
      );
    });

  return cmd;
}

function createActionCommand(): Command {
  const cmd = new Command("action");

  cmd
    .description("对 tab 执行动作原语")
    .requiredOption("--tab-id <id>", "显式 tabId")
    .requiredOption("--kind <kind>", "动作类型，如 click/type/press")
    .option("--ref <ref>", "显式节点 ref")
    .option("--text <text>", "输入文本")
    .option("--key <key>", "按键名")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      await runBrowserCliCommand(
        "msgcode browser action",
        options,
        "tabs.action",
        {
          tabId: options.tabId,
          kind: options.kind,
          ref: options.ref,
          text: options.text,
          key: options.key,
        },
        (data) => JSON.stringify(data, null, 2)
      );
    });

  return cmd;
}

function createEvalCommand(): Command {
  const cmd = new Command("eval");

  cmd
    .description("在指定 tab 执行 JS 表达式")
    .requiredOption("--tab-id <id>", "显式 tabId")
    .requiredOption("--expression <js>", "JavaScript 表达式")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      await runBrowserCliCommand(
        "msgcode browser eval",
        options,
        "tabs.eval",
        {
          tabId: options.tabId,
          expression: options.expression,
        },
        (data) => formatTextOutput(data.result)
      );
    });

  return cmd;
}

function createGmailReadonlyCommand(): Command {
  const cmd = new Command("gmail-readonly");

  cmd
    .description("Gmail 收件箱只读摘要验收")
    .option("--root-name <name>", "显式 Gmail Chrome rootName", "work-default")
    .option("--mode <mode>", "运行模式：headed|headless", "headless")
    .option("--timezone <tz>", "日期解释时区", "Asia/Singapore")
    .option("--keep-open", "执行后不自动停止实例")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = "msgcode browser gmail-readonly";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        const result = await runGmailReadonlyAcceptance({
          rootName: options.rootName,
          mode: options.mode,
          timezone: options.timezone,
          cleanup: !options.keepOpen,
        });

        const envelope = createEnvelope(command, startTime, "pass", result, warnings, errors);
        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(result.summary);
        }
        process.exit(0);
      } catch (error) {
        const gmailError = error instanceof GmailReadonlyError
          ? error
          : new GmailReadonlyError(
            GMAIL_ERROR_CODES.EXTRACTION_FAILED,
            error instanceof Error ? error.message : String(error)
          );

        errors.push(createBrowserDiagnostic(gmailError.code, gmailError.message, gmailError.details));
        const envelope = createEnvelope<Record<string, unknown>>(
          command,
          startTime,
          "error",
          {},
          warnings,
          errors
        );
        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error(`${gmailError.code}: ${gmailError.message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}

function createRootCommand(): Command {
  const cmd = new Command("root");

  cmd
    .description("显示/初始化共享工作 Chrome 数据根")
    .option("--name <name>", "工作 Chrome 根目录名", "work-default")
    .option("--port <port>", "remote debugging 端口", "9222")
    .option("--profile-directory <name>", "可选的 Chrome profile 名")
    .option("--ensure", "确保目录存在")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      await runChromeRootCommand("msgcode browser root", options);
    });

  return cmd;
}

export function createBrowserCommand(): Command {
  const cmd = new Command("browser");
  const profiles = new Command("profiles");
  const instances = new Command("instances");
  const tabs = new Command("tabs");

  cmd.description("Browser Core（Patchright + Chrome-as-State）");

  profiles.description("browser profile 操作");
  profiles.addCommand(createProfilesListCommand());

  instances.description("browser instance 操作");
  instances.addCommand(createInstancesListCommand());
  instances.addCommand(createInstancesLaunchCommand());
  instances.addCommand(createInstancesStopCommand());

  tabs.description("browser tab 操作");
  tabs.addCommand(createTabsOpenCommand());
  tabs.addCommand(createTabsListCommand());

  cmd.addCommand(profiles);
  cmd.addCommand(instances);
  cmd.addCommand(tabs);
  cmd.addCommand(createSnapshotCommand());
  cmd.addCommand(createTextCommand());
  cmd.addCommand(createActionCommand());
  cmd.addCommand(createEvalCommand());
  cmd.addCommand(createRootCommand());
  cmd.addCommand(createGmailReadonlyCommand());

  return cmd;
}

const COMMON_BROWSER_ERRORS = [
  BROWSER_ERROR_CODES.HTTP_ERROR,
  BROWSER_ERROR_CODES.RUNTIME_UNAVAILABLE,
  BROWSER_ERROR_CODES.TIMEOUT,
];

export function getBrowserCommandContracts() {
  return [
    {
      name: "msgcode browser root",
      description: "显示/初始化共享工作 Chrome 数据根",
      options: {
        required: {},
        optional: {
          "--name": "工作 Chrome 根目录名（默认 work-default）",
          "--port": "remote debugging 端口（默认 9222）",
          "--profile-directory": "可选的 Chrome profile 名",
          "--ensure": "确保目录存在",
          "--json": "JSON 格式输出",
        },
      },
      output: {
        workspaceRoot: "WORKSPACE_ROOT 绝对路径",
        profilesRoot: "Chrome 工作根目录集合路径",
        chromeRoot: "当前工作 Chrome 数据根路径",
        exists: "目录是否已存在",
        remoteDebuggingPort: "remote debugging 端口",
        launchCommand: "可直接复制的 Chrome 启动命令",
      },
      errorCodes: [
        CHROME_ROOT_ERROR_CODES.BAD_ARGS,
        CHROME_ROOT_ERROR_CODES.ROOT_CREATE_FAILED,
      ],
    },
    {
      name: "msgcode browser gmail-readonly",
      description: "Gmail 收件箱只读摘要验收",
      options: {
        required: {},
        optional: {
          "--root-name": "显式 Gmail Chrome rootName（默认 work-default）",
          "--mode": "运行模式：headed|headless",
          "--timezone": "日期解释时区",
          "--keep-open": "执行后不自动停止实例",
          "--json": "JSON 格式输出",
        },
      },
      output: {
        rootName: "显式 Chrome rootName",
        instanceId: "显式 instanceId",
        tabId: "显式 tabId",
        count: "今日邮件数量",
        messages: "今日邮件摘要列表",
        summary: "中文结构化摘要",
      },
      errorCodes: [
        GMAIL_ERROR_CODES.OK,
        GMAIL_ERROR_CODES.BAD_ARGS,
        GMAIL_ERROR_CODES.LOGIN_REQUIRED,
        GMAIL_ERROR_CODES.SITE_CHANGED,
        GMAIL_ERROR_CODES.EXTRACTION_FAILED,
        BROWSER_ERROR_CODES.TIMEOUT,
        ...COMMON_BROWSER_ERRORS,
      ],
    },
    {
      name: "msgcode browser profiles list",
      description: "列出可用 browser profiles",
      options: {
        required: {},
        optional: {
          "--json": "JSON 格式输出",
        },
      },
      output: {
        profiles: "Chrome root 数组",
      },
      errorCodes: [
        BROWSER_ERROR_CODES.OK,
        ...COMMON_BROWSER_ERRORS,
      ],
    },
    {
      name: "msgcode browser instances list",
      description: "列出运行中的 browser instances",
      options: {
        required: {},
        optional: {
          "--json": "JSON 格式输出",
        },
      },
      output: {
        instances: "instance 数组",
      },
      errorCodes: [
        BROWSER_ERROR_CODES.OK,
        ...COMMON_BROWSER_ERRORS,
      ],
    },
    {
      name: "msgcode browser instances launch",
      description: "启动 browser instance",
      options: {
        required: {},
        optional: {
          "--mode": "运行模式：headed|headless",
          "--root-name": "显式 Chrome rootName",
          "--port": "显式绑定端口",
          "--json": "JSON 格式输出",
        },
      },
      output: {
        id: "instanceId",
        rootName: "Chrome rootName",
        port: "实例端口",
        status: "实例状态",
      },
      errorCodes: [
        BROWSER_ERROR_CODES.OK,
        BROWSER_ERROR_CODES.BAD_ARGS,
        ...COMMON_BROWSER_ERRORS,
      ],
    },
    {
      name: "msgcode browser instances stop",
      description: "停止 browser instance",
      options: {
        required: {
          "--instance-id": "显式 instanceId",
        },
        optional: {
          "--json": "JSON 格式输出",
        },
      },
      output: {
        id: "instanceId",
        status: "停止结果状态",
      },
      errorCodes: [
        BROWSER_ERROR_CODES.OK,
        BROWSER_ERROR_CODES.BAD_ARGS,
        BROWSER_ERROR_CODES.INSTANCE_NOT_FOUND,
        ...COMMON_BROWSER_ERRORS,
      ],
    },
    {
      name: "msgcode browser tabs open",
      description: "在指定 instance 中打开 tab",
      options: {
        required: {
          "--url": "目标 URL",
        },
        optional: {
          "--instance-id": "显式 instanceId（可省略，系统会自动拉起默认实例）",
          "--json": "JSON 格式输出",
        },
      },
      output: {
        tabId: "显式 tabId",
        title: "页面标题",
        url: "当前 URL",
      },
      errorCodes: [
        BROWSER_ERROR_CODES.OK,
        BROWSER_ERROR_CODES.BAD_ARGS,
        BROWSER_ERROR_CODES.INSTANCE_NOT_FOUND,
        ...COMMON_BROWSER_ERRORS,
      ],
    },
    {
      name: "msgcode browser tabs list",
      description: "列出指定 instance 的 tabs",
      options: {
        required: {
          "--instance-id": "显式 instanceId",
        },
        optional: {
          "--json": "JSON 格式输出",
        },
      },
      output: {
        tabs: "tab 数组",
      },
      errorCodes: [
        BROWSER_ERROR_CODES.OK,
        BROWSER_ERROR_CODES.BAD_ARGS,
        BROWSER_ERROR_CODES.INSTANCE_NOT_FOUND,
        ...COMMON_BROWSER_ERRORS,
      ],
    },
    {
      name: "msgcode browser snapshot",
      description: "读取 tab snapshot",
      options: {
        required: {
          "--tab-id": "显式 tabId",
        },
        optional: {
          "--interactive": "只读取交互节点",
          "--compact": "紧凑格式",
          "--json": "JSON 格式输出",
        },
      },
      output: {
        tabId: "显式 tabId",
        snapshot: "snapshot 文本",
        interactive: "是否只看交互节点",
        compact: "是否紧凑格式",
      },
      errorCodes: [
        BROWSER_ERROR_CODES.OK,
        BROWSER_ERROR_CODES.BAD_ARGS,
        BROWSER_ERROR_CODES.TAB_NOT_FOUND,
        BROWSER_ERROR_CODES.REF_NOT_FOUND,
        ...COMMON_BROWSER_ERRORS,
      ],
    },
    {
      name: "msgcode browser text",
      description: "提取 tab 可读文本",
      options: {
        required: {
          "--tab-id": "显式 tabId",
        },
        optional: {
          "--json": "JSON 格式输出",
        },
      },
      output: {
        text: "可读正文",
        title: "页面标题",
        url: "当前 URL",
      },
      errorCodes: [
        BROWSER_ERROR_CODES.OK,
        BROWSER_ERROR_CODES.BAD_ARGS,
        BROWSER_ERROR_CODES.TAB_NOT_FOUND,
        ...COMMON_BROWSER_ERRORS,
      ],
    },
    {
      name: "msgcode browser action",
      description: "对 tab 执行动作原语",
      options: {
        required: {
          "--tab-id": "显式 tabId",
          "--kind": "动作类型",
        },
        optional: {
          "--ref": "显式节点 ref",
          "--text": "输入文本",
          "--key": "按键名",
          "--json": "JSON 格式输出",
        },
      },
      output: {
        success: "动作是否成功",
        result: "底层动作结果",
      },
      errorCodes: [
        BROWSER_ERROR_CODES.OK,
        BROWSER_ERROR_CODES.BAD_ARGS,
        BROWSER_ERROR_CODES.TAB_NOT_FOUND,
        ...COMMON_BROWSER_ERRORS,
      ],
    },
    {
      name: "msgcode browser eval",
      description: "在指定 tab 执行 JS 表达式",
      options: {
        required: {
          "--tab-id": "显式 tabId",
          "--expression": "JavaScript 表达式",
        },
        optional: {
          "--json": "JSON 格式输出",
        },
      },
      output: {
        result: "表达式返回值",
      },
      errorCodes: [
        BROWSER_ERROR_CODES.OK,
        BROWSER_ERROR_CODES.BAD_ARGS,
        BROWSER_ERROR_CODES.TAB_NOT_FOUND,
        ...COMMON_BROWSER_ERRORS,
      ],
    },
  ];
}
