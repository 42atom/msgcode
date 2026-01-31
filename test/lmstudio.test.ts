import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import { config } from "../src/config.js";
import { runLmStudioChat, sanitizeLmStudioOutput } from "../src/lmstudio.js";

type FetchCall = {
    url: string;
    init?: RequestInit;
};

describe("lmstudio", () => {
    const originalFetch = globalThis.fetch;
    const originalBaseUrl = config.lmstudioBaseUrl;
    const originalModel = config.lmstudioModel;

    beforeEach(() => {
        config.lmstudioBaseUrl = "http://lmstudio.test";
        config.lmstudioModel = undefined;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        config.lmstudioBaseUrl = originalBaseUrl;
        config.lmstudioModel = originalModel;
    });

    it("sanitize: drops think tags", () => {
        const input = "aaa\n\nccc";
        expect(sanitizeLmStudioOutput(input)).toBe("ccc");
    });

    it("auto-selects model via /v1/models when LMSTUDIO_MODEL is missing", async () => {
        const calls: FetchCall[] = [];

        globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            calls.push({ url: String(url), init });

            if (String(url).endsWith("/api/v1/models")) {
                return new Response(JSON.stringify({
                    models: [
                        {
                            type: "llm",
                            key: "model-a",
                            loaded_instances: [{ id: "model-a", model_key: "model-a" }],
                        },
                    ],
                    total: 1,
                }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            }

            if (String(url).endsWith("/api/v1/chat")) {
                return new Response(
                    JSON.stringify({
                        output: [{ type: "message", content: "ok" }],
                    }),
                    { status: 200, headers: { "content-type": "application/json" } }
                );
            }

            return new Response("not found", { status: 404 });
        };

        const out = await runLmStudioChat({ prompt: "hi" });
        expect(out).toBe("ok");

        expect(calls.length).toBe(2);
        expect(calls[0].url.endsWith("/api/v1/models")).toBe(true);
        expect(calls[1].url.endsWith("/api/v1/chat")).toBe(true);

        const body = JSON.parse(String(calls[1].init?.body || "{}"));
        expect(body.model).toBe("model-a");
        expect(body.max_output_tokens).toBe(4000);
        expect(body.input).toBe("hi");
    });

    it("uses configured model without calling /v1/models", async () => {
        config.lmstudioModel = "fixed-model";

        const calls: FetchCall[] = [];
        globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            calls.push({ url: String(url), init });
            return new Response(
                JSON.stringify({
                    output: [{ type: "message", content: "ok" }],
                }),
                { status: 200, headers: { "content-type": "application/json" } }
            );
        };

        const out = await runLmStudioChat({ prompt: "hi" });
        expect(out).toBe("ok");

        expect(calls.length).toBe(1);
        expect(calls[0].url.endsWith("/api/v1/chat")).toBe(true);

        const body = JSON.parse(String(calls[0].init?.body || "{}"));
        expect(body.model).toBe("fixed-model");
        expect(body.max_output_tokens).toBe(4000);
    });

    it("falls back to /v1/chat/completions when /api/v1/chat returns 404", async () => {
        config.lmstudioModel = "openai-model";

        const calls: FetchCall[] = [];
        globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            calls.push({ url: String(url), init });

            if (String(url).endsWith("/api/v1/chat")) {
                return new Response(JSON.stringify({ error: "not found" }), {
                    status: 404,
                    headers: { "content-type": "application/json" },
                });
            }

            if (String(url).endsWith("/v1/chat/completions")) {
                return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            }

            return new Response("not found", { status: 404 });
        };

        const out = await runLmStudioChat({ prompt: "hi" });
        expect(out).toBe("ok");

        expect(calls.length).toBe(2);
        expect(calls[0].url.endsWith("/api/v1/chat")).toBe(true);
        expect(calls[1].url.endsWith("/v1/chat/completions")).toBe(true);

        const body = JSON.parse(String(calls[1].init?.body || "{}"));
        expect(body.model).toBe("openai-model");
        expect(body.max_tokens).toBe(4000);
    });

    it("formats a clearer error when server reports model has crashed (500)", async () => {
        config.lmstudioModel = "crash-model";

        globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            if (String(url).endsWith("/api/v1/chat")) {
                return new Response(
                    JSON.stringify({
                        error: { message: "The model has crashed without additional information. (Exit code: null)" },
                    }),
                    { status: 500, headers: { "content-type": "application/json" } }
                );
            }
            if (String(url).endsWith("/v1/chat/completions")) {
                return new Response(
                    JSON.stringify({
                        error: { message: "The model has crashed without additional information. (Exit code: null)" },
                    }),
                    { status: 500, headers: { "content-type": "application/json" } }
                );
            }
            return new Response("not found", { status: 404 });
        };

        let msg = "";
        try {
            await runLmStudioChat({ prompt: "hi" });
        } catch (e: any) {
            msg = String(e?.message || "");
        }

        expect(msg).toContain("模型进程崩溃");
    });

    it("retries once with smaller max tokens on model crash", async () => {
        config.lmstudioModel = "retry-model";

        let chatCalls = 0;
        const bodies: Array<Record<string, unknown>> = [];

        globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            if (String(url).endsWith("/api/v1/chat")) {
                chatCalls++;
                bodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);

                if (chatCalls === 1) {
                    return new Response(
                        JSON.stringify({ error: { message: "The model has crashed without additional information. (Exit code: null)" } }),
                        { status: 500, headers: { "content-type": "application/json" } }
                    );
                }

                return new Response(
                    JSON.stringify({ output: [{ type: "message", content: "ok" }] }),
                    { status: 200, headers: { "content-type": "application/json" } }
                );
            }

            return new Response("not found", { status: 404 });
        };

        const out = await runLmStudioChat({ prompt: "hi" });
        expect(out).toBe("ok");
        expect(chatCalls).toBe(2);
        expect(bodies[0]?.max_output_tokens).toBe(4000);
        expect(bodies[1]?.max_output_tokens).toBe(1600);
    });
});
