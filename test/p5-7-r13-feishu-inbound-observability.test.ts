import { describe, expect, it } from "bun:test";
import { __test as feishuTransportTest } from "../src/feishu/transport.js";

describe("P5.7-R13: feishu inbound observability", () => {
  it("应从 file 类型内容中提取 resource key 与文件名", () => {
    const inspect = feishuTransportTest?.inspectFeishuContent;
    expect(inspect).toBeDefined();

    const result = inspect!(JSON.stringify({
      file_key: "file_v3_123",
      file_name: "voice-note.opus",
      duration: 3210,
    }));

    expect(result.contentKind).toBe("json-string");
    expect(result.resourceKeyField).toBe("file_key");
    expect(result.resourceKey).toBe("file_v3_123");
    expect(result.fileName).toBe("voice-note.opus");
    expect(result.topLevelKeys).toEqual(["duration", "file_key", "file_name"]);
  });

  it("应从 image 类型内容中提取 image_key", () => {
    const inspect = feishuTransportTest?.inspectFeishuContent;
    expect(inspect).toBeDefined();

    const result = inspect!({
      image_key: "img_v3_456",
      width: 800,
      height: 600,
    });

    expect(result.contentKind).toBe("object");
    expect(result.resourceKeyField).toBe("image_key");
    expect(result.resourceKey).toBe("img_v3_456");
    expect(result.topLevelKeys).toEqual(["height", "image_key", "width"]);
  });

  it("普通字符串内容应保留 preview，但不伪造 resource key", () => {
    const inspect = feishuTransportTest?.inspectFeishuContent;
    expect(inspect).toBeDefined();

    const result = inspect!("plain text payload");

    expect(result.contentKind).toBe("text-string");
    expect(result.resourceKey).toBeUndefined();
    expect(result.topLevelKeys).toEqual([]);
    expect(result.preview).toBe("plain text payload");
  });

  it("应把 audio 内容解析成可下载的附件规格", () => {
    const resolve = feishuTransportTest?.resolveFeishuInboundAttachmentSpec;
    expect(resolve).toBeDefined();

    const result = resolve!(
      "audio",
      "om_audio_1",
      JSON.stringify({
        file_key: "file_v3_audio",
      })
    );

    expect(result).not.toBeNull();
    expect(result?.resourceType).toBe("audio");
    expect(result?.resourceKey).toBe("file_v3_audio");
    expect(result?.filename).toBe("om_audio_1.opus");
    expect(result?.mime).toBe("audio/opus");
  });

  it("应从 file 文件名推断 pdf mime", () => {
    const resolve = feishuTransportTest?.resolveFeishuInboundAttachmentSpec;
    expect(resolve).toBeDefined();

    const result = resolve!(
      "file",
      "om_file_1",
      JSON.stringify({
        file_key: "file_v3_pdf",
        file_name: "spec.pdf",
      })
    );

    expect(result).not.toBeNull();
    expect(result?.resourceType).toBe("file");
    expect(result?.resourceKey).toBe("file_v3_pdf");
    expect(result?.filename).toBe("spec.pdf");
    expect(result?.mime).toBe("application/pdf");
  });

  it("语音资源下载应复用飞书 file 类型通道", () => {
    const resolve = feishuTransportTest?.resolveFeishuInboundAttachmentSpec;
    expect(resolve).toBeDefined();

    const result = resolve!(
      "audio",
      "om_audio_2",
      JSON.stringify({
        file_key: "file_v3_audio_2",
      })
    );

    expect(result).not.toBeNull();
    const downloadType = result?.resourceType === "image" ? "image" : "file";
    expect(downloadType).toBe("file");
  });

  it("应标准化 chat_type 并判断是否群聊", () => {
    const normalizeChatType = feishuTransportTest?.normalizeFeishuChatType;
    const resolveIsGroup = feishuTransportTest?.resolveFeishuIsGroup;
    expect(normalizeChatType).toBeDefined();
    expect(resolveIsGroup).toBeDefined();

    expect(normalizeChatType!(" group ")).toBe("group");
    expect(resolveIsGroup!("group")).toBe(true);
    expect(resolveIsGroup!("p2p")).toBe(false);
    expect(resolveIsGroup!(undefined)).toBeUndefined();
  });
});
