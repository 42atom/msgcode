/**
 * msgcode: Model Capabilities Registry
 *
 * Purpose:
 * - Define model capabilities for context budgeting
 * - Support per-provider token limits and reservations
 *
 * Design:
 * - Start with MLX only (lmstudio to be added later)
 * - Fallback to safe defaults if provider not found
 */

// ============================================
// Types
// ============================================

/**
 * Model capability descriptor
 */
export interface ModelCapabilities {
    /**
     * Total context window size in tokens
     * - Default: 4096 (conservative for GLM4.7 Flash)
     */
    contextWindowTokens: number;

    /**
     * Reserved tokens for model output
     * - Default: 1024 (ensure space for response)
     */
    reservedOutputTokens: number;

    /**
     * Approximate characters per token
     * - Default: 2 (Chinese/English mixed)
     */
    charsPerToken: number;
}

/**
 * Budget target types (用于 context budgeting)
 *
 * 注意：这是 budget/capabilities 的目标分类，不是完整意义上的 provider registry
 * - "mlx" / "lmstudio": 本地模型 providers
 * - "codex" / "claude-code": tmux runners (共享 MLX capabilities)
 */
export type BudgetTarget = "mlx" | "lmstudio" | "codex" | "claude-code";

// ============================================
// Capability Definitions
// ============================================

/**
 * Default capabilities for MLX (GLM4.7 Flash)
 *
 * GLM4.7 Flash context window: ~128k tokens (theoretical)
 * - Use 16384 (16k) as practical limit for stability
 * - GLM-4.7 tends to loop with very long contexts
 * - 16k provides good balance between memory and stability
 */
const MLX_CAPABILITIES: ModelCapabilities = {
    contextWindowTokens: 16384,  // 16k tokens (increased from 4096 for better context)
    reservedOutputTokens: 2048,    // Reserve more space for longer responses
    charsPerToken: 2,
};

/**
 * Capabilities registry (to be extended for other targets)
 */
const CAPABILITIES_REGISTRY: Record<BudgetTarget, ModelCapabilities> = {
    mlx: MLX_CAPABILITIES,
    lmstudio: MLX_CAPABILITIES,
    codex: MLX_CAPABILITIES,
    "claude-code": MLX_CAPABILITIES,
};

// ============================================
// Public API
// ============================================

/**
 * Get capabilities for a budget target
 *
 * @param target - Budget target type (mlx, lmstudio, codex, claude-code)
 * @returns Model capabilities or safe defaults
 */
export function getCapabilities(target: BudgetTarget): ModelCapabilities {
    const caps = CAPABILITIES_REGISTRY[target];

    if (!caps) {
        // Safe fallback: assume smaller context window
        return {
            contextWindowTokens: 4096,
            reservedOutputTokens: 1024,
            charsPerToken: 2,
        };
    }

    return caps;
}

/**
 * Get input budget (context window minus reserved output)
 *
 * @param target - Budget target type
 * @returns Input budget in tokens
 */
export function getInputBudget(target: BudgetTarget): number {
    const caps = getCapabilities(target);
    return caps.contextWindowTokens - caps.reservedOutputTokens;
}
