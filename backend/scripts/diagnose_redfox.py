# 2026-10-23：本次修改原因：在用户本机用官方文档格式核对单篇公众号全文接口，只显示状态和字段，不输出密钥或文章正文。
import argparse
import os
from pathlib import Path
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv


def main() -> None:
    parser = argparse.ArgumentParser(description="核对 RedFox 公众号文章详情的业务码与正文可用性")
    parser.add_argument("url", help="完整的 https://mp.weixin.qq.com 文章链接")
    args = parser.parse_args()
    parsed = urlparse(args.url)
    if parsed.scheme != "https" or parsed.hostname != "mp.weixin.qq.com":
        parser.error("仅接受 https://mp.weixin.qq.com 的文章链接")

    load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False, encoding="utf-8")
    key = os.getenv("REDFOX_API_KEY", "").strip()
    if not key:
        parser.error("backend/.env 中缺少 REDFOX_API_KEY")

    try:
        response = httpx.post(
            "https://redfox.hk/story/api/gzhData/queryArticleDetail",
            headers={"REDFOX_API_KEY": key, "Content-Type": "application/json"},
            json={"url": args.url, "source": "AI4GeoContentOps-diagnostic"},
            timeout=30.0,
        )
        payload = response.json()
    except (httpx.RequestError, ValueError) as error:
        print(f"请求或解析失败：{type(error).__name__}")
        return
    if not isinstance(payload, dict):
        print(f"HTTP {response.status_code}；响应不是 JSON 对象")
        return
    message = " ".join(str(payload.get("msg") or payload.get("message") or "未提供").replace(key, "[已隐藏]").split())[:160]
    data = payload.get("data")
    print(f"HTTP {response.status_code}；业务码 {payload.get('code')}；消息 {message}")
    if isinstance(data, dict):
        print("data 字段：" + ", ".join(sorted(data.keys())))
        # 2026-10-23：本次修改原因：详情可能嵌套在 article/work/detail 中，诊断只报字段长度。
        candidates = [("data", data)] + [
            (f"data.{name}", data[name]) for name in ("article", "work", "detail")
            if isinstance(data.get(name), dict)
        ]
        for prefix, item in candidates:
            if prefix != "data":
                print(f"{prefix} 字段：" + ", ".join(sorted(item.keys())))
            for field in ("content", "articleContent", "contentHtml", "html", "body", "text", "bodyText"):
                value = item.get(field)
                if isinstance(value, str):
                    print(f"{prefix}.{field} 字符数：{len(value)}")


if __name__ == "__main__":
    main()
