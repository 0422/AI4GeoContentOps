# 2026-10-23：本次修改原因：使用 Playwright 加载公众号原文页面，等待正文渲染后提取可核对的文本。
import os
import re
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv


# 2026-10-23：本次修改原因：本机可选择 Chromium 或已安装的 Edge，并可切换可见浏览器排查加载问题。
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False, encoding="utf-8")


class WechatBrowserError(Exception):
    pass


def fetch_wechat_article_browser(url: str) -> dict:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "mp.weixin.qq.com" or parsed.username or parsed.password:
        raise WechatBrowserError("仅支持 https://mp.weixin.qq.com 的公众号文章链接")
    if len(url) > 8192:
        raise WechatBrowserError("公众号文章链接过长")
    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise WechatBrowserError("未安装 Playwright；请在 learner 环境执行 python -m pip install -r requirements.txt") from error

    # 2026-10-23：本次修改原因：每次按需建立隔离页面，不复用用户浏览器资料或在磁盘保存网页 HTML。
    headless = os.getenv("WECHAT_BROWSER_HEADLESS", "true").strip().lower() not in {"false", "0", "no"}
    channel = os.getenv("WECHAT_BROWSER_CHANNEL", "msedge").strip()
    launch_options = {"headless": headless, "timeout": 15000}
    if channel:
        launch_options["channel"] = channel
    try:
        with sync_playwright() as playwright:
            try:
                browser = playwright.chromium.launch(**launch_options)
            except PlaywrightError as error:
                raise WechatBrowserError(
                    "浏览器无法启动；请确认 Edge 已安装，或执行 python -m playwright install chromium "
                    "并在 backend/.env 设置 WECHAT_BROWSER_CHANNEL=chromium"
                ) from error
            try:
                context = browser.new_context(locale="zh-CN")
                page = context.new_page()
                # 2026-10-23：本次修改原因：文章链接只允许在公众号域名内导航，避免跳转到未授权地址。
                def guard_navigation(route):
                    if (route.request.is_navigation_request() and
                            urlparse(route.request.url).hostname != "mp.weixin.qq.com"):
                        route.abort()
                    else:
                        route.continue_()

                page.route("**/*", guard_navigation)
                response = page.goto(url, wait_until="domcontentloaded", timeout=30000)
                if response is None:
                    raise WechatBrowserError("浏览器未收到公众号页面响应")
                if response.status >= 400:
                    raise WechatBrowserError(f"公众号页面返回 HTTP {response.status}，请打开原文核对")
                if urlparse(page.url).hostname != "mp.weixin.qq.com":
                    raise WechatBrowserError("公众号页面跳转到了其他站点，可能需要访问验证")

                # 2026-10-23：本次修改原因：等待 JS 更新正文容器，避免只取到页面初始空壳。
                try:
                    page.wait_for_function(
                        "() => { const node = document.querySelector('#js_content'); "
                        "return node && node.innerText.trim().length >= 200; }",
                        timeout=12000,
                    )
                except PlaywrightTimeoutError:
                    pass
                content = page.locator("#js_content")
                title_node = page.locator("#activity-name")
                title = title_node.first.inner_text(timeout=2000).strip() if title_node.count() else page.title().strip()
                if not content.count():
                    raise WechatBrowserError(
                        f"浏览器已加载页面，但未出现文章正文容器（页面标题：{title[:80] or '未知'}）；"
                        "可能需要验证或该链接不是图文文章"
                    )
                body = re.sub(r"\n{3,}", "\n\n", content.first.inner_text(timeout=3000)).strip()
                if len(body) < 200:
                    raise WechatBrowserError(
                        f"浏览器已加载页面，但正文仅 {len(body)} 字（页面标题：{title[:80] or '未知'}）；"
                        "请核对原文是否要求验证，或是否为视频、图片、短文本文章"
                    )
                return {
                    "source_url": url, "title": title[:300], "body_text": body[:30000],
                    "truncated": len(body) > 30000, "body_available": True,
                    "origin": "playwright_browser",
                }
            finally:
                browser.close()
    except WechatBrowserError:
        raise
    except PlaywrightTimeoutError as error:
        raise WechatBrowserError("浏览器加载公众号页面超时，请稍后重试") from error
    except PlaywrightError as error:
        raise WechatBrowserError("浏览器无法完成页面加载；请检查后端网络或切换可见模式排查") from error
