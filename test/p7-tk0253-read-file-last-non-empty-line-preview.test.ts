import { describe, expect, it } from "bun:test";
import { buildReadFilePreviewText } from "../src/tools/previews.js";

describe("tk0253: read_file preview contract", () => {
  it("文本分页预览应暴露继续读取指针", () => {
    const preview = buildReadFilePreviewText({
      filePath: "/tmp/large.txt",
      kind: "text",
      content: "PAGE-ONE-CONTENT",
      byteLength: 80_000,
      totalBytes: 80_000,
      offset: 0,
      limit: 16_384,
      hasMore: true,
      nextOffset: 16_384,
      truncated: true,
    });

    expect(preview).toContain("[status] paginated");
    expect(preview).toContain("[offset] 0");
    expect(preview).toContain("[limit] 16384");
    expect(preview).toContain("[hasMore] true");
    expect(preview).toContain("[nextOffset] 16384");
    expect(preview).toContain("PAGE-ONE-CONTENT");
  });

  it("二进制预览应返回最薄 blob handle 语义", () => {
    const preview = buildReadFilePreviewText({
      filePath: "/tmp/binary.png",
      kind: "binary",
      byteLength: 10,
      totalBytes: 10,
      offset: 0,
      limit: 0,
      hasMore: false,
      nextOffset: null,
      binaryKind: "PNG 图片",
      handle: "blob:/tmp/binary.png",
      blob: {
        type: "file",
        path: "/tmp/binary.png",
        byteLength: 10,
        mediaKind: "PNG 图片",
      },
      truncated: false,
    });

    expect(preview).toContain("[status] blob-handle");
    expect(preview).toContain("[binaryKind] PNG 图片");
    expect(preview).toContain("[handle] blob:/tmp/binary.png");
    expect(preview).toContain("[blobPath] /tmp/binary.png");
  });
});
