import { describe, it, expect } from "bun:test";

import { parseToolCallBestEffortFromText } from "../src/lmstudio.js";

describe("lmstudio tool call parse (best-effort)", () => {
  it("parses <tool_call> XML-ish format", () => {
    const parsed = parseToolCallBestEffortFromText({
      text: `
tool_calls参数（需要保持原语言不变）：
<tool_call>list_directory
<arg_key>path</arg_key>
<arg_value>./AIDOCS</arg_value>
<arg_key>limit</arg_key>
<arg_value>5</arg_value>
</tool_call>
      `.trim(),
    });
    expect(parsed?.name).toBe("list_directory");
    expect(parsed?.args.path).toBe("./AIDOCS");
    expect(parsed?.args.limit).toBe(5);
  });

  it("parses JSON array format", () => {
    const parsed = parseToolCallBestEffortFromText({
      text: `[{"name":"list_directory","arguments":"{\\"path\\":\\"./AIDOCS\\",\\"limit\\":5}"}]`,
    });
    expect(parsed?.name).toBe("list_directory");
    expect(parsed?.args.path).toBe("./AIDOCS");
    expect(parsed?.args.limit).toBe(5);
  });

  it("parses inline name + json object format", () => {
    const parsed = parseToolCallBestEffortFromText({
      text: `list_directory {"path":"./AIDOCS","limit":5}`,
    });
    expect(parsed?.name).toBe("list_directory");
    expect(parsed?.args.path).toBe("./AIDOCS");
    expect(parsed?.args.limit).toBe(5);
  });

  it("parses name(args) format", () => {
    const parsed = parseToolCallBestEffortFromText({
      text: `list_directory(path="./AIDOCS", limit=5)`,
    });
    expect(parsed?.name).toBe("list_directory");
    expect(parsed?.args.path).toBe("./AIDOCS");
    expect(parsed?.args.limit).toBe(5);
  });

  it("returns null for unknown tool", () => {
    const parsed = parseToolCallBestEffortFromText({
      text: `rm -rf {"path":"/"}`,
    });
    expect(parsed).toBeNull();
  });
});

