/**
 * msgcode: P5.7-R3 开放路径策略回归锁
 *
 * 目标：
 * 1. file 域合同不再包含 workspace 越界限制
 * 2. 不再暴露 ACCESS_DENIED/OUT_OF_BOUNDS 作为路径边界错误
 */

import { describe, it, expect } from "bun:test";
import {
  getFileReadContract,
  getFileWriteContract,
  getFileDeleteContract,
  getFileMoveContract,
  getFileCopyContract,
} from "../src/cli/file.js";

describe("P5.7-R3: open path policy", () => {
  it("R3-open-1: file read 合同不应包含 --force 或 ACCESS_DENIED", () => {
    const contract = getFileReadContract();
    expect(contract.options?.optional?.["--force"]).toBeUndefined();
    expect(contract.errorCodes).not.toContain("ACCESS_DENIED");
    expect(contract.constraints?.workspaceBoundary).toBe("none");
  });

  it("R3-open-2: file write 合同不应包含 --force 或 ACCESS_DENIED", () => {
    const contract = getFileWriteContract();
    expect(contract.options?.optional?.["--force"]).toBeUndefined();
    expect(contract.errorCodes).not.toContain("ACCESS_DENIED");
    expect(contract.constraints?.workspaceBoundary).toBe("none");
  });

  it("R3-open-3: file delete/move/copy 合同不应包含 --force 或 ACCESS_DENIED", () => {
    const deleteContract = getFileDeleteContract();
    const moveContract = getFileMoveContract();
    const copyContract = getFileCopyContract();

    expect(deleteContract.options?.optional?.["--force"]).toBeUndefined();
    expect(moveContract.options?.optional?.["--force"]).toBeUndefined();
    expect(copyContract.options?.optional?.["--force"]).toBeUndefined();

    expect(deleteContract.errorCodes).not.toContain("ACCESS_DENIED");
    expect(moveContract.errorCodes).not.toContain("ACCESS_DENIED");
    expect(copyContract.errorCodes).not.toContain("ACCESS_DENIED");
  });
});

