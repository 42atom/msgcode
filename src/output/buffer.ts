/**
 * msgcode: 缓冲区管理器
 *
 * 根据语义触发条件决定是否发送内容
 * 实现"节奏舒适的段落感"输出体验
 */

/**
 * 缓冲区触发配置
 */
interface BufferConfig {
    maxLength: number;        // 强制触发最大长度
    longSentenceLength: number; // 长句触发最小长度
}

/**
 * 缓冲区管理器
 *
 * 累积输出内容，在满足语义条件时触发发送
 */
export class BufferManager {
    private buffer = "";
    private readonly config: BufferConfig;

    constructor(config?: Partial<BufferConfig>) {
        this.config = {
            maxLength: config?.maxLength ?? 800,  // 平衡响应速度和完整性
            longSentenceLength: config?.longSentenceLength ?? 100,  // 平衡段落感和速度
        };
    }

    /**
     * 添加新内容到缓冲区
     */
    append(text: string): void {
        this.buffer += text;
    }

    /**
     * 检查是否应该触发发送
     *
     * 触发条件（满足其一即发送）：
     * 1. 段落分隔: \n\n
     * 2. 代码块闭合: 偶数个 ```
     * 3. 长句停顿: 长度 > N 且遇到标点
     * 4. 强制兜底: 长度 >= MAX_LENGTH
     */
    shouldFlush(): boolean {
        if (this.buffer.length === 0) {
            return false;
        }

        // 1. 段落分隔
        if (this.buffer.includes("\n\n")) {
            return true;
        }

        // 2. 代码块闭合（检测偶数个 ```）
        const codeBlockCount = (this.buffer.match(/```/g) || []).length;
        if (codeBlockCount > 0 && codeBlockCount % 2 === 0) {
            return true;
        }

        // 3. 长句停顿
        if (this.buffer.length > this.config.longSentenceLength) {
            const lastChar = this.buffer[this.buffer.length - 1];
            if (["。", "！", "？", "；", "\n"].includes(lastChar)) {
                return true;
            }
        }

        // 4. 强制兜底
        if (this.buffer.length >= this.config.maxLength) {
            return true;
        }

        return false;
    }

    /**
     * 获取并清空缓冲区
     */
    flush(): string {
        const content = this.buffer;
        this.buffer = "";
        return content;
    }

    /**
     * 强制清空（用于完成时发送剩余内容）
     */
    forceFlush(): string {
        return this.flush();
    }

    /**
     * 获取当前缓冲区长度
     */
    get length(): number {
        return this.buffer.length;
    }

    /**
     * 获取当前缓冲区内容（不清空）
     */
    get content(): string {
        return this.buffer;
    }

    /**
     * 清空缓冲区
     */
    clear(): void {
        this.buffer = "";
    }
}
