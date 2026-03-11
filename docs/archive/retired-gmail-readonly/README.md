# retired-gmail-readonly

归档时间：2026-03-11

## 原因

`gmail-readonly` 测试与验收任务不再代表当前真实需求，继续保留在主回归与活跃任务索引中只会制造假阻断。

## 本次归档范围

- 验收任务单：
  - `docs/archive/retired-gmail-readonly/p5-7-r7b-gmail-readonly-acceptance.md`
- 已退出主回归的测试：
  - `test/p5-7-r7b-gmail-contract.test.ts`
  - `test/p5-7-r7b-gmail-readonly.test.ts`

## 保留边界

- 仅退场测试与任务单
- `src/browser/gmail-readonly.ts` 与 `src/cli/browser.ts` 运行时代码暂时保留
- 若未来确认彻底退役 Gmail 运行时，再单独开 issue 处理
