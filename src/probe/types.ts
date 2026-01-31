/**
 * msgcode: 探针类型定义
 *
 * 定义探针结果和执行器接口
 */

/**
 * 单个探针结果
 */
export interface ProbeResult {
    /** 探针名称 */
    name: string;
    /** 是否通过 */
    ok: boolean;
    /** 详细信息 */
    details: string;
    /** 修复建议（失败时） */
    fixHint?: string;
}

/**
 * 探针汇总
 */
export interface ProbeSummary {
    /** 通过数量 */
    ok: number;
    /** 失败数量 */
    fail: number;
    /** 跳过数量 */
    skip: number;
}

/**
 * 完整探针报告
 */
export interface ProbeReport {
    /** 所有探针结果 */
    results: ProbeResult[];
    /** 汇总统计 */
    summary: ProbeSummary;
    /** 是否全部通过 */
    allOk: boolean;
}

/**
 * 命令执行结果
 */
export interface ExecResult {
    /** 标准输出 */
    stdout: string;
    /** 标准错误输出 */
    stderr: string;
    /** 退出码 */
    exitCode: number;
}

/**
 * 命令执行器接口（可注入，用于测试）
 */
export interface CommandExecutor {
    /**
     * 执行命令
     * @param command 要执行的命令
     * @returns 执行结果
     */
    exec(command: string): Promise<ExecResult>;
}

/**
 * 探针配置
 */
export interface ProbeConfig {
    /** imsg 二进制路径 */
    imsgPath?: string;
    /** routes.json 路径 */
    routesPath: string;
    /** 工作空间根目录 */
    workspaceRoot: string;
}
