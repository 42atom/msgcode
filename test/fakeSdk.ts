/**
 * 简易 Fake SDK 用于单测，模拟 IMessageSDK 基础行为
 */

import type { Message } from "@photon-ai/imessage-kit";

export class FakeSDK {
    public sent: Array<{ address: string; text: string }> = [];
    public watchers: Array<(message: Message) => void> = [];

    async send(address: string, text: string): Promise<void> {
        this.sent.push({ address, text });
    }

    startWatching({ onNewMessage, onGroupMessage }: { onNewMessage: (msg: Message) => void; onGroupMessage: (msg: Message) => void }) {
        this.watchers.push(onNewMessage, onGroupMessage);
    }
}

export function makeMessage(overrides: Partial<Message> = {}): Message {
    return {
        id: overrides.id ?? `${Date.now()}`,
        chatId: overrides.chatId ?? "any;-;test@example.com",
        sender: overrides.sender ?? "test@example.com",
        text: overrides.text ?? "hello",
        isGroupChat: overrides.isGroupChat ?? false,
        isFromMe: overrides.isFromMe ?? false,
    } as Message;
}
