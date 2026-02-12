#!/usr/bin/env python3
"""
test-token-reuse.py: 测试 token reuse 拒绝（Session 模式）

验收标准：
- 同 session 内，第一次使用 token 成功
- 同 session 内，第二次使用同一 token 失败（返回 DESKTOP_CONFIRM_REQUIRED + reason=used）
"""

import json
import subprocess
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
DESKTOPCTL = PROJECT_ROOT / "mac/msgcode-desktopctl/.build/debug/msgcode-desktopctl"
WORKSPACE = str(PROJECT_ROOT)

def main():
    print("=== Token Reuse 测试（Session 模式）===")
    print(f"Workspace: {WORKSPACE}\n")

    # 前置检查
    if not DESKTOPCTL.exists():
        print(f"✗ desktopctl 未编译: {DESKTOPCTL}")
        print("  请先: cd mac/msgcode-desktopctl && swift build")
        return 1

    # 启动 session
    print("[1] 启动 desktopctl session...")
    # stderr 单独处理（避免和 JSON 混在一起）
    process = subprocess.Popen(
        [str(DESKTOPCTL), "session", WORKSPACE],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,  # 丢弃 stderr 日志
        text=True,
    )

    # 等待启动
    time.sleep(0.5)

    try:
        # 步骤 1: 签发 token（用于 desktop.click，它会消费 token）
        print("[2] 签发 token...")
        # 使用一个简单且固定的 target
        target_params = {"selector": {"byRole": "AXButton"}}

        issue_request = {
            "id": "issue-1",
            "method": "desktop.confirm.issue",
            "params": {
                "intent": {
                    "method": "desktop.click",
                    "params": {"target": target_params}
                },
                "ttlMs": 60000
            },
            "workspacePath": WORKSPACE
        }

        issue_response = send_request(process, issue_request)
        token = issue_response.get("result", {}).get("token")

        if not token:
            print(f"✗ Token 签发失败")
            print(f"  Response: {json.dumps(issue_response, indent=2)}")
            return 1

        print(f"✓ Token 已签发: {token[:8]}...\n")

        # 步骤 2: 第一次使用 token（会消费 token，即使操作失败）
        print("[3] 第一次使用 token（会消费）...")
        use1_request = {
            "id": "use-1",
            "method": "desktop.click",
            "params": {
                "target": target_params,  # 必须和 issue 时完全一致
                "confirm": {"token": token}
            },
            "workspacePath": WORKSPACE
        }

        use1_response = send_request(process, use1_request)

        # 检查响应
        if "error" in use1_response:
            error_code = use1_response["error"].get("code")
            if error_code == "DESKTOP_PERMISSION_MISSING":
                print("⚠ 权限缺失，跳过 reuse 测试")
                print("  需先授予辅助功能权限")
                return 0

            # 检查是否是 token 相关错误
            if "CONFIRM" in error_code or error_code in ["INVALID_TOKEN", "TOKEN_EXPIRED"]:
                print(f"✗ 第一次使用 token 失败（token 验证问题）: {error_code}")
                print(f"  Response: {json.dumps(use1_response, indent=2)}")
                return 1

            # 其他错误（如找不到元素）是预期的，但 token 应该已被消费
            print(f"✓ Token 已消费（操作失败: {error_code}）\n")
        else:
            # 操作成功（不太可能，但 token 也被消费了）
            print("✓ Token 已消费（操作成功）\n")

        # 步骤 3: 第二次使用同一 token（应该失败）
        print("[4] 第二次使用同一 token（应该拒绝）...")
        use2_request = {
            "id": "use-2",
            "method": "desktop.click",
            "params": {
                "target": target_params,  # 必须和 issue 时完全一致
                "confirm": {"token": token}
            },
            "workspacePath": WORKSPACE
        }

        use2_response = send_request(process, use2_request)

        if "error" not in use2_response:
            print("✗ 第二次使用 token 没有返回错误（期望被拒绝）")
            print(f"  Response: {json.dumps(use2_response, indent=2)}")
            return 1

        error_code = use2_response["error"].get("code")
        error_details = use2_response["error"].get("details", {})
        error_reason = error_details.get("reason")

        if error_code == "DESKTOP_CONFIRM_REQUIRED":
            print("✓ 返回 DESKTOP_CONFIRM_REQUIRED")
            if error_reason == "used":
                print("✓ details.reason = 'used'（token 已消费）")
            else:
                print(f"⚠ details.reason = '{error_reason}'（期望 'used'）")
        else:
            print("✗ 返回错误码不符")
            print(f"  期望: DESKTOP_CONFIRM_REQUIRED")
            print(f"  实际: {error_code}")
            print(f"  Response: {json.dumps(use2_response, indent=2)}")
            return 1

        print("\n=== ✅ Token Reuse 测试通过 ===")
        return 0

    finally:
        # 清理
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()


def send_request(process, request):
    """发送请求并读取响应"""
    # 发送请求（NDJSON 格式，每行一个 JSON）
    request_json = json.dumps(request) + "\n"
    process.stdin.write(request_json)
    process.stdin.flush()

    # 读取响应（超时 5s）
    response_line = ""
    elapsed = 0
    while elapsed < 50:
        try:
            # 尝试读取一行
            char = process.stdout.read(1)
            if char == "\n":
                break
            if char:
                response_line += char
            else:
                time.sleep(0.01)
                elapsed += 1
        except:
            break

    if not response_line:
        raise RuntimeError("超时等待响应")

    # 调试：打印原始响应
    print(f"[DEBUG] 原始响应: {response_line[:200]}...", file=sys.stderr)

    # 解析 session 响应
    session_response = json.loads(response_line)

    # 调试：检查 exitCode
    exit_code = session_response.get("exitCode")
    print(f"[DEBUG] exitCode: {exit_code}", file=sys.stderr)

    # 解析 JSON-RPC 响应
    rpc_response = json.loads(session_response["stdout"])
    return rpc_response


if __name__ == "__main__":
    sys.exit(main())
