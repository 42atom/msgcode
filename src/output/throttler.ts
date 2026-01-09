/**
 * msgcode: 节流器
 *
 * 确保消息发送间隔不小于指定值，防止手机狂震
 */

/**
 * 节流器
 *
 * 控制消息发送的最小时间间隔
 */
export class Throttler {
    private lastSendTime = 0;
    private readonly minInterval: number;

    /**
     * @param minInterval 最小发送间隔（毫秒），默认 1500ms
     */
    constructor(minInterval: number = 1500) {
        this.minInterval = minInterval;
    }

    /**
     * 检查是否可以立即发送
     */
    canSend(): boolean {
        const now = Date.now();
        return now - this.lastSendTime >= this.minInterval;
    }

    /**
     * 等待直到可以发送
     */
    async wait(): Promise<void> {
        while (!this.canSend()) {
            const waitTime = this.minInterval - (Date.now() - this.lastSendTime);
            if (waitTime > 0) {
                // 最多等待 100ms，避免阻塞太久
                await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 100)));
            }
        }
    }

    /**
     * 记录发送时间（在发送后调用）
     */
    recordSend(): void {
        this.lastSendTime = Date.now();
    }

    /**
     * 重置计时器（用于测试或特殊情况）
     */
    reset(): void {
        this.lastSendTime = 0;
    }

    /**
     * 获取距离下次可发送的等待时间（毫秒）
     */
    getWaitTime(): number {
        const waitTime = this.minInterval - (Date.now() - this.lastSendTime);
        return Math.max(0, waitTime);
    }
}
