import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import {
    withRemoteHintIfNeeded,
    resetRemoteHintForSession,
    __resetRemoteHintForTests,
} from "../src/tmux/remote_hint.js";

describe("tmux remote hint", () => {
    const SESSION = "msgcode-default";

    beforeEach(() => {
        delete process.env.MSGCODE_REMOTE_HINT;
        delete process.env.MSGCODE_REMOTE_HINT_TEXT;
        __resetRemoteHintForTests();
    });

    afterEach(() => {
        delete process.env.MSGCODE_REMOTE_HINT;
        delete process.env.MSGCODE_REMOTE_HINT_TEXT;
        __resetRemoteHintForTests();
    });

    it("默认开启：同一 session 只注入一次", () => {
        const first = withRemoteHintIfNeeded(SESSION, "hello");
        expect(first).toContain("【远程上下文｜勿复述】");
        expect(first).toContain("hello");

        const second = withRemoteHintIfNeeded(SESSION, "hello2");
        expect(second).toBe("hello2");
    });

    it("可关闭：MSGCODE_REMOTE_HINT=0", () => {
        process.env.MSGCODE_REMOTE_HINT = "0";
        const first = withRemoteHintIfNeeded(SESSION, "hello");
        expect(first).toBe("hello");
    });

    it("支持自定义文案：MSGCODE_REMOTE_HINT_TEXT", () => {
        process.env.MSGCODE_REMOTE_HINT_TEXT = "CUSTOM_HINT";
        const first = withRemoteHintIfNeeded(SESSION, "hello");
        expect(first).toContain("CUSTOM_HINT");
        expect(first).toContain("hello");
    });

    it("会话重启后可再次注入（resetRemoteHintForSession）", () => {
        const first = withRemoteHintIfNeeded(SESSION, "hello");
        expect(first).toContain("【远程上下文｜勿复述】");

        resetRemoteHintForSession(SESSION);
        const second = withRemoteHintIfNeeded(SESSION, "again");
        expect(second).toContain("【远程上下文｜勿复述】");
        expect(second).toContain("again");
    });
});

