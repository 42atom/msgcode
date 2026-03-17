/**
 * msgcode: Heartbeat Tick Integration - 最小可跑主链
 *
 * 职责：
 * - 驱动 "读任务 -> 选 persona -> 发 dispatch -> 子代理执行 -> 主脑回收" 完整流程
 * - 只做最小冒烟，不做完整 orchestration
 *
 * 核心流程：
 * 1. 先读 HEARTBEAT.md（草稿）
 * 2. 再读 issues/ 找 runnable tasks
 * 3. 再读 dispatch/ 找 pending/running
 * 4. 再读 subagent/ 找执行状态
 * 5. 能推进就推进，不能就 HEARTBEAT_OK
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { HeartbeatRunner, type TickContext } from "./heartbeat.js";
import { loadTaskDocuments, loadDispatchRecords, loadSubagentRecords, type TaskDocumentRecord, type DispatchRecord } from "./work-continuity.js";
import {
  runSubagentTask,
  getSubagentTaskStatus,
  type SubagentTaskRecord,
  type SubagentStatusResult,
} from "./subagent.js";
import { logger } from "../logger/index.js";

/**
 * Heartbeat Tick 配置
 */
export interface HeartbeatTickConfig {
  /** 工作空间路径 */
  workspacePath: string;
  /** issues 目录 */
  issuesDir?: string;
  /** 最大一次派单数 */
  maxDispatchPerTick?: number;
  /** 子代理超时 ms */
  subagentTimeoutMs?: number;
  /** 模拟子代理执行（用于测试） */
  mockSubagentFn?: (dispatch: DispatchRecord) => Promise<{ success: boolean; error?: string }>;
  /** 模拟子代理状态查询（用于测试后续 tick 监督） */
  mockSubagentStatusFn?: (dispatch: DispatchRecord) => Promise<SubagentStatusResult>;
  /** 在执行 subagent 前回调（用于测试验证参数） */
  beforeDispatch?: (params: {
    client: string;
    goal: string;
    persona?: string;
    taskCard?: any;
    workspace: string;
    watch: boolean;
    timeoutMs?: number;
  }) => void;
}

/**
 * Tick 执行结果
 */
export interface HeartbeatTickResult {
  /** 是否有动作 */
  hadAction: boolean;
  /** 动作摘要 */
  summary: string[];
  /** 错误 */
  errors: string[];
}

/**
 * 扫描任务文档，找可推进的子任务
 */
async function scanRunnableTasks(issuesDir: string): Promise<TaskDocumentRecord[]> {
  if (!existsSync(issuesDir)) {
    return [];
  }

  const tasks = await loadTaskDocuments(issuesDir);

  // 找状态为 tdo 或 doi 的子任务（有明确 assignee）
  return tasks.filter((t) => {
    // 子任务：有 assignee 且非 user
    if (t.assignee && t.assignee !== "user" && t.assignee !== "agent") {
      return t.state === "tdo" || t.state === "doi";
    }
    return false;
  });
}

/**
 * 扫描派单记录，找 pending/running
 */
async function scanDispatchRecords(workspacePath: string): Promise<DispatchRecord[]> {
  const result = await loadDispatchRecords(workspacePath);
  return result.records.filter((d) => d.status === "pending" || d.status === "running");
}

/**
 * 扫描子代理状态，找卡住的
 */
async function scanSubagentRecords(workspacePath: string): Promise<SubagentTaskRecord[]> {
  const result = await loadSubagentRecords(workspacePath);
  return result.records;
}

/**
 * 为任务选择合适的 persona
 * 最小策略：按 board 推断
 */
function selectPersona(task: TaskDocumentRecord): string {
  const board = task.board.toLowerCase();

  // 按 board 映射 persona
  if (board.includes("frontend") || board.includes("ui") || board.includes("web")) {
    return "frontend-builder";
  }
  if (board.includes("review") || board.includes("audit")) {
    return "code-reviewer";
  }
  if (board.includes("api") || board.includes("backend")) {
    return "api-builder";
  }

  // 默认
  return "frontend-builder";
}

/**
 * 创建派单记录
 */
function createDispatchRecord(workspacePath: string, task: TaskDocumentRecord, persona: string): DispatchRecord {
  const dispatchId = `dispatch-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  // P1修复: 从任务文档内容提取 goal，而不是简单从 slug 还原
  let goal = task.slug.replace(/-/g, " "); // 默认从 slug 还原
  let acceptance: string[] = task.accept ? [task.accept] : ["任务完成"];
  let expectedArtifacts: string[] | undefined;

  // 尝试读取任务文档内容
  try {
    const taskContent = readFileSync(task.path, "utf-8");
    const lines = taskContent.split("\n");

    // 提取 Task 部分作为 goal（支持多种格式）
    const taskMatch = taskContent.match(/^#\s+Task\s*\n([\s\S]*?)(?=\n#|\n##|$)/m);
    if (taskMatch && taskMatch[1]) {
      const taskLines = taskMatch[1].trim().split("\n");
      // 找第一行非空内容
      for (const line of taskLines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("<!--")) {
          goal = trimmed;
          break;
        }
      }
    } else {
      // 如果没有明确的 Task 部分，尝试找第一个非空段落
      for (const line of lines) {
        const trimmed = line.trim();
        // 跳过 front matter、标题、空行
        if (trimmed && !trimmed.startsWith("---") && !trimmed.startsWith("#") && !trimmed.startsWith("<!--")) {
          goal = trimmed;
          break;
        }
      }
    }

    // 提取验收标准
    const acceptMatch = taskContent.match(/##\s+验收标准[^]*?\n([\s\S]*?)(?=\n#|\n##|$)/m);
    if (acceptMatch && acceptMatch[1]) {
      const acceptLines = acceptMatch[1]
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.match(/^\d+\.\s*\*\*.+\*\*:/))
        .map(line => line.replace(/^\d+\.\s*\*\*[^*]+\*\*:\s*/, "").trim());
      if (acceptLines.length > 0) {
        acceptance = acceptLines;
      }
    }

    // 提取产物路径
    const artifactMatch = taskContent.match(/##\s+产物路径\s*\n\s*`?([^`\n]+)`?\s*\n/m);
    if (artifactMatch && artifactMatch[1]) {
      expectedArtifacts = [artifactMatch[1].trim()];
    }
  } catch (error) {
    logger.warn("[HeartbeatTick] 无法读取任务文档内容，使用默认值", {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  const record: DispatchRecord = {
    dispatchId,
    parentTaskId: task.id,
    childTaskId: task.id,
    client: task.assignee || "codex",
    persona,
    goal,
    cwd: workspacePath,
    acceptance,
    expectedArtifacts,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    filePath: path.join(workspacePath, ".msgcode", "dispatch", `${dispatchId}.json`),
  };

  // 写文件
  const dispatchDir = path.join(workspacePath, ".msgcode", "dispatch");
  mkdirSync(dispatchDir, { recursive: true });
  writeFileSync(record.filePath!, JSON.stringify(record, null, 2));

  return record;
}

/**
 * 推进任务文档状态（tdo -> doi -> rvw -> pss -> dne）
 */
function advanceTaskState(
  workspacePath: string,
  taskId: string,
  newState: "doi" | "pss" | "dne"
): boolean {
  const issuesDir = path.join(workspacePath, "issues");

  if (!existsSync(issuesDir)) {
    return false;
  }

  try {
    // 找当前状态
    const entries = require("fs").readdirSync(issuesDir);
    const currentFile = entries.find((e: string) =>
      e.startsWith(`${taskId}.`) && e.endsWith(".md")
    );

    if (!currentFile) {
      logger.warn("[HeartbeatTick] 任务文件不存在", { taskId });
      return false;
    }

    // 解析当前状态
    const parts = currentFile.replace(".md", "").split(".");
    if (parts.length < 2) {
      return false;
    }

    const currentState = parts[1];
    // 跳过：如果目标状态等于当前状态
    if (currentState === newState) {
      logger.debug("[HeartbeatTick] 任务状态已是目标状态", { taskId, state: newState });
      return true;
    }

    const newFileName = `${taskId}.${newState}.${parts.slice(2).join(".")}.md`;
    const oldPath = path.join(issuesDir, currentFile);
    const newPath = path.join(issuesDir, newFileName);

    // P1修复: 优先尝试 git mv，非 git workspace 时 fallback 到普通 mv
    try {
      execSync(`git mv "${oldPath}" "${newPath}"`, {
        cwd: workspacePath,
        stdio: "ignore",
      });
    } catch {
      // 非 git workspace，使用普通文件重命名
      try {
        require("fs").renameSync(oldPath, newPath);
        logger.info("[HeartbeatTick] 任务状态已推进(非git)", {
          taskId,
          from: currentState,
          to: newState,
        });
      } catch (renameError) {
        logger.warn("[HeartbeatTick] 任务状态推进失败", {
          taskId,
          error: renameError instanceof Error ? renameError.message : String(renameError),
        });
        return false;
      }
    }

    logger.info("[HeartbeatTick] 任务状态已推进", {
      taskId,
      from: currentState,
      to: newState,
    });

    return true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn("[HeartbeatTick] 推进任务状态失败", { taskId, error: errorMsg });
    return false;
  }
}

/**
 * 执行派单
 */
async function executeDispatch(
  dispatch: DispatchRecord,
  config: HeartbeatTickConfig
): Promise<{ success: boolean; error?: string; timeout?: boolean }> {
  // 如果提供了 mock 函数（测试用），处理 mock 结果和超时场景
  if (config.mockSubagentFn) {
    // P2修复: 即使 mock 也要调用 beforeDispatch 以便测试验证参数
    const mockParams = {
      client: dispatch.client,
      goal: dispatch.goal,
      persona: dispatch.persona,
      taskCard: {
        cwd: dispatch.cwd,
        constraints: dispatch.constraints,
        acceptance: dispatch.acceptance,
        artifacts: dispatch.expectedArtifacts,
        parentTask: dispatch.childTaskId,
      },
      workspace: config.workspacePath,
      watch: true,
      timeoutMs: config.subagentTimeoutMs || 5 * 60 * 1000,
    };
    if (config.beforeDispatch) {
      config.beforeDispatch(mockParams);
    }

    try {
      return await config.mockSubagentFn(dispatch);
    } catch (error) {
      // P1修复: mock 超时也要走完整的超时处理逻辑
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isWatchTimeout =
        errorMsg.includes("SUBAGENT_WATCH_TIMEOUT") ||
        errorMsg.includes("watch timeout") ||
        errorMsg.includes("watch 超时") ||
        errorMsg.includes("超时");

      if (isWatchTimeout) {
        logger.warn("[HeartbeatTick] Mock 子代理执行超时，保持running状态", {
          dispatchId: dispatch.dispatchId,
        });

        dispatch.status = "running";
        dispatch.result = {
          completed: false,
          summary: `Mock执行超时: ${errorMsg.slice(0, 200)}`,
        };
        dispatch.updatedAt = new Date().toISOString();

        // 尝试从错误消息提取 taskId
        const taskIdMatch = errorMsg.match(/任务仍在运行:\s*([a-f0-9-]+)/);
        if (taskIdMatch) {
          dispatch.subagentTaskId = taskIdMatch[1];
          logger.info("[HeartbeatTick] Mock超时回填 subagentTaskId", {
            dispatchId: dispatch.dispatchId,
            subagentTaskId: dispatch.subagentTaskId,
          });
        }

        writeFileSync(dispatch.filePath!, JSON.stringify(dispatch, null, 2));
        return { success: false, error: errorMsg, timeout: true };
      }

      // 非 mockSubagentFn 抛错时，直接返回错误
      dispatch.status = "failed";
      dispatch.result = {
        completed: false,
        summary: errorMsg,
      };
      dispatch.updatedAt = new Date().toISOString();
      writeFileSync(dispatch.filePath!, JSON.stringify(dispatch, null, 2));

      return { success: false, error: errorMsg };
    }
  }

  try {
    logger.info("[HeartbeatTick] 执行派单", {
      dispatchId: dispatch.dispatchId,
      client: dispatch.client,
      goal: dispatch.goal,
    });

    const subagentParams = {
      client: dispatch.client,
      goal: dispatch.goal,
      persona: dispatch.persona,
      taskCard: {
        cwd: dispatch.cwd,
        constraints: dispatch.constraints,
        acceptance: dispatch.acceptance,
        artifacts: dispatch.expectedArtifacts,
        parentTask: dispatch.childTaskId,
      },
      workspace: config.workspacePath,
      watch: true,
      timeoutMs: config.subagentTimeoutMs || 5 * 60 * 1000,
    };

    // P2修复: 调用回调以便测试验证参数
    if (config.beforeDispatch) {
      config.beforeDispatch(subagentParams);
    }

    const result = await runSubagentTask(subagentParams);

    // 更新派单状态
    dispatch.status = "completed";
    dispatch.subagentTaskId = result.task.taskId;
    dispatch.result = {
      completed: result.watchResult?.success || false,
      summary: result.watchResult?.response?.slice(0, 500) || "",
    };
    dispatch.updatedAt = new Date().toISOString();
    writeFileSync(dispatch.filePath!, JSON.stringify(dispatch, null, 2));

    // 推进子任务文档状态（tdo -> pss 表示完成待验收）
    if (result.watchResult?.success) {
      advanceTaskState(config.workspacePath, dispatch.childTaskId, "pss");
    }

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    // P1修复: 匹配中文和英文超时关键词
    const isWatchTimeout =
      errorMsg.includes("SUBAGENT_WATCH_TIMEOUT") ||
      errorMsg.includes("watch timeout") ||
      errorMsg.includes("watch 超时") ||
      errorMsg.includes("超时");

    // P1修复: watch超时不应标记为failed，子代理仍在running
    if (isWatchTimeout) {
      logger.warn("[HeartbeatTick] 子代理执行超时，保持running状态", {
        dispatchId: dispatch.dispatchId,
        subagentTaskId: dispatch.subagentTaskId,
      });

      // P1修复: 保持 running 状态和 确保 subagentTaskId 存在
      dispatch.status = "running";
      dispatch.result = {
        completed: false,
        summary: `执行超时，子代理仍在运行: ${errorMsg.slice(0, 200)}`,
      };
      dispatch.updatedAt = new Date().toISOString();

      // P1修复: 从错误消息中提取 taskId 并回填，或从 .msgcode/subagents/ 反查
      if (!dispatch.subagentTaskId) {
        // 尝试从错误消息提取 taskId
        const taskIdMatch = errorMsg.match(/任务仍在运行:\s*([a-f0-9-]+)/);
        if (taskIdMatch) {
          dispatch.subagentTaskId = taskIdMatch[1];
          logger.info("[HeartbeatTick] 从超时消息回填 subagentTaskId", {
            dispatchId: dispatch.dispatchId,
            subagentTaskId: dispatch.subagentTaskId,
          });
        } else {
          // 从 .msgcode/subagents/*.json 反查最新任务
          try {
            const subagentDir = path.join(config.workspacePath, ".msgcode", "subagents");
            if (existsSync(subagentDir)) {
              const entries = require("fs").readdirSync(subagentDir);
              const jsonFiles = entries.filter((e: string) => e.endsWith(".json"));
              if (jsonFiles.length > 0) {
                // 按修改时间排序，取最新
                const sortedFiles = jsonFiles
                  .map((f: string) => ({
                    file: f,
                    mtime: require("fs").statSync(path.join(subagentDir, f)).mtime.getTime(),
                  }))
                  .sort((a: any, b: any) => b.mtime - a.mtime);

                if (sortedFiles.length > 0) {
                  const latestFile = sortedFiles[0].file;
                  const taskId = latestFile.replace(".json", "");
                  dispatch.subagentTaskId = taskId;
                  logger.info("[HeartbeatTick] 从 subagents 目录反查回填 subagentTaskId", {
                    dispatchId: dispatch.dispatchId,
                    subagentTaskId: dispatch.subagentTaskId,
                    source: latestFile,
                  });
                }
              }
            }
          } catch (recoveryError) {
            logger.warn("[HeartbeatTick] 反查 subagentTaskId 失败", {
              dispatchId: dispatch.dispatchId,
              error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
            });
          }
        }

        // 最终检查
        if (!dispatch.subagentTaskId) {
          logger.warn("[HeartbeatTick] 超时但无法获取 subagentTaskId，后续监督可能失败", {
            dispatchId: dispatch.dispatchId,
          });
        }
      }
      writeFileSync(dispatch.filePath!, JSON.stringify(dispatch, null, 2));

      // 不返回 failure，让后续 tick 继续巡检
      return { success: false, error: errorMsg, timeout: true };
    }

    logger.error("[HeartbeatTick] 派单失败", { dispatchId: dispatch.dispatchId, error: errorMsg });

    // 更新派单状态为失败
    dispatch.status = "failed";
    dispatch.result = {
      completed: false,
      summary: errorMsg,
    };
    dispatch.updatedAt = new Date().toISOString();
    writeFileSync(dispatch.filePath!, JSON.stringify(dispatch, null, 2));

    return { success: false, error: errorMsg };
  }
}

/**
 * 检查子代理是否完成
 */
async function checkSubagentCompletion(
  dispatch: DispatchRecord,
  workspacePath: string,
  config?: HeartbeatTickConfig
): Promise<"running" | "completed" | "failed"> {
  if (!dispatch.subagentTaskId) {
    return "running";
  }

  try {
    const status = config?.mockSubagentStatusFn
      ? await config.mockSubagentStatusFn(dispatch)
      : await getSubagentTaskStatus({
          taskId: dispatch.subagentTaskId,
          workspace: workspacePath,
        });

    if (status.task.status === "completed") {
      // 更新 dispatch result
      dispatch.result = {
        completed: true,
        summary: status.paneTail.slice(0, 500),
      };
      dispatch.status = "completed";
      dispatch.updatedAt = new Date().toISOString();
      if (dispatch.filePath) {
        writeFileSync(dispatch.filePath, JSON.stringify(dispatch, null, 2));
      }
      advanceTaskState(workspacePath, dispatch.childTaskId, "pss");
      return "completed";
    }

    if (status.task.status === "failed") {
      dispatch.result = {
        completed: false,
        summary: status.paneTail.slice(0, 500),
      };
      dispatch.status = "failed";
      dispatch.updatedAt = new Date().toISOString();
      if (dispatch.filePath) {
        writeFileSync(dispatch.filePath, JSON.stringify(dispatch, null, 2));
      }
      return "failed";
    }

    return "running";
  } catch {
    return "running";
  }
}

/**
 * 创建 heartbeat tick 处理器
 */
export function createHeartbeatTickHandler(config: HeartbeatTickConfig) {
  const issuesDir = config.issuesDir || path.join(config.workspacePath, "issues");

  return async (ctx: TickContext): Promise<void> => {
    const result: HeartbeatTickResult = {
      hadAction: false,
      summary: [],
      errors: [],
    };

    try {
      logger.info("[HeartbeatTick] 开始巡检", {
        tickId: ctx.tickId,
        workspace: config.workspacePath,
      });

      // 1. 扫描 dispatch 记录 - 优先检查 pending/running
      const dispatchRecords = await scanDispatchRecords(config.workspacePath);

      // 2. 对于 running 的 dispatch，检查子代理状态
      for (const dispatch of dispatchRecords) {
        if (dispatch.status === "running" && dispatch.subagentTaskId) {
          const completion = await checkSubagentCompletion(dispatch, config.workspacePath, config);
          if (completion === "completed" || completion === "failed") {
            result.hadAction = true;
            result.summary.push(`子代理 ${dispatch.subagentTaskId} 已${completion}`);
          }
        }
      }

      // 3. 如果没有 pending dispatch，找可执行的子任务
      const pendingDispatches = dispatchRecords.filter((d) => d.status === "pending");
      if (pendingDispatches.length === 0) {
        const runnableTasks = await scanRunnableTasks(issuesDir);
        if (runnableTasks.length > 0) {
          // 取第一个可执行任务
          const task = runnableTasks[0];
          const persona = selectPersona(task);

          // 创建派单
          const dispatch = createDispatchRecord(config.workspacePath, task, persona);
          result.summary.push(`创建派单 ${dispatch.dispatchId} for task ${task.id}`);

          // 执行派单（只派一个，避免 tick 内堆叠）
          const execResult = await executeDispatch(dispatch, config);
          if (execResult.success) {
            result.summary.push(`派单 ${dispatch.dispatchId} 执行完成`);
          } else {
            result.errors.push(`派单 ${dispatch.dispatchId} 失败: ${execResult.error}`);
          }
          result.hadAction = true;
        }
      } else {
        result.summary.push(`${pendingDispatches.length} 个 pending dispatch 待处理`);
      }

      // 4. 输出结果
      if (!result.hadAction) {
        logger.info("[HeartbeatTick] HEARTBEAT_OK - 无待处理任务");
      } else {
        logger.info("[HeartbeatTick] 动作完成", { summary: result.summary });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("[HeartbeatTick] 巡检失败", { error: errorMsg });
      result.errors.push(errorMsg);
    }
  };
}

/**
 * 启动 heartbeat tick 循环
 */
export function startHeartbeatTick(
  config: HeartbeatTickConfig,
  intervalMs?: number
): HeartbeatRunner {
  const runner = new HeartbeatRunner({
    intervalMs: intervalMs || 60_000, // 默认 1 分钟
    tag: "heartbeat-tick",
  });

  const tickHandler = createHeartbeatTickHandler(config);
  runner.onTick(tickHandler);
  runner.start();

  logger.info("[HeartbeatTick] 已启动", {
    workspace: config.workspacePath,
    intervalMs: intervalMs || 60_000,
  });

  return runner;
}
