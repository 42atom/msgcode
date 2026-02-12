# Desktop Recipes

本目录包含 Desktop 自动化流程的 recipe 文件（JSON 格式）。

## 使用方法

```bash
# 执行 recipe
npx tsx scripts/desktop/run-recipe.ts recipes/desktop/<recipe-name>.json

# 查看可用 recipe
ls recipes/desktop/
```

## Recipe 文件

### token_test_v0.json - Token 机制测试
**类型**: 环境无关测试
**用途**: 测试 token 签发、使用和 reuse 拒绝
**依赖**: 无（使用 hotkey escape，可在任意环境运行）
**失败优先排查**: Desktop Host 是否运行、LaunchAgent 是否已安装、权限是否齐全（建议先跑 `/desktop doctor`）
**运行**:
```bash
npx tsx scripts/desktop/run-recipe.ts recipes/desktop/token_test_v0.json
```

### terminal_echo_v0.json - Terminal 回显演示
**类型**: 环境依赖 demo（手动测试）
**用途**: 在 Terminal 中输入文本并回车，演示完整 recipe 流程
**定位**: 手动 demo，不作为 CI/开源默认验收（会受前台应用/焦点/输入法影响）
**前置条件**:
1. 确保 Terminal.app 已启动并置为前台
2. 确保 Terminal 输入区已聚焦（可点击输入区域）
3. 确保已授予辅助功能和屏幕录制权限
**运行**:
```bash
npx tsx scripts/desktop/run-recipe.ts recipes/desktop/terminal_echo_v0.json
```

## 规范文档

详见：`docs/desktop/recipe-dsl.md`

## 新增 Recipe

1. 复制现有 recipe 文件作为模板
2. 修改 `id`、`name`、`description`、`steps`
3. 确保所有副作用动作（click/typeText/hotkey）都使用 confirm token
4. 测试 recipe 是否能正常执行
