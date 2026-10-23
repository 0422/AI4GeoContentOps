# 2026-10-23：本次修改原因：按公众号原文链接调用 DeepSeek Fetch，替代已下架的 RedFox 详情接口。
import os
from pathlib import Path
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv


# 2026-10-23：本次修改原因：与生成模块共用本机密钥配置，始终由后端保管 API Key。
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False, encoding="utf-8")


class DeepSeekFetchError(Exception):
    pass


def fetch_wechat_article(url: str) -> dict:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "mp.weixin.qq.com" or parsed.username or parsed.password:
        raise DeepSeekFetchError("仅支持 https://mp.weixin.qq.com 的公众号文章链接")
    if len(url) > 8192:
        raise DeepSeekFetchError("文章链接超过 DeepSeek Fetch 的 8192 字符限制")
    key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not key:
        raise DeepSeekFetchError("未配置 DEEPSEEK_API_KEY，请填写 backend/.env 并重启后端")
    try:
        with httpx.Client(timeout=35.0) as client:
            response = client.post(
                "https://api.deepseek.com/v1/tools/fetch",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={"url": url},
            )
    except httpx.TimeoutException as error:
        raise DeepSeekFetchError("DeepSeek Fetch 请求超时，请稍后再试") from error
    except httpx.RequestError as error:
        raise DeepSeekFetchError("DeepSeek Fetch 网络请求失败，请检查后端网络") from error

    # 2026-10-23：本次修改原因：按官方状态码区分配置、余额、站点拦截和限流问题，不把失败统称为网络故障。
    status_messages = {
        400: "文章链接或 Fetch 请求无效",
        401: "DeepSeek API Key 无效，请检查 backend/.env",
        402: "DeepSeek 账号余额不足",
        403: "DeepSeek 安全策略拒绝抓取该链接",
        404: "DeepSeek 未取得可用正文；公众号页面可能限制服务端抓取",
        429: "DeepSeek Fetch 调用过于频繁，请稍后重试",
        504: "DeepSeek 抓取目标页面超时，请稍后重试",
    }
    if response.status_code != 200:
        message = status_messages.get(response.status_code)
        if not message:
            message = "DeepSeek Fetch 服务暂时不可用" if response.status_code >= 500 else "DeepSeek Fetch 请求失败"
        raise DeepSeekFetchError(f"{message}（HTTP {response.status_code}）")
    try:
        data = response.json()
    except ValueError as error:
        raise DeepSeekFetchError("DeepSeek Fetch 返回内容无法解析") from error
    if not isinstance(data, dict):
        raise DeepSeekFetchError("DeepSeek Fetch 返回结构不符合预期")
    body = data.get("content")
    if not isinstance(body, str) or len(body.strip()) < 200:
        raise DeepSeekFetchError("DeepSeek Fetch 未取得足够正文，请打开原文核对后手动填写")
    body = body.strip()
    title = data.get("title")
    return {
        "source_url": url, "title": title[:300] if isinstance(title, str) else "",
        "body_text": body[:30000], "truncated": len(body) > 30000,
        "body_available": True, "origin": "deepseek_fetch",
    }
