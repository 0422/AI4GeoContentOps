<!-- 2026-10-24：本次修改原因：在保留既有样本 ID 与下游引用的前提下定义公众号文章的统一数据契约。 -->
# 文章样本目标数据模型

## 设计边界

沿用现有 `content_samples` 作为统一文章主记录，避免改写内容策略和生成模块已持有的样本 ID。下面是逻辑目标模型，不表示数据库已经迁移。公众号先落地；其他平台保留各自 Adapter，但不得把公众号字段硬塞进其他平台。

采集结果、编辑确认后的文章、可分析文本分别保存。抓取接口返回的事实及原始正文不得被编辑表单覆盖；人工修改形成当前文章值，并留下可追溯来源。没有正文或尚未确认权限的候选可保存在待收录来源记录中，不得伪装为已入库且可分析的样本。

## 逻辑实体

| 实体 | 职责 | 当前/计划 |
|---|---|---|
| `content_samples` | 稳定文章 ID、当前标题、当前可编辑正文、平台、项目类目、原文链接、质量、使用权限 | 保留既有表与 ID |
| `article_metadata` | 作者、发布日期、可编辑摘要、受众/主题/标签、复核及授权说明 | 增加 `summary_text`；保留 `source_data_json` 兼容旧读者 |
| `article_sources` | 每次 RedFox/人工采集的独立来源，原始项目 JSON、原始正文、请求参数、外部 ID、类别、采集时间、解析版本及警告 | 新表；`sample_id` 可空，待收录时先存来源 |
| `article_metrics` | 阅读及互动的每次观测快照；精确值、原值和可知下界分开 | 保留表，增量加 `source_id` 与 `read_lower_bound` |
| `prepared_articles` | 从已持久化文章生成的版本化清洗结果、段落块、质量标记和状态 | 新表；不覆盖源正文或当前文章正文 |
| `article_features` | 后续特征提取结果 | 本阶段保留现状；未来增加 Prepared 版本引用 |

### 统一读写 DTO

```typescript
interface ArticleDTO {
  id: string;
  platformId: string;
  categoryId: string;
  articleUrl: string | null;
  authorName: string | null;
  publishedAt: string | null; // 现有业务用 YYYY-MM-DD；完整上游时间留在来源
  title: string;
  summary: string | null;
  bodyText: string;
  rightsConfirmed: boolean;
  reviewStatus: "pending" | "ready" | "excluded";
  latestMetrics: {
    readsRaw: string | null;
    readsExact: number | null;
    readsLowerBound: number | null;
    likes: number | null;
    watchCount: number | null;
    comments: number | null;
    shares: number | null;
  } | null;
  sources: ArticleSourceDTO[];
  preparation: { status: string; cleanerVersion: string | null } | null;
}

interface ArticleSourceDTO {
  id: string;
  articleId: string | null;
  provider: "redfox" | "manual";
  endpoint: "keyword_search" | "ten_w_rank" | "original_rank" | "manual";
  externalId: string | null;
  sourceCategory: string | null;
  requestParams: Record<string, unknown>;
  rawResponseItem: Record<string, unknown>;
  rawContent: string | null;
  contentFormat: "html" | "markdown" | "plain" | "unknown";
  fetchedAt: string;
  parserVersion: string;
  rawComplete: boolean;
  warnings: string[];
}
```

项目现有 HTTP/数据库使用 snake_case；DTO 中的 camelCase 是逻辑示意。实施时先定义一套后端响应及对应的 TypeScript 类型，避免在每个组件重复转换。创建与 PATCH 的表单契约只包含可编辑字段；来源原始 JSON、原始正文、采集时间、解析警告由服务端只读返回，不能由普通 PATCH 覆盖。手动录入的正文作为人工来源记录保存，原文链接可空。

## 字段呈现与编辑规则

所有公众号入口显示同一套主字段：**内容平台、文章类目、原文链接、作者、发布时间；标题、摘要、正文；阅读量、点赞量、在看量、评论量、转发量；抓取来源字段汇总。**候选简表允许先压缩展示，但“查看并补齐”、手动录入、样本编辑使用同一字段定义、标签、校验与保存映射。体裁、受众、主题、标签、收藏/打赏/粉丝等已有字段保留在次要区域，不因界面简化而清空。没有来源的手动样本显示“人工录入”，不造出 RedFox 返回字段。

摘要是编辑值，保存在 `article_metadata.summary_text`。每个来源中的原始 `summary` 单独保留；用户修改摘要不会改变上游原值。正文同理：`content_samples.body_text` 是用户当前确认的正文，`article_sources.raw_content` 保留上游原始正文。来源汇总展示 `raw_response_item` 的键和值，长正文独立展示/下载，不在元数据网格里塞满全文。

主读数优先显示最新的有效快照，仍可查看全部历史。整数 `0` 直接显示 0；null/缺键显示“未提供”；`10w+` 显示原值，精确值为 null，下界为 100000。编辑现有读数时新增快照或显式选择修订路径，不能改写历史上游快照。

<!-- 2026-10-24：本次修改原因：将本轮样本管理页面的筛选和按需详情要求写入统一前端方案。 -->
样本管理顶部保留平台、类目、体裁三个下拉筛选；移除受众、状态、分析、表现筛选和独立搜索行。后端原有查询参数暂保留兼容其他调用方。初始只显示占满可用宽度的入库文章列表；选择某条后才渲染右侧详情，并允许关闭详情恢复列表宽度。列表项与详情均复用同一 `ArticleDTO` 的命名和空值规则；详情是只读核对入口，编辑按钮打开共享表单。

## 采集与去重

1. Adapter 接收完整单条响应及经过白名单挑选的请求参数，立即形成标准候选、原始来源和解析警告；未知响应键保留在 `raw_response_item`。
2. 正式收录先查 provider + endpoint + externalId，再查规范化作品 URL。命中已入库文章时追加来源和快照，保留原有文章 ID。
3. 正文 SHA-256 只判断内容相等；仅正文相同而 URL/外部 ID 不同，不自动断言为同一发布文章。必要时提示人工合并。
4. 同来源重复查询可更新“最近采集时间”或增加一次观测记录，不能用空字段覆盖现有有效文章字段。指标按实际观测时间新增快照。
5. 权限确认、复核状态与允许传给第三方模型的范围分开保存。公开可读不自动等于已授权。

## 与现有下游的关系

内容策略及生成仍引用 `content_samples.id`，旧接口在迁移过渡期继续可用。Prepared Article 完成后，风格分析在保证状态为 completed 且输入哈希有效时读取其清洗正文和 blocks；未完成时不静默回退到未标记的候选摘要。特征提取 Skill 在下一阶段消费 Prepared Article ID、清洗版本和来源哈希，不能把采集请求和 LLM 分析耦合在同一保存事务。
