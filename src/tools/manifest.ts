/**
 * msgcode: 工具说明书注册表（单一真相源）
 *
 * P5.7-R8c: 收口 LLM 工具暴露层
 *
 * 目标：
 * - 每个工具一条完整说明书（name/description/parameters）
 * - 执行核从该注册表派生 tools[]，消除 allow != expose 漂移
 *
 * 使用方式：
 * - TOOL_MANIFESTS: 所有工具说明书（Record<ToolName, ToolManifest>）
 * - resolveLlmToolExposure(): 解析允许/已注册/已暴露/缺失清单
 */

import type { ToolName } from "./types.js";

// ============================================
// 类型定义
// ============================================

/**
 * 工具说明书定义
 *
 * 对应 OpenAI Tool Format 的 type: "function" 结构
 */
export interface ToolManifest {
  /** 工具名称（对应 ToolName） */
  name: ToolName;
  /** 工具描述（给 LLM 的说明书） */
  description: string;
  /** 参数 schema（JSON Schema 格式） */
  parameters: {
    type: "object";
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
    }>;
    required: string[];
    additionalProperties?: boolean;
  };
  /** 风险等级（用于策略决策） */
  riskLevel: "low" | "medium" | "high";
}

/**
 * LLM 工具暴露结果（结构化诊断）
 *
 * 用于排查"为什么 AI 没拿到说明书"的第一现场证据
 */
export interface LlmToolExposureResult {
  /** workspace 允许的工具列表（来自 tooling.allow） */
  allowedTools: ToolName[];
  /** 已注册说明书的工具列表（来自 TOOL_MANIFESTS） */
  registeredTools: ToolName[];
  /** 真实暴露给 LLM 的工具列表（allowed ∩ registered） */
  exposedTools: ToolName[];
  /** 允许但未注册说明书的工具列表（配置问题 vs 注册问题） */
  missingManifests: ToolName[];
}

/**
 * 默认不再暴露给 LLM 的工具。
 * 保留执行实现，但退出默认模型主链：
 * - write_file/edit_file：避免默认文件写主链过宽
 * - vision：系统仅保留图片预览摘要；详细视觉任务改走 skill
 * - mem：当前无 P0 执行实现；长期记忆通过自动注入与 /mem slash 控制，不作为默认 LLM tool
 */
export const LLM_DEFAULT_SUPPRESSED_TOOLS: ToolName[] = ["write_file", "edit_file", "vision", "mem"];

export function filterDefaultLlmTools(toolNames: ToolName[]): ToolName[] {
  return toolNames.filter((tool) => !LLM_DEFAULT_SUPPRESSED_TOOLS.includes(tool));
}

// ============================================
// 工具说明书注册表
// ============================================

/**
 * 工具说明书注册表（单一真相源）
 *
 * 维护规则：
 * - 新增工具时必须在此注册完整说明书
 * - 字段必须与 Tool Bus 执行参数一致
 * - riskLevel 用于策略决策（medium/high 需确认）
 */
export const TOOL_MANIFESTS: Record<ToolName, ToolManifest> = {
  // ============================================
  // 浏览器工具（Patchright Browser Core）
  // ============================================
  browser: {
    name: "browser",
    description: "浏览器自动化工具（基于 Patchright + Chrome-as-State）。支持 Chrome root、实例控制、标签页操作等。",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "浏览器操作类型",
          enum: [
            "health",
            "profiles.list",
            "instances.list",
            "instances.launch",
            "instances.stop",
            "tabs.open",
            "tabs.list",
            "tabs.snapshot",
            "tabs.text",
            "tabs.action",
            "tabs.eval",
          ],
        },
        mode: {
          type: "string",
          description: "浏览器模式（仅 instances.launch 有效）",
          enum: ["headed", "headless"],
        },
        rootName: {
          type: "string",
          description: "共享工作 Chrome root 名（instances.launch 或 tabs.open 自动拉起时可选）",
        },
        instanceId: {
          type: "string",
          description: "浏览器实例 ID。instances.stop 与 tabs.list 必填；只能复用 instances.launch、instances.list、tabs.open 等真实返回值，禁止猜测或裸调。",
        },
        tabId: {
          type: "string",
          description: "标签页 ID（tabs.* 操作需要）",
        },
        url: {
          type: "string",
          description: "目标 URL（仅 tabs.open 需要；可直接用 tabs.open + url 打开网页）",
        },
        ref: {
          type: "string",
          description: "无状态 ref，固定为 JSON 字符串：{\"role\":\"button\",\"name\":\"Submit\",\"index\":0}",
        },
        text: {
          type: "string",
          description: "输入文本（仅 tabs.action/type 操作需要）",
        },
        expression: {
          type: "string",
          description: "JavaScript 表达式（仅 tabs.eval 需要）",
        },
        compact: {
          type: "boolean",
          description: "是否紧凑输出（仅 tabs.snapshot/tabs.text 有效）",
        },
        kind: {
          type: "string",
          description: "动作类型（仅 tabs.action 必填），如 click/type/press",
        },
        key: {
          type: "string",
          description: "按键名（仅 tabs.action + kind=press 需要），如 Enter/Tab/Escape",
        },
        interactive: {
          type: "boolean",
          description: "是否只返回可交互节点（仅 tabs.snapshot 有效，默认 false）",
        },
        port: {
          type: "string",
          description: "显式绑定端口（仅 instances.launch 有效，默认 9222）",
        },
      },
      required: ["operation"],
      additionalProperties: true,
    },
    riskLevel: "high",
  },

  // ============================================
  // 基础工具（PI 四工具 + bash）
  // ============================================
  bash: {
    name: "bash",
    description: "执行 shell 命令。用于文件操作、系统管理、进程控制等场景。",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "要执行的 shell 命令",
        },
      },
      required: ["command"],
      additionalProperties: true,
    },
    riskLevel: "high",
  },

  read_file: {
    name: "read_file",
    description: "读取文件内容。用于查看代码、配置、文档等。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "文件路径（相对或绝对）",
        },
      },
      required: ["path"],
      additionalProperties: true,
    },
    riskLevel: "low",
  },

  write_file: {
    name: "write_file",
    description: "写入文件内容。会覆盖整个文件。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "文件路径",
        },
        content: {
          type: "string",
          description: "文件内容",
        },
      },
      required: ["path", "content"],
      additionalProperties: true,
    },
    riskLevel: "medium",
  },

  edit_file: {
    name: "edit_file",
    description: "编辑文件内容（基于查找替换）。用于小规模修改。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "文件路径",
        },
        edits: {
          type: "array",
          description: "补丁数组。每项包含 oldText/newText。适合多处替换。",
        },
        oldText: {
          type: "string",
          description: "单次替换的旧文本。若只改一处，可与 newText 一起作为简写传入。",
        },
        newText: {
          type: "string",
          description: "单次替换的新文本。若只改一处，可与 oldText 一起作为简写传入。",
        },
      },
      required: ["path"],
      additionalProperties: true,
    },
    riskLevel: "medium",
  },

  // ============================================
  // 飞书工具
  // ============================================
  feishu_list_members: {
    name: "feishu_list_members",
    description: "获取飞书群成员列表。返回成员 ID 和姓名，适合 character-identity 建表或在群聊里精确 @ 某人。",
    parameters: {
      type: "object",
      properties: {
        chatId: {
          type: "string",
          description: "飞书群聊 ID（例如：oc_xxxxxxxxxxxxxxxx）。可省略，默认读取当前 workspace 的 runtime.current_chat_id。",
        },
        memberIdType: {
          type: "string",
          description: "成员 ID 类型。默认 open_id；可选 user_id 或 union_id。",
          enum: ["open_id", "user_id", "union_id"],
        },
      },
      required: [],
      additionalProperties: false,
    },
    riskLevel: "low",
  },

  feishu_send_file: {
    name: "feishu_send_file",
    description: "发送文件到飞书群聊。支持上传本地文件并发送到指定飞书群。",
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "本地文件路径（绝对路径或相对于工作目录的路径）",
        },
        chatId: {
          type: "string",
          description: "飞书群聊 ID（例如：oc_xxxxxxxxxxxxxxxx）。可省略，默认读取当前 workspace 的 runtime.current_chat_id。",
        },
        message: {
          type: "string",
          description: "可选的附加文本消息，会与文件一起发送",
        },
      },
      required: ["filePath"],
      additionalProperties: false,
    },
    riskLevel: "medium",  // message-send 需要确认
  },

  // ============================================
  // 媒体工具
  // ============================================
  tts: {
    name: "tts",
    description: "文本转语音。将文本转换为语音消息。",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "要转换的文本",
        },
      },
      required: ["text"],
      additionalProperties: true,
    },
    riskLevel: "low",
  },

  asr: {
    name: "asr",
    description: "语音转文本。将语音消息转换为文本。",
    parameters: {
      type: "object",
      properties: {
        audioPath: {
          type: "string",
          description: "音频文件路径",
        },
      },
      required: ["audioPath"],
      additionalProperties: true,
    },
    riskLevel: "low",
  },

  vision: {
    name: "vision",
    description:
      "图像理解。读取 imagePath 指向的图片；若用户有明确任务（如提取文字、表格、代码、界面文案或细节），应把要求写入 userQuery，不要只传图片路径。",
    parameters: {
      type: "object",
      properties: {
        imagePath: {
          type: "string",
          description: "图片文件路径",
        },
        userQuery: {
          type: "string",
          description:
            "用户要这次图片分析完成的具体任务。若需提取文字、表格、代码、界面文案或某块细节，必须把要求写在这里。",
        },
      },
      required: ["imagePath"],
      additionalProperties: true,
    },
    riskLevel: "low",
  },

  // ============================================
  // 其他工具
  // ============================================
  mem: {
    name: "mem",
    description: "记忆操作。读写长期记忆存储。",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "操作类型",
          enum: ["read", "write", "search"],
        },
        key: {
          type: "string",
          description: "记忆键",
        },
        value: {
          type: "string",
          description: "记忆值（write 操作必需）",
        },
      },
      required: ["operation"],
      additionalProperties: true,
    },
    riskLevel: "low",
  },

  desktop: {
    name: "desktop",
    description: "桌面桥接工具。通过 Desktop Bridge 与 macOS 桌面交互。",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "操作类型",
          enum: ["observe", "click", "type"],
        },
      },
      required: ["operation"],
      additionalProperties: true,
    },
    riskLevel: "medium",
  },
};

// ============================================
// 暴露解析器
// ============================================

/**
 * 解析 LLM 工具暴露结果
 *
 * 输入：workspace tooling.allow
 * 输出：结构化诊断信息（allowed/registered/exposed/missing）
 *
 * @param allowedTools - workspace 允许的工具列表（tooling.allow）
 * @returns LLM 工具暴露结果
 */
export function resolveLlmToolExposure(allowedTools: ToolName[]): LlmToolExposureResult {
  // 已注册说明书的工具列表
  const registeredTools = Object.keys(TOOL_MANIFESTS) as ToolName[];

  // 真实暴露给 LLM 的工具列表（默认抑制项会在这里退出主链）
  const exposedTools = filterDefaultLlmTools(allowedTools).filter((tool) => tool in TOOL_MANIFESTS);

  // 允许但未注册说明书的工具列表
  const missingManifests = allowedTools.filter((tool) => !(tool in TOOL_MANIFESTS));

  return {
    allowedTools,
    registeredTools,
    exposedTools,
    missingManifests,
  };
}

/**
 * 将工具说明书转换为 OpenAI Tool Format
 *
 * @param toolName - 工具名称
 * @returns OpenAI tool schema（未注册时返回 null）
 */
export function toOpenAiToolSchema(toolName: ToolName): unknown | null {
  const manifest = TOOL_MANIFESTS[toolName];
  if (!manifest) return null;

  return {
    type: "function",
    function: {
      name: manifest.name,
      description: manifest.description,
      parameters: manifest.parameters,
    },
  };
}

/**
 * 批量转换工具说明书为 OpenAI Tool Format
 *
 * @param toolNames - 工具名称列表
 * @returns OpenAI tool schemas 数组
 */
export function toOpenAiToolSchemas(toolNames: ToolName[]): unknown[] {
  const schemas: unknown[] = [];
  for (const name of toolNames) {
    const schema = toOpenAiToolSchema(name);
    if (schema) schemas.push(schema);
  }
  return schemas;
}

/**
 * 将工具说明书转换为 Anthropic Tool Format
 *
 * @param toolName - 工具名称
 * @returns Anthropic tool schema（未注册时返回 null）
 */
export function toAnthropicToolSchema(toolName: ToolName): unknown | null {
  const manifest = TOOL_MANIFESTS[toolName];
  if (!manifest) return null;

  return {
    name: manifest.name,
    description: manifest.description,
    input_schema: manifest.parameters,
  };
}

/**
 * 批量转换工具说明书为 Anthropic Tool Format
 *
 * @param toolNames - 工具名称列表
 * @returns Anthropic tool schemas 数组
 */
export function toAnthropicToolSchemas(toolNames: ToolName[]): unknown[] {
  const schemas: unknown[] = [];
  for (const name of toolNames) {
    const schema = toAnthropicToolSchema(name);
    if (schema) schemas.push(schema);
  }
  return schemas;
}

/**
 * 渲染给模型看的工具索引
 *
 * 目标：
 * - 明确列出当前真实暴露的工具名
 * - 阻止模型把 skill 名误当成 tool 名
 */
export function renderLlmToolIndex(toolNames: ToolName[]): string {
  const lines: string[] = [
    "[当前可用工具索引]",
    "你本轮真正可调用的工具只有以下名称；如果要发出 tool_calls/tool_use，工具名只能从下列列表中选择。",
  ];

  if (toolNames.length === 0) {
    lines.push("- 无可用工具");
    lines.push("当前没有任何工具暴露给你。禁止虚构工具名，禁止输出伪 tool_call 文本。");
    return lines.join("\n");
  }

  for (const toolName of toolNames) {
    const manifest = TOOL_MANIFESTS[toolName];
    if (!manifest) continue;
    lines.push(`- ${manifest.name}: ${manifest.description}`);
  }

  lines.push("重要边界：skill 名不是工具名。禁止把 file、memory、thread、todo、cron、media、gen、banana-pro-image-gen 当作工具名。");
  lines.push("常见映射：读文件用 read_file，写改文件优先用 bash，浏览器操作用 browser。");
  lines.push("如果上面列表里没有某个工具名，就表示你本轮不能调用它。");
  lines.push("只有拿到本轮真实工具回执后，才能声称某个工具成功、失败、崩溃、超时、报错或已完成发送。");
  lines.push("如果本轮没有调用相关工具，就明确说“这轮还没实际核实”，不要编造旧错误、旧附件结果或旧视觉结论。");

  return lines.join("\n");
}
