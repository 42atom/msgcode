/**
 * msgcode: 直接入口薄壳
 *
 * 规则：
 * - 不再维护第二套 imsg-only 运行时
 * - 任何直接运行 src/index.ts 的场景，都统一落到当前 startBot() 主链
 */

import { startBot } from "./commands.js";

void startBot().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
