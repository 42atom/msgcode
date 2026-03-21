import { afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildDmg } from "../src/runtime/build-dmg.js";

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-build-dmg-"));
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

describe("dmg packaging slice", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应只消费 .app 并调用 hdiutil 生成 dmg", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const appPath = path.join(root, "MsgCode.app");
    const outputPath = path.join(root, "out", "MsgCode.dmg");
    const calls: Array<{ file: string; args: string[] }> = [];

    await writeFile(path.join(appPath, "Contents", "Info.plist"), "<plist />\n");

    const result = await buildDmg({
      appPath,
      outputPath,
      commandRunner: async (file, args) => {
        calls.push({ file, args });
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, "fake dmg", "utf8");
      },
    });

    expect(result.appPath).toBe(appPath);
    expect(result.outputPath).toBe(outputPath);
    expect(result.volumeName).toBe("MsgCode");
    expect(result.signingStatus).toBe("not-implemented");
    expect(result.notarizationStatus).toBe("not-implemented");
    expect(existsSync(outputPath)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe("hdiutil");
    expect(calls[0]?.args).toContain("create");
    expect(calls[0]?.args).toContain("-srcfolder");
    expect(calls[0]?.args).toContain(outputPath);
  });

  it("缺少 Info.plist 时应直接失败", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const appPath = path.join(root, "MsgCode.app");
    await fs.mkdir(appPath, { recursive: true });

    await expect(buildDmg({
      appPath,
      outputPath: path.join(root, "MsgCode.dmg"),
    })).rejects.toThrow("Invalid app bundle, missing Contents/Info.plist");
  });
});
