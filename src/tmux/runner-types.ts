/**
 * tmux runner shared types
 *
 * 只承载 registry/session 共用的最薄 runner 定义，
 * 避免 registry 反向依赖 session 主实现。
 */

/**
 * 旧执行臂类型（存储层兼容）
 *
 * - 用于 SessionRecord.runner 字段存储（兼容历史数据）
 * - 逐步废弃，新代码应使用 RunnerType（运行时分类）+ runnerOld（具体 CLI）
 */
export type RunnerTypeOld = "claude" | "codex" | "claude-code";

/**
 * 运行时执行臂分类
 *
 * - tmux: 需要 tmux 会话管理（codex / claude CLI）
 * - direct: 直接调用 provider（mlx / lmstudio / llama / openai / ...）
 */
export type RunnerType = "tmux" | "direct";

/**
 * 归一化 runnerOld → runnerType（守卫：不信任外部传入）
 */
export function normalizeRunnerType(runner: RunnerTypeOld): RunnerType {
    // 本文件只管理 tmux 会话；历史 runnerOld 均归到 tmux。
    // direct providers 不会写入 tmux registry。
    void runner;
    return "tmux";
}
