<!-- 2026-10-24：本次修改原因：逐字段记录三种公众号来源的已证实映射与尚未核实的接口契约。 -->
# RedFox 公众号接口字段映射

## 证据等级

- **文档**：本次已读取 [关键词接口官方页面](https://redfox.hk/apis/gongzhonghao/PW97QFBS)。其字段表列出 `data.list` 及字段，示例含 `content`，但字段表未列 `content`，且示例中的数组排版不是有效 JSON，须以真实响应复核。
- **本机**：SQLite 有 9 条 10W+、2 条原创榜的 `source_data.response`。它们已被当前白名单过滤，能证明列出的字段曾进入现有保存链路，不能证明上游没有其他字段。
- **代码**：现有 `redfox_service.py` 的请求与解析。指定的 [10W+ 页面](https://redfox.hk/apis/gongzhonghao/ZIGAGYYT) 和 [原创榜页面](https://redfox.hk/apis/gongzhonghao/OFFSPQ0U) 本次无法通过浏览工具打开；其请求方法、必填性和完整返回结构标为待验证。

下表中 K=关键词 `keyword_search`，T=10W+ `ten_w_rank`，O=原创榜 `original_rank`；“现”表示现有存储，“拟”表示待批准的目标字段；“可空”是本项目拟采用的安全契约，不能误读为 RedFox 保证可空。UI 中“候选/详情/编辑”分别指发现结果、样本详情和共享编辑弹窗。AI 用途只说明后续可能消费的标准化字段，本次不调用风格模型。

## 请求与响应包装

| 接口 | 当前 HTTP 请求 | 文档/样本确认 | 响应包装与分页 | 状态 |
|---|---|---|---|---|
| K | `POST /story/api/gzhData/searchArticle`，`REDFOX_API_KEY` 请求头；提交 `keyword`、`offset` | 官方文档列 `keyword` 必填、`offset` 从 0 每页 +20、可选 `sortType`（`_0/_2/_4`）及 `exactMatch`；当前界面未提交后两项 | `code=2000`、`data.list`、`data.total`、`data.hasMore`；前端每页显示 10 条，上游一组 20 条 | 请求字段已文档确认；真实响应待验证 |
| T | `POST /story/api/cozeSkill/getTenWReadingRank`；提交 `type/startDate/endDate` | 当前代码及既有规划文档；官方指定页本次不可读 | 代码接受 `tenWReadingRank/list/articles/records` 或 `data` 数组；本机有 9 条已存结果 | 完整契约待验证 |
| O | `POST /story/api/cozeSkill/getOriginalRank`；提交 `type/startDate/endDate` | 当前代码及既有规划文档；官方指定页本次不可读 | 代码接受 `originalRank/list/articles/records` 或 `data` 数组；本机有 2 条已存结果 | 完整契约待验证 |

两个榜单的 `type` 候选目前写在 `SamplesPage.tsx`，含“总排名”及规划中 20 个分类；后续应移动到一份共享常量，并以真实榜单接口契约再核对。请求日志、来源记录都不得包含 `REDFOX_API_KEY` / `X-API-KEY` 或其他密钥。

## 响应项目字段

| 来源 | 原始字段 | 原始类型 | 标准字段 | 必填 | 可空 | 转换规则 | 存储位置 | UI 展示 | AI 使用目的 | 验证状态 |
|---|---|---|---|---|---|---|---|---|---|---|
| K | `workUuid` | string | `externalId` | 未明 | 是 | 原样保存；与 `photoId` 分命名空间 | 现来源 JSON；拟 `article_sources.external_id/raw_item` | 来源汇总 | 追溯/去重 | 文档 |
| T/O | `photoId` | 本机 string | `externalId` | 未明 | 是 | 原样保存；不等同 `workUuid` | 现来源 JSON；拟来源表 | 来源汇总 | 追溯/去重 | 本机 |
| K/T/O | `title` | string | `title` | 样本入库必填 | 是 | 仅用于字段校验与显示，不以占位文本入库 | `content_samples.title`；拟来源原样保留 | 候选/详情/编辑 | 标题特征 | K 文档、T/O 本机 |
| K/T/O | `summary` | string | `summary` | 否 | 是 | 不替代正文；不得截断原始值 | 现来源 JSON 且候选截 500 字；拟主摘要+来源原值 | 候选/详情/编辑 | 内容概览 | K 文档、T/O 本机 |
| K/T/O | `content` | K 示例含 string；榜单类型待验证 | `rawContent` | 否 | 是 | 按实际格式保留原文；另生成 Prepared 文本 | 现仅清理/截断后进入 `body_text`；拟来源原文+Prepared | 候选状态/正文 | 结构与节奏 | K 示例；榜单待验证 |
| K | `workUrl` | string | `articleUrl` | 未明 | 是 | 仅 `https://mp.weixin.qq.com` 用作可打开原文；原值照存 | `content_samples.source_url` + 来源 JSON；拟来源原值 | 原文链接 | 溯源 | 文档 |
| T/O | `oriUrl` | 本机 string | `articleUrl` | 未明 | 是 | 同上；保留原值 | 同上 | 原文链接 | 溯源 | 本机 |
| K | `sourceUrl` | string | `sourceLink` | 未明 | 是 | 与作品链接分开；不自动覆盖 `articleUrl` | 现来源 JSON；拟来源表 | 来源汇总 | 溯源 | 文档 |
| K/T/O | `author` / `userName` | string | `authorName` | 否 | 是 | K 优先 author；榜单优先 userName | `article_metadata.author_id` + 来源 JSON | 候选/详情/编辑 | 账号分层 | K 文档、T/O 本机 |
| K | `originalAuthor` | string | `originalAuthor` | 否 | 是 | 不覆盖当前发布作者 | 现来源 JSON；拟来源表/标准元数据 | 来源汇总 | 来源核对 | 文档 |
| K/T/O | `accountId` | K 未列；本机 10 string/1 null | `accountId` | 否 | 是 | 原样，不能由作者名推造 | 现来源 JSON；拟来源表/标准元数据 | 来源汇总 | 账号分层 | T/O 本机；K 待验 |
| K | `accountType` | string | `accountType` | 否 | 是 | 原样 | 现来源 JSON；拟来源表 | 来源汇总 | 分层提示 | 文档 |
| T/O | 请求 `type`；响应项目 `type`（如存在） | string | `requestedSourceCategory` / `sourceCategory` | 否 | 是 | 请求值与单篇返回值分开；请求值不能冒充文章分类，明确不一致时显示警告 | `discovery_fetches.request_params_json` + 候选 `normalized_json`；正式来源保存请求参数和真实返回字段 | 候选分别显示“请求榜单类目”和“接口返回类目” | 分组参考 | SDK 参数已确认；单项返回语义待真实 Fixture |
| K/T/O | `publishTime` / `publicTime` | string | `publishedAt` + 来源原值 | 否 | 是 | 带时区时间转 UTC；日期原样；无时区日期时间只采用原始日历日期，不猜时区，完整原值仍保留在 provenance/raw payload | 当前文章保存可用日期；来源 provenance 和 payload 保留原时间 | 候选/详情/编辑显示日期；来源汇总可查原值 | 时间分层 | 日期处理由代码测试；T/O 字段仍待真实 Fixture |
| K | `coverUrl` | string | `coverUrl` | 否 | 是 | 校验 URL 后用于展示，原样留存 | 现来源 JSON；拟来源表/标准元数据 | 来源汇总 | 图文形式 | 文档；T/O 本机也出现 |
| T/O | `thumbnail` | 本机 string | `thumbnailUrl` | 否 | 是 | 同上 | 现来源 JSON；拟来源表 | 来源汇总 | 图文形式 | 本机 |
| T/O | `userHeadUrl` | 本机 string | `avatarUrl` | 否 | 是 | 同上 | 现来源 JSON；拟来源表 | 来源汇总 | 账号核对 | 本机 |
| K | `isOriginal` | integer（文档 0/1） | `isOriginal` | 否 | 是 | 0→false、1→true，其他值未知 | 现来源 JSON；拟标准字段+原值 | 来源汇总 | 原创分组 | 文档 |
| T/O | `originalFlag` | 本机 integer | `isOriginal` | 否 | 是 | 真值含义待核对；暂保留原值 | 现来源 JSON；拟标准字段+原值 | 来源汇总 | 原创分组 | 本机类型已知，语义待验 |
| K | `orderNum` | integer | `orderNum` | 否 | 是 | 原样；0 是真实值 | 现来源 JSON；拟来源表 | 来源汇总 | 位置特征 | 文档；T/O 本机也出现 |
| K | `publishLocation` | string | `publishLocation` | 否 | 是 | 原样 | 现来源 JSON；拟来源表 | 来源汇总 | 地域条件 | 文档 |
| K | `memo` | string | `memo` | 否 | 是 | 原样 | 现来源 JSON；拟来源表 | 来源汇总 | 质量提示 | 文档 |
| K | `syncTime` | string | `observedAt` | 否 | 是 | 可解析则用作快照时间；保留原值 | 现来源 JSON/指标时间；拟来源表 | 来源汇总 | 时间基准 | 文档 |
| K | `readCount` | 文档 integer | `readCountRaw/Exact/LowerBound` | 否 | 是 | 整数→精确值；近似文本→原值/下界；缺失→null | `article_metrics.reads/raw_counts_json`；拟增下界 | 候选/详情/编辑 | 相对表现 | 文档，真实类型待验 |
| T/O | `clicksCount` | 本机 string | `readCountRaw/Exact/LowerBound` | 否 | 是 | 按榜单阅读口径；如 `10w+` 精确值 null、下界 100000 | 同上 | 候选/详情/编辑 | 相对表现 | 本机类型已验，完整口径待验 |
| K/T/O | `likeCount` | K 文档 integer；本机 string | `likeCount` | 否 | 是 | 仅纯数字转整数；0 保留；其他保留原值 | `article_metrics.likes/raw_counts_json` | 候选/详情/编辑 | 传播信号 | K 文档、T/O 本机 |
| K/T/O | `watchCount` | K 文档 integer；本机 string | `watchCount` | 否 | 是 | 同上，与点赞分开 | `article_metrics.watch_count/raw_counts_json` | 候选/详情/编辑 | 传播信号 | K 文档、T/O 本机 |
| K/T/O | `commentCount` | K 文档 integer；本机 9 string/2 null | `commentCount` | 否 | 是 | null 不等于 0 | `article_metrics.comments/raw_counts_json` | 候选/详情/编辑 | 互动信号 | K 文档、T/O 本机 |
| K/T/O | `shareCount` | K 文档 integer；本机 string | `shareCount` | 否 | 是 | 同上；UI 名称统一为转发量 | `article_metrics.shares/raw_counts_json` | 候选/详情/编辑 | 传播信号 | K 文档、T/O 本机 |
| K | `collectCount` | integer | `collectCount` | 否 | 是 | 同上 | `article_metrics.saves/raw_counts_json` | 来源汇总/次要读数 | 传播信号 | 文档 |
| K | `rewardCount` | integer | `rewardCount` | 否 | 是 | 同上 | `article_metrics.reward_count/raw_counts_json` | 来源汇总/次要读数 | 传播信号 | 文档 |
| T/O | `interactiveCount` | 本机 null | `interactiveCount` | 否 | 是 | 未返回时不补 0 | `article_metrics.interactive_count/raw_counts_json` | 来源汇总/次要读数 | 传播信号 | 本机仅见 null，非空待验 |
| T/O | `fans` | 本机 null | `fansCount` | 否 | 是 | 纯数字才写精确数；近似保留原文 | `article_metadata.account_followers`/原始读数 | 来源汇总 | 账号规模 | 本机仅见 null，非空待验 |
| K/T/O | 未识别字段 | 任意 JSON 类型 | `rawItem.extra` | 否 | 是 | 不覆盖标准字段，完整保留并给解析警告 | **现丢弃；拟 `article_sources.raw_item_json`** | 来源汇总按需展开 | 将来重解析 | 待真实响应验证 |

## 转换边界

1. `undefined` 表示请求/响应未包含键；`null` 表示上游明确给了空；`0` 是真实读数；`""` 是空文本。Adapter 不用 `or` / `||` 把合法 0 变成其他值。
2. 读数始终保存原值。纯整数可写 exact；`10w+`、`8w+` 等只写下界和原值，不伪装成精确值；无法解析时仍保存原值并写 warning。
3. URL 去重使用校验后的作品链接，`sourceUrl` 保留为另一个来源字段。外部 ID 必须带 provider + endpoint 命名空间。
4. 原始返回项目及请求参数单独保存。请求字段严格白名单，敏感头和 Token 不进数据库、日志或 Fixture。
5. 当前库 11 条都已有来源响应的**白名单子集**，不能作为完整原始响应的验收 Fixture。后续真实响应 Fixture 应在有权使用、已脱敏的条件下采集；在此之前 T/O 的未知字段和 `content` 格式仍为待验证。

## Stage 2B 适配器实现状态（2026-10-24）

`backend/app/domains/articles/adapters/redfox_wechat.py` 已将 K/T/O 映射为目标候选契约，并保留完整原始文章项目。关键词查询使用文档确认的 `keyword`、`offset`；榜单调用沿用现有代码中已采用的 `type`、`startDate`、`endDate`。T/O 的返回容器仍按旧代码识别规则尝试解析，候选会带“响应字段待真实脱敏 Fixture 验证”的警告，因此不代表上游响应契约已通过真实验证。

已映射字段包括标题、摘要、正文原值、作者、作品链接、来源链接、发布时间以及阅读/点赞/在看/评论/转发/收藏/打赏/粉丝/互动读数；每个标准字段记录 `source_path`、`source_id`、状态及转换。缺失、显式 null、0、近似读数分别保留；`10w+` 被记录为原文与下界，不写入精确值。正文只有存在性，不能证明完整性，故未自动标为 `complete`。未知原始键留在候选与正式来源载荷中。

当前 `body_text` 只作为可编辑的候选正文预览；超过预览上限时正式文章当前值会截短，但原始来源载荷仍保存完整响应正文。任何正文完整性判断及更完整的接口字段核验，仍需脱敏真实 Fixture 和人工核对。

2026-10-24 前端核对反馈补充：榜单请求分类只是 RedFox 的查询筛选值；页面不再把它显示成接口为每篇文章实际返回的类目。若响应项目没有 `type`，实际返回类目显示为空；与请求值不同则提示人工核对。类目对齐到工作台选项时，可预填为内部类目，但收录时作为待用户确认的编辑值提交。[RedFox 官方 SDK 榜单示例](https://github.com/redfox-data/redfox-python-sdk)确认 10W+ 与原创榜方法均接收 `type`、`start_date`、`end_date`；这证明请求能够传筛选参数，不构成对每篇文章主题相关性的保证。
