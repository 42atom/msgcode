import { describe, expect, it } from "bun:test";
import { buildRendererHtml, resolveElectronRuntimePaths } from "../src/electron/main.js";
import { createReadonlySurfaceBridge } from "../src/electron/preload.js";
import { bootstrapReadonlyThreadSurface } from "../src/electron/renderer.js";

describe("electron runtime bootstrap slice", () => {
  it("resolves preload and renderer entry from main module path", () => {
    const paths = resolveElectronRuntimePaths("file:///tmp/msgcode/dist/electron/main.js");
    expect(paths.preloadPath).toBe("/tmp/msgcode/dist/electron/preload.js");
    expect(paths.rendererEntryUrl).toBe("file:///tmp/msgcode/dist/electron/renderer.js");
  });

  it("builds a renderer shell that only loads a module entry", () => {
    const html = buildRendererHtml("file:///tmp/msgcode/dist/electron/renderer.js");
    expect(html).toContain('<div id="app-root"></div>');
    expect(html).toContain('<script type="module" src="file:///tmp/msgcode/dist/electron/renderer.js"></script>');
  });

  it("exposes a placeholder bridge that fails closed", async () => {
    const bridge = createReadonlySurfaceBridge();
    expect(bridge.mode).toBe("placeholder");
    await expect(bridge.runCommand({ command: "workspace-tree", args: ["--json"] })).rejects.toThrow(
      "Readonly host bridge not implemented yet: workspace-tree",
    );
  });

  it("boots the readonly thread surface into a renderer document", () => {
    const writes: string[] = [];
    const documentLike = {
      open() {
        writes.push("<open>");
      },
      write(content: string) {
        writes.push(content);
      },
      close() {
        writes.push("<close>");
      },
    };

    bootstrapReadonlyThreadSurface(documentLike);

    expect(writes[0]).toBe("<open>");
    expect(writes[2]).toBe("<close>");
    expect(writes[1]).toContain('data-surface-slot="workspace-tree"');
    expect(writes[1]).toContain('data-bridge-entry="window.msgcodeReadonlySurface.runCommand"');
    expect(writes[1]).toContain('href="#settings"');
  });
});
