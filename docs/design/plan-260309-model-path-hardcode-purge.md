# 模型路径去硬编码专项修复

## Problem

TTS/ASR 路径决策存在多处硬编码开发机路径：

1. **qwen.ts**: `/Users/admin/GitProjects/GithubDown/qwen3-tts-apple-silicon` fallback
2. **tts probe**: 同上
3. **preflight.ts**: 同上
4. **asr.ts**: `~/Models/whisper-large-v3-mlx` 默认
5. **prompt**: `/Users/admin/.config/msgcode/...` 硬编码

不同模块对同一后端得到不同默认路径，且开发机路径泄漏到运行时。

## Occam Check

1. **不加它，系统具体坏在哪？**
   - 用户在不同环境运行会拿到开发机路径，导致找不到模型文件
   - probe/preflight/backend 对同一后端语义不一致
   - prompt 包含用户目录，泄露到代码仓库

2. **用更少的层能不能解决？**
   - 可以，只需一个共享的 resolver 模块收口所有路径决策
   - 不需要 PathManager、注册中心等额外抽象

3. **这个改动让主链数量变多了还是变少了？**
   - 变少：原来 3 处独立决策 -> 1 处共享决策

## Decision

**方案：新增共享路径解析模块 `src/media/model-paths.ts`**

- 导出统一路径解析函数
- 默认路径基于 `~/Models/<model-name>` 语义
- 未配置时返回错误，不静默猜测

**核心原则：单一真相源 + 显式错误**

## Plan

### 1. 创建 `src/media/model-paths.ts`

导出函数：
```typescript
// 展开 ~ 为真实 HOME
export function expandHome(p: string): string

// Qwen TTS 路径解析
export function resolveQwenTtsPaths(): {
  source: "env" | "default";
  root: string;
  python: string;
  customModel: string;
  cloneModel: string;
}

// IndexTTS 路径解析
export function resolveIndexTtsPaths(): {
  source: "env" | "default";
  root: string;
  python: string;
  modelDir: string;
  config: string;
}

// ASR Whisper 路径解析
export function resolveAsrPaths(): {
  source: "env" | "default";
  modelDir: string;
}
```

默认值语义：
- `QWEN_TTS_ROOT`: `~/Models/qwen3-tts-apple-silicon`
- `INDEX_TTS_ROOT`: `~/Models/index-tts`
- `WHISPER_MODEL_DIR` / `MODEL_ROOT`: `~/Models/whisper-large-v3-mlx`

### 2. 接入 TTS 主链

- **qwen.ts**: 删除本地 `resolveQwenRoot/resolveQwenPaths`，改用 shared resolver
- **tts probe**: 删除本地 resolver，改用 shared resolver
- **preflight.ts**: 删除本地 expandPath 里的 hardcode，改用 shared resolver

### 3. 接入 ASR

- **asr.ts**: 改用 shared resolver（仅收口默认路径逻辑）

### 4. Prompt 清理

- `prompts/agents-prompt.md`: 将 `/Users/admin/.config/msgcode/...` 改为占位符
- `src/agent-backend/prompt.ts`: 增加模板注入逻辑，运行时替换为真实路径

### 5. 验证

- 运行 TTS/ASR 相关测试
- 验证 probe 输出与 backend 路径一致

## Risks

1. **向后兼容**：用户可能依赖现有 hardcode fallback
   - 缓解：迁移期保留检测，打印 warning 引导用户配置
2. **路径注入时机**：prompt 注入需要在 agent 初始化前完成
   - 缓解：在 prompt.ts 初始化时注入
3. **测试覆盖**：需要确保测试覆盖路径解析分支
   - 缓解：添加行为测试，验证默认路径展开

## Migration

- 不需要数据迁移
- 仅代码重构，不改变运行时行为（除移除 hardcode fallback）
