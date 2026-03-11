import { describe, it, expect } from "bun:test";

import { parseToolCallBestEffortFromText } from "../src/lmstudio.js";

describe("lmstudio tool call parse (best-effort)", () => {
  it("parses XML-ish format", () => {
    const parsed = parseToolCallBestEffortFromText({
      text: `陈列read_file陈列path陈列./AIDOCS/test.txt陈列/read_file`.trim(),
    });
    expect(parsed?.name).toBe("read_file");
    expect(parsed?.args.path).toBe("./AIDOCS/test.txt");
  });

  it("parses JSON array format", () => {
    const parsed = parseToolCallBestEffortFromText({
      text: `[{"name":"read_file","arguments":"{\\"path\\":\\"./AIDOCS/test.txt\\"}"}]`,
    });
    expect(parsed?.name).toBe("read_file");
    expect(parsed?.args.path).toBe("./AIDOCS/test.txt");
  });

  it("parses inline name + json object format", () => {
    const parsed = parseToolCallBestEffortFromText({
      text: `read_file {"path":"./AIDOCS/test.txt"}`,
    });
    expect(parsed?.name).toBe("read_file");
    expect(parsed?.args.path).toBe("./AIDOCS/test.txt");
  });

  it("parses name(args) format", () => {
    const parsed = parseToolCallBestEffortFromText({
      text: `read_file(path="./AIDOCS/test.txt")`,
    });
    expect(parsed?.name).toBe("read_file");
    expect(parsed?.args.path).toBe("./AIDOCS/test.txt");
  });

  it("returns null for unknown tool", () => {
    const parsed = parseToolCallBestEffortFromText({
      text: `rm -rf {"path":"/"}`,
    });
    expect(parsed).toBeNull();
  });
});
