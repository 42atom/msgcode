import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("tk0198-tk0201 managed bash mainline", () => {
  it("bash runner should stop using shell:true and pin managed bash paths", () => {
    const code = read("src/runners/bash-runner.ts");
    expect(code).toContain('"/opt/homebrew/bin/bash"');
    expect(code).toContain('"/usr/local/bin/bash"');
    expect(code).toContain('shell: false');
    expect(code).not.toContain("shell: true");
    expect(code).toContain('spawn(bashPath, ["--noprofile", "--norc", "-lc", command], {');
  });

  it("default bootstrap should make Homebrew bash the only shell dependency", () => {
    const brewfile = read("bootstrap/Brewfile");
    const doctor = read("bootstrap/doctor-managed-bash.sh");
    const bootstrapReadme = read("bootstrap/README.md");

    expect(brewfile).toContain('brew "bash"');
    expect(doctor).toContain("/opt/homebrew/bin/bash");
    expect(doctor).toContain("/usr/local/bin/bash");
    expect(doctor).toContain("brew install bash");
    expect(bootstrapReadme).toContain("用户登录 shell");
    expect(bootstrapReadme).toContain("/bin/bash");
    expect(bootstrapReadme).toContain("/bin/sh");
  });

  it("optional agent toolset should have a separate entry and doctor", () => {
    const brewfileAgent = read("bootstrap/Brewfile.agent");
    const bootstrapReadme = read("bootstrap/README.md");
    const doctor = read("bootstrap/doctor-agent-pack.sh");

    expect(brewfileAgent).toContain('brew "tmux"');
    expect(brewfileAgent).toContain('brew "ripgrep"');
    expect(bootstrapReadme).toContain("可选增强");
    expect(bootstrapReadme).toContain("不是默认主链");
    expect(doctor).toContain("tmux uv bun rg fd jq fzf bat eza");
  });

  it("README and prompt should write the same shell contract", () => {
    const readme = read("README.md");
    const prompt = read("prompts/agents-prompt.md");

    expect(readme).toContain("/opt/homebrew/bin/bash");
    expect(readme).toContain("/usr/local/bin/bash");
    expect(readme).toContain("不是用户登录 shell");
    expect(readme).toContain("不假设 `zsh`");
    expect(readme).toContain("不假设系统 `/bin/bash` 3.2");

    expect(prompt).toContain("/opt/homebrew/bin/bash");
    expect(prompt).toContain("/usr/local/bin/bash");
    expect(prompt).toContain("不是用户登录 shell");
    expect(prompt).toContain("不要假设 `zsh`");
    expect(prompt).toContain("不要假设系统 `/bin/bash` 3.2");
  });
});
