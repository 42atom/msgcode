import { describe, it, expect } from "bun:test";
import { fromImsgRpcMessage } from "../src/imsg/adapter";
import type { ImsgRpcMessage } from "../src/imsg/types";

describe("imsg adapter", () => {
    it("fromImsgRpcMessage should map watch message payload", () => {
        const message: ImsgRpcMessage = {
            id: 7268,
            chat_id: 4348,
            guid: "message-guid-example",
            sender: "wan@example.com",
            is_from_me: false,
            text: "Hello from imsg RPC",
            created_at: "2026-01-28T16:26:41.622Z",
            chat_guid: "any;+;e110497bfed546efadff305352f7aec2",
            chat_identifier: "e110497bfed546efadff305352f7aec2",
            chat_name: "GitProject",
            participants: ["wan@example.com", "agent@example.com"],
            is_group: false,
            attachments: [
                {
                    filename: "file.txt",
                    mime_type: "text/plain",
                    original_path: "/tmp/file.txt",
                    missing: false,
                },
            ],
        };

        const mapped = fromImsgRpcMessage(message);
        expect(mapped.id).toBe("7268");
        expect(mapped.chatId).toBe("any;+;e110497bfed546efadff305352f7aec2");
        expect(mapped.text).toBe("Hello from imsg RPC");
        expect(mapped.isFromMe).toBe(false);
        expect(mapped.sender).toBe("wan@example.com");
        expect(mapped.handle).toBe("wan@example.com");
        expect(mapped.isGroup).toBe(false);
        expect(mapped.attachments?.[0]?.filename).toBe("file.txt");
        expect(mapped.attachments?.[0]?.mime).toBe("text/plain");
        expect(mapped.attachments?.[0]?.path).toBe("/tmp/file.txt");
        expect(typeof mapped.date).toBe("number");
    });
});
