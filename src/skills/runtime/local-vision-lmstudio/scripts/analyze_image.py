"""
调用 LM Studio 本地视觉语言模型分析图片（GLM-4.6V / LLaVA 等）

目标：让“默认就能跑”
- 自动选择“已加载 + vision=true”的模型（/api/v1/models）
- 请求体过大时可自动缩放/转码（可禁用）
- 兼容 LM Studio 返回的 reasoning_content / begin_of_box 等包装

仅依赖标准库；如系统有 macOS `sips` 则用于图片缩放（非必需）。
"""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import zlib
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional

# ------------------------------
# 配置（可用环境变量覆盖）
# ------------------------------
# LM Studio API Server 地址（可传 http://localhost:1234 或 http://localhost:1234/v1）
DEFAULT_SERVER = os.getenv("LMSTUDIO_SERVER") or os.getenv("LMSTUDIO_API_BASE") or "http://localhost:1234"
# 优先使用：--model / LMSTUDIO_MODEL；否则自动从 /api/v1/models 选择“已加载 + vision=true”的模型
DEFAULT_MODEL = os.getenv("LMSTUDIO_MODEL") or ""
# 图片预处理：请求体过大时先转码/缩放（0 表示禁用）
MAX_IMAGE_BYTES = int(os.getenv("LMSTUDIO_MAX_IMAGE_BYTES", str(3 * 1024 * 1024)))
MAX_IMAGE_SIDE = int(os.getenv("LMSTUDIO_MAX_IMAGE_SIDE", "1280"))
ALWAYS_PREPROCESS = os.getenv("LMSTUDIO_ALWAYS_PREPROCESS", "0").strip() in ("1", "true", "yes", "on")
# 400/通道断开 崩溃时自动重试（0 表示禁用）
DEFAULT_RETRIES = int(os.getenv("LMSTUDIO_RETRIES", "2"))
DEFAULT_RETRY_SLEEP_SEC = float(os.getenv("LMSTUDIO_RETRY_SLEEP_SEC", "2.0"))

# 输出太长时自动写文件（工具输出可能被截断）
DEFAULT_AUTOSAVE_MIN_CHARS = int(os.getenv("LMSTUDIO_AUTOSAVE_MIN_CHARS", "800"))
DEFAULT_SPLIT_MAX_TOKENS = int(os.getenv("LMSTUDIO_SPLIT_MAX_TOKENS", "256"))


def _normalize_server(server: str) -> str:
    base = (server or "").strip().rstrip("/")
    for suffix in ("/v1", "/api/v1"):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
    return base or "http://localhost:1234"


def _http_json(url: str, payload: Optional[dict[str, Any]] = None, timeout: int = 20) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"} if data else {},
        method="POST" if data else "GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _list_models(server: str) -> list[dict[str, Any]]:
    """
    优先走 LM Studio 元数据接口 /api/v1/models（能判断 vision / loaded）。
    回退：OpenAI 兼容 /v1/models（信息少）。
    """
    root = _normalize_server(server)

    try:
        data = _http_json(f"{root}/api/v1/models", timeout=10)
        models = data.get("models") or []
        if isinstance(models, list):
            return models
    except Exception:
        pass

    try:
        data = _http_json(f"{root}/v1/models", timeout=10)
        models = data.get("data") or []
        if isinstance(models, list):
            return [{"key": m.get("id"), "type": "llm"} for m in models if isinstance(m, dict)]
    except Exception:
        pass

    return []


def _pick_default_model(models: list[dict[str, Any]]) -> str:
    def key_of(model: dict[str, Any]) -> str:
        return str(model.get("key") or model.get("id") or "")

    def is_loaded(model: dict[str, Any]) -> bool:
        loaded = model.get("loaded_instances")
        return isinstance(loaded, list) and len(loaded) > 0

    def is_vision(model: dict[str, Any]) -> bool:
        caps = model.get("capabilities") or {}
        if isinstance(caps, dict) and caps.get("vision") is True:
            return True
        return "4.6v" in key_of(model).lower()

    def is_embedding(model: dict[str, Any]) -> bool:
        model_type = str(model.get("type") or "").lower()
        key = key_of(model).lower()
        return model_type == "embedding" or "embedding" in key

    candidates = [model for model in models if key_of(model) and not is_embedding(model)]
    if not candidates:
        return ""

    for predicate in (lambda model: is_loaded(model) and is_vision(model), is_loaded, is_vision, lambda _: True):
        for model in candidates:
            if predicate(model):
                return key_of(model)
    return ""


def _guess_mime(image_path: str) -> str:
    ext = Path(image_path).suffix.lower()
    if ext in (".jpg", ".jpeg"):
        return "image/jpeg"
    if ext == ".png":
        return "image/png"
    if ext == ".webp":
        return "image/webp"
    return "image/png"


def _maybe_preprocess(image_path: str) -> tuple[str, str]:
    """
    预处理策略：当图片过大 / 分辨率过大 / 格式异常时，用系统自带 sips 缩放并转 jpeg，降低崩溃率。
    无 sips / 失败则原样返回。
    """
    mime = _guess_mime(image_path)
    if MAX_IMAGE_BYTES <= 0 and MAX_IMAGE_SIDE <= 0 and not ALWAYS_PREPROCESS:
        return image_path, mime

    try:
        size = Path(image_path).stat().st_size
    except Exception:
        return image_path, mime

    sips = shutil.which("sips")
    if not sips:
        if MAX_IMAGE_BYTES > 0 and size <= MAX_IMAGE_BYTES:
            return image_path, mime
        return image_path, mime

    width, height, fmt = _sips_probe(image_path)
    max_side = max(width or 0, height or 0)
    need_scale = bool(MAX_IMAGE_SIDE > 0 and max_side and max_side > MAX_IMAGE_SIDE)
    need_shrink = bool(MAX_IMAGE_BYTES > 0 and size > MAX_IMAGE_BYTES)
    need_sanitize = ALWAYS_PREPROCESS or (fmt is not None and fmt not in ("jpeg", "png"))

    if not (need_scale or need_shrink or need_sanitize):
        return image_path, mime

    try:
        tmp_dir = Path(tempfile.mkdtemp(prefix="lmstudio_img_"))
        out_path = tmp_dir / (Path(image_path).stem + f"_scaled_{MAX_IMAGE_SIDE}.jpg")
        cmd = [
            sips,
            "-Z",
            str(MAX_IMAGE_SIDE),
            "-s",
            "format",
            "jpeg",
            "-s",
            "formatOptions",
            "80",
            image_path,
            "--out",
            str(out_path),
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if out_path.exists():
            return str(out_path), "image/jpeg"
    except Exception:
        return image_path, mime

    return image_path, mime


def _image_to_base64(image_path: str) -> str:
    with open(image_path, "rb") as file_obj:
        return base64.b64encode(file_obj.read()).decode("utf-8")


def _write_solid_png(path: str, width: int, height: int) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack("!I", len(data)) + tag + data + struct.pack("!I", binascii.crc32(body) & 0xFFFFFFFF)

    rgba = b"\xff\xff\xff\xff"
    raw = bytearray()
    for _ in range(height):
        raw.append(0)
        raw.extend(rgba * width)

    ihdr = struct.pack("!IIBBBBB", width, height, 8, 6, 0, 0, 0)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 6)) + chunk(b"IEND", b"")
    Path(path).write_bytes(data)


def _sips_probe(image_path: str) -> tuple[Optional[int], Optional[int], Optional[str]]:
    """
    使用 macOS sips 读取图片宽高与格式；失败则返回 (None, None, None)。
    """
    sips = shutil.which("sips")
    if not sips:
        return None, None, None
    try:
        probe = subprocess.run(
            [sips, "-g", "pixelWidth", "-g", "pixelHeight", "-g", "format", image_path],
            check=True,
            capture_output=True,
            text=True,
        )
        width = height = None
        fmt = None
        for line in probe.stdout.splitlines():
            line = line.strip()
            if line.startswith("pixelWidth:"):
                try:
                    width = int(line.split(":", 1)[1].strip())
                except Exception:
                    width = None
            elif line.startswith("pixelHeight:"):
                try:
                    height = int(line.split(":", 1)[1].strip())
                except Exception:
                    height = None
            elif line.startswith("format:"):
                fmt = line.split(":", 1)[1].strip().lower() or None
        return width, height, fmt
    except Exception:
        return None, None, None


def _clean_model_text(text: str) -> str:
    cleaned = text or ""
    cleaned = cleaned.replace("<|begin_of_box|>", "").replace("<|end_of_box|>", "")
    cleaned = re.sub(r"<\|[^|>]+?\|>", "", cleaned)
    return cleaned.strip()


def _is_identity_question(prompt: str) -> bool:
    content = (prompt or "").strip()
    if not content:
        return False
    return bool(
        re.search(
            r"(哪个漫画|哪部漫画|哪个动漫|哪部动漫|哪部作品|出自|来自|原作|作品名|角色是谁|这是谁|是谁|叫什么|人物是谁)",
            content,
        )
    )


def _looks_loopy(text: str) -> bool:
    """
    识别常见“自我否定 + 重复”循环（例如不停出现“不过…不对…”）。
    """
    content = (text or "").strip()
    if not content:
        return False
    if content.count("不对") >= 2:
        return True
    if content.count("不过") >= 6:
        return True
    if len(content) > 400 and re.search(r"(不过.{0,20}不对){2,}", content):
        return True
    chunks = re.findall(r"(.{12,40})", content)
    if chunks:
        seen: dict[str, int] = {}
        for chunk in chunks:
            seen[chunk] = seen.get(chunk, 0) + 1
        if max(seen.values()) >= 4:
            return True
    return False


def _extract_numbered_items(prompt: str) -> list[tuple[int, str]]:
    """
    从提示词里提取形如：
    1. xxx
    2、yyy
    3) zzz
    的条目，便于自动分段请求，降低模型崩溃概率。
    """
    text = prompt or ""
    items: list[tuple[int, str]] = []

    for match in re.finditer(r"(?:^|\n)\s*(\d{1,2})\s*[\.、\)]\s*([^\n]+)", text):
        try:
            index = int(match.group(1))
        except Exception:
            continue
        title = match.group(2).strip()
        if title:
            items.append((index, title))

    if items:
        return items

    matches = list(re.finditer(r"(\d{1,2})\s*[\.、\)]\s*", text))
    if len(matches) < 2:
        return []

    for idx, match in enumerate(matches):
        try:
            index = int(match.group(1))
        except Exception:
            continue
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        seg = text[start:end].strip()
        if not seg:
            continue
        seg = re.sub(r"(每点|要求|注意).*$", "", seg).strip()
        if seg:
            items.append((index, seg))

    return items


def _should_split(prompt: str, max_tokens: int, split: bool) -> bool:
    if not split:
        return False
    content = prompt or ""
    if max_tokens <= DEFAULT_SPLIT_MAX_TOKENS:
        return False
    if len(content) >= 200:
        return True
    if re.search(r"(十个|10个|十项|10项|10 个|10 项|十点|10点)", content):
        return True
    if len(re.findall(r"\d{1,2}\s*[\.、\)]", content)) >= 6:
        return True
    if len(_extract_numbered_items(content)) >= 6:
        return True
    return False


def _chunk_items(items: list[tuple[int, str]], chunk_size: int) -> list[list[tuple[int, str]]]:
    return [items[idx : idx + chunk_size] for idx in range(0, len(items), chunk_size)]


def _build_messages(prompt: str, base64_image: str, mime: str, system_prompt: Optional[str]) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append(
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64_image}"}},
            ],
        }
    )
    return messages


def _extract_answer(result: dict[str, Any]) -> str:
    choices = result.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0] if isinstance(choices[0], dict) else {}
        msg = first.get("message") if isinstance(first, dict) else {}
        if isinstance(msg, dict):
            content = msg.get("content")
            if isinstance(content, str) and content.strip():
                return _clean_model_text(content)
            reasoning = msg.get("reasoning_content")
            if isinstance(reasoning, str) and reasoning.strip():
                return _clean_model_text(reasoning)

    content = result.get("content")
    if isinstance(content, str) and content.strip():
        return _clean_model_text(content)

    return _clean_model_text(json.dumps(result, ensure_ascii=False))


def _get_finish_reason(result: dict[str, Any]) -> Optional[str]:
    choices = result.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0] if isinstance(choices[0], dict) else {}
        if isinstance(first, dict):
            finish_reason = first.get("finish_reason")
            return finish_reason if isinstance(finish_reason, str) else None
    return None


def _looks_like_model_crash(error_body: str) -> bool:
    content = (error_body or "").lower()
    if not content.strip():
        return True
    return (
        "model has crashed" in content
        or "the model has crashed" in content
        or "channel error" in content
        or "segmentation fault" in content
    )


class LmstudioHttpError(Exception):
    def __init__(self, code: int, body: str):
        super().__init__(f"HTTP {code}")
        self.code = code
        self.body = body


def _load_model(server_root: str, model: str) -> None:
    """
    主动触发 LM Studio 重新加载模型：POST /api/v1/models/load
    这能在“Segmentation fault / Channel Error”后把模型拉起来。
    """
    root = _normalize_server(server_root)
    _http_json(f"{root}/api/v1/models/load", payload={"model": model}, timeout=60)


def _post_openai_chat(
    openai_v1: str,
    server_root: str,
    model: str,
    messages: list[dict[str, Any]],
    max_tokens: int,
    temperature: float,
    retries: int,
) -> dict[str, Any]:
    url = f"{openai_v1}/chat/completions"
    payload = json.dumps(
        {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature},
        ensure_ascii=False,
    ).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    last_http_error: Optional[str] = None
    for attempt in range(max(1, retries + 1)):
        try:
            with urllib.request.urlopen(req, timeout=180) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            last_http_error = error.read().decode("utf-8", "replace") if error.fp else ""
            if error.code == 400 and _looks_like_model_crash(last_http_error) and attempt < retries:
                try:
                    _load_model(server_root, model)
                except Exception:
                    pass
                time.sleep(DEFAULT_RETRY_SLEEP_SEC)
                continue
            raise LmstudioHttpError(error.code, last_http_error)
        except urllib.error.URLError as error:
            if attempt < retries:
                try:
                    _load_model(server_root, model)
                except Exception:
                    pass
                time.sleep(DEFAULT_RETRY_SLEEP_SEC)
                continue
            raise RuntimeError(f"URLError after retries: {error}") from error

    raise RuntimeError(f"HTTPError after retries: {last_http_error or '(no body)'}")


def analyze_image(
    image_path: str,
    prompt: str = "描述这张图片",
    *,
    max_tokens: int = 512,
    temperature: float = 0.7,
    retries: int = DEFAULT_RETRIES,
    split: bool = True,
) -> str:
    server = _normalize_server(DEFAULT_SERVER)
    openai_v1 = f"{server}/v1"

    models = _list_models(server)
    model = DEFAULT_MODEL.strip() or _pick_default_model(models)
    if not model:
        return (
            "Error: 未找到可用模型。\n"
            "请确认：LM Studio 已加载视觉模型 + 已开启 API Server。\n"
            f"当前 server={server}\n"
            "可用模型列表：python3 scripts/analyze_image.py --print-models\n"
        )

    processed_path, mime = _maybe_preprocess(image_path)
    base64_image = _image_to_base64(processed_path)

    system_prompt = "用中文回答；只输出结论，不要输出推理过程；按要求分点，短句；不要截断句子。"
    effective_max_tokens = max_tokens
    effective_temperature = temperature
    effective_prompt = prompt
    if _is_identity_question(prompt):
        system_prompt += " 若无法确定，直接说“无法确定”；禁止使用“不过/不对/可能更准确”等自我打断式重复。"
        effective_prompt = (
            f"{prompt}\n\n"
            "请按以下格式输出（最多 3 行）：\n"
            "候选作品名 - 置信度(0-100) - 一句依据\n"
            "如果无法判断，请只输出：无法确定"
        )
        effective_max_tokens = min(effective_max_tokens, 256)
        effective_temperature = min(effective_temperature, 0.25)

    if _should_split(effective_prompt, effective_max_tokens, split=split):
        items = _extract_numbered_items(effective_prompt)
        if items:
            chunks = _chunk_items(items, chunk_size=4)
            parts: list[str] = []
            for chunk in chunks:
                points = "\n".join([f"{idx}. {title}" for idx, title in chunk])
                parts.append(f"请按以下要点分析图片（每点 1-2 句；不要省略编号；句子不要截断）：\n{points}")
        else:
            parts = [
                "按以下要点分析图片（每点 1-2 句）：1.画风/风格 2.线条 3.配色 4.光影",
                "按以下要点分析图片（每点 1-2 句）：5.材质(皮肤/皮革/金属/玻璃) 6.背景 7.氛围 8.构图",
                "按以下要点分析图片：9.特效元素（1-2 句） 10.给一条可复现的提示词（单行，尽量 60-120 字，必须完整不截断）",
            ]

        outputs: list[str] = []
        for idx, part in enumerate(parts, start=1):
            is_prompt_part = bool(re.search(r"(提示词|复现|prompt)", part))
            split_tokens = min(effective_max_tokens, 384 if is_prompt_part else DEFAULT_SPLIT_MAX_TOKENS)
            messages = _build_messages(part, base64_image, mime, system_prompt)
            try:
                result = _post_openai_chat(
                    openai_v1=openai_v1,
                    server_root=server,
                    model=model,
                    messages=messages,
                    max_tokens=split_tokens,
                    temperature=effective_temperature,
                    retries=retries,
                )
                text = _extract_answer(result)
                if _get_finish_reason(result) == "length":
                    cont_messages = list(messages)
                    cont_messages.append({"role": "assistant", "content": text})
                    cont_messages.append({"role": "user", "content": "继续：只补全上一段的未完句/未输出内容，不要重复前文。"})
                    try:
                        continuation = _post_openai_chat(
                            openai_v1=openai_v1,
                            server_root=server,
                            model=model,
                            messages=cont_messages,
                            max_tokens=min(192, split_tokens),
                            temperature=temperature,
                            retries=retries,
                        )
                        text2 = _extract_answer(continuation)
                        if text2:
                            text = (text + "\n" + text2).strip()
                    except Exception:
                        pass

                outputs.append(f"【段 {idx}/{len(parts)}】\n{text}")
            except LmstudioHttpError as error:
                return f"Error: {error.code}\n{error.body}\n\n(分段请求失败于第 {idx} 段)"

        return "\n\n".join(outputs)

    messages = _build_messages(effective_prompt, base64_image, mime, system_prompt)

    try:
        result = _post_openai_chat(
            openai_v1=openai_v1,
            server_root=server,
            model=model,
            messages=messages,
            max_tokens=effective_max_tokens,
            temperature=effective_temperature,
            retries=retries,
        )
        text = _extract_answer(result)
        if _is_identity_question(prompt) and _looks_loopy(text):
            strict_prompt = (
                "请停止任何自我否定/循环。"
                "如果无法确定，请直接输出“无法确定”。"
                "然后输出 1-3 个候选作品，每行格式：候选作品名 - 置信度(0-100) - 一句依据。"
            )
            strict_messages = _build_messages(strict_prompt, base64_image, mime, system_prompt)
            try:
                strict = _post_openai_chat(
                    openai_v1=openai_v1,
                    server_root=server,
                    model=model,
                    messages=strict_messages,
                    max_tokens=192,
                    temperature=min(effective_temperature, 0.2),
                    retries=retries,
                )
                strict_text = _extract_answer(strict)
                if strict_text:
                    return strict_text
            except Exception:
                pass
        return text
    except LmstudioHttpError as error:
        error_body = error.body
        hint = ""
        if error.code in (400, 404, 413):
            hint = (
                "\n\n排查建议：\n"
                f"- 确认 model={model}（用 --print-models 看可用模型）\n"
                "- 图片太小会报 width/height must be larger\n"
                "- 图片太大可调小 LMSTUDIO_MAX_IMAGE_BYTES / LMSTUDIO_MAX_IMAGE_SIDE\n"
                "- 若报 model has crashed / Channel Error / Segmentation fault，可直接重试（脚本已默认自动重试并尝试 reload 模型）\n"
            )
        return f"Error: {error.code}\n{error_body}{hint}"
    except Exception as error:
        return f"Error: {type(error).__name__}: {error}"


def _autosave_output(text: str, out_path: Optional[str]) -> Optional[str]:
    """
    工具模式会截断 stdout；输出较长时把完整内容落盘，避免“看不全”。
    返回写入的文件路径（或 None）。
    """
    if out_path:
        path = Path(out_path).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return str(path)

    if len(text) < DEFAULT_AUTOSAVE_MIN_CHARS:
        return None

    path = Path(tempfile.mkdtemp(prefix="lmstudio_out_")) / "analysis.txt"
    path.write_text(text, encoding="utf-8")
    return str(path)


def _main() -> int:
    global DEFAULT_SERVER, DEFAULT_MODEL

    parser = argparse.ArgumentParser(description="调用 LM Studio 本地视觉模型分析图片（OpenAI 兼容 /v1/chat/completions）")
    parser.add_argument("image", nargs="?", help="图片路径")
    parser.add_argument("prompt", nargs="?", default="描述这张图片", help="提示词")
    parser.add_argument("--server", help="LM Studio server，如 http://localhost:1234 或 http://localhost:1234/v1")
    parser.add_argument("--model", help="指定模型 key/id（覆盖自动选择）")
    parser.add_argument("--print-models", action="store_true", help="打印可用模型并退出")
    parser.add_argument("--doctor", action="store_true", help="一键自检：连通性/选模/最小请求")
    parser.add_argument("--max-tokens", type=int, default=512, help="单次生成 token 上限（默认 512）")
    parser.add_argument("--temperature", type=float, default=0.7, help="采样温度（默认 0.7）")
    parser.add_argument("--retries", type=int, default=DEFAULT_RETRIES, help=f"模型崩溃时自动重试次数（默认 {DEFAULT_RETRIES}）")
    parser.add_argument("--out", help="把完整输出写入文件（避免工具截断 stdout）")
    parser.add_argument("--no-split", action="store_true", help="禁用长提示词的自动分段（不推荐）")
    args = parser.parse_args()

    if args.server:
        DEFAULT_SERVER = args.server
    if args.model:
        DEFAULT_MODEL = args.model

    if args.print_models:
        server = _normalize_server(DEFAULT_SERVER)
        models = _list_models(server)
        if not models:
            print(f"未读取到模型列表：server={server}")
            return 2
        picked = _pick_default_model(models)
        for model in models:
            key = str(model.get("key") or model.get("id") or "")
            if not key:
                continue
            caps = model.get("capabilities") or {}
            vision = bool(isinstance(caps, dict) and caps.get("vision") is True)
            loaded = isinstance(model.get("loaded_instances"), list) and len(model.get("loaded_instances")) > 0
            tag = "*" if key == picked else " "
            print(f"{tag} {key}  vision={vision}  loaded={loaded}")
        return 0

    if args.doctor:
        server = _normalize_server(DEFAULT_SERVER)
        models = _list_models(server)
        picked = (DEFAULT_MODEL.strip() or _pick_default_model(models)) if models else ""
        print(f"server={server}")
        print(f"picked_model={picked or '(none)'}")
        if not models:
            print("Error: 未读取到模型列表（请确认 LM Studio API Server 已开启，端口默认 1234）")
            return 2
        if not picked:
            print("Error: 未选到可用模型（请先在 GUI 里加载一个 vision 模型）")
            return 2

        if not DEFAULT_MODEL.strip():
            DEFAULT_MODEL = picked

        test_path = Path(tempfile.mkdtemp(prefix="lmstudio_doctor_")) / "doctor_64.png"
        _write_solid_png(str(test_path), 64, 64)
        print(f"test_image={test_path}")
        out = analyze_image(
            str(test_path),
            "用一句话描述这张图片",
            max_tokens=min(args.max_tokens, 256),
            temperature=args.temperature,
            retries=args.retries,
        )
        print("----- model_output -----")
        print(out)
        return 0 if not out.startswith("Error:") else 3

    if not args.image:
        print("用法: python3 scripts/analyze_image.py <图片路径> [提示词]")
        print("示例: python3 scripts/analyze_image.py /path/to/image.png '描述这张图片'")
        print("更多: python3 scripts/analyze_image.py --print-models")
        return 1

    image_path = args.image
    if not Path(image_path).exists():
        print(f"错误: 图片不存在: {image_path}")
        return 1

    print(f"正在分析: {image_path}")
    print("-" * 50)
    text = analyze_image(
        image_path,
        args.prompt,
        max_tokens=args.max_tokens,
        temperature=args.temperature,
        retries=args.retries,
        split=not args.no_split,
    )
    saved = _autosave_output(text, args.out)
    if saved:
        if len(text) <= 1200:
            preview = text
        else:
            head = text[:600].rstrip()
            tail = text[-600:].lstrip()
            preview = head + "\n…(中间省略，完整见文件)…\n" + tail
        print(preview)
        print(f"\n[full_output_saved_to] {saved}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
