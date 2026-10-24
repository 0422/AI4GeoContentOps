<!-- 2026-10-24：本次修改原因：将入库的原始文章与可复算的分析准备文本明确拆成两个独立阶段。 -->
# Prepared Article 清洗链路

## 用途与判断依据

Raw Article 回答“接口实际给了什么”；Prepared Article 回答“当前哪些文字和结构可以用于后续风格分析”。清洗成功只表示输入可追溯且完成确定性处理，不表示正文事实准确、版权已自动核实或文章已提取风格特征。需要与人工核对结果和业务规格比较，项目目前没有能自动判定这些事项的模型。

## 输入、输出与运行时机

清洗任务只从数据库读取：已关联的 `article_sources.raw_content/raw_response_item`、文章当前确认的 `content_samples.body_text/title`、编辑修订信息、使用权限和现有来源指标。不得直接接收正在返回的 RedFox HTTP 响应。正式入库后或正文修订后触发；失败可按来源 ID 与版本重试。

输出 `prepared_articles` 的新版本，包含：`sample_id`、`source_id`、`input_origin`（采集原文或人工确认正文）、`source_content_hash`、`editor_body_hash`、`cleaner_version`、`clean_title`、`clean_text`、`blocks_json`、`keywords_json`、`quality_flags_json`、`content_status`、`status`、开始/完成时间和错误摘要。旧成功版本保留；同样输入哈希 + 清洗版本可直接复用。

## 确定性处理

| 阶段 | 输入 | 输出 | 失败或不确定时 |
|---|---|---|---|
| 格式识别 | 来源声明、原始正文前缀 | HTML / Markdown / plain / unknown | 标记 unknown，不猜测结构 |
| HTML 解析 | 原始 HTML | 标题、段落、引用、列表、图片位置及说明；纯文本 | 删除 script/style/明显导航；无法确定的块标 unknown |
| Markdown 解析 | 原始 Markdown | heading/paragraph/quote/list/image 等块 | 语法不完整时留 warning 和原文 |
| 纯文本整理 | 人工或接口纯文本 | 换行与空白标准化的段落块 | 不合并所有换行，不伪造标题层级 |
| 完整性检查 | 标题、正文、抓取截断标记、blocks | complete/partial/missing/unknown 和质量标记 | 字数单独不足以证明完整 |
| 关键词候选 | 清洗文本 | 有来源和版本的候选词列表 | 规则无法可靠得出时为空 |

HTML 实体先解码；Unicode 和换行符统一；连续空白适度压缩，但保留原始段落分隔、引用与强调的可见位置。图片若缺少可用文字，记录位置与空说明，不编造图片内容。长度超过现有 30000 字 UI 限制时，Raw 仍完整保存；无法在当前表单完整展示时标记 `partial` 并阻止误称“全文已核对”。

## 状态与失效规则

`pending → processing → completed`；异常进入 `failed`，内容疑似截断或无法确认结构时进入 `needs_review`。新的正文或清洗版本使旧成功结果显示 `stale`，但不删除历史结果。状态由输入哈希和版本判定，不靠手工改标签。

质量标记至少覆盖：标题缺失、正文缺失、短正文、摘要疑似充当正文、抓取截断、异常编码、明显重复段落、无可识别段落、疑似广告或导航。只有能确定的规则写确定标记；其余使用 `unknown` 或“待人工复核”。

## 后续特征接口

后续 Article Features 读取 `PreparedArticle` 的 `clean_title/clean_text/blocks`、`cleaner_version`、`source_content_hash`，再附加 `analyzer_version/model_id/prompt_version`。现有 `extract_features` 的段落和句长规则可逐步迁移，但本次不把完整 AI/NLP 风格分析塞进采集或清洗事务。画像和生成仍需人工审核的策略作为中介。

## 可复核验收

同一源数据和清洗版本重复运行应得到相同 blocks 与纯文本；改正文后应出现新版本且旧版本仍可读；HTML、Markdown、纯文本、图片、引用、空内容、截断、异常编码、重复段落分别用脱敏 Fixture 检查。校验同时确认 Raw 项 JSON、原始正文和已保存读数在清洗前后完全不变。
