// 2026-10-23：本次修改原因：以可返回、可分享的页面导航组织生成、样本、策略和设置。
import { useCallback, useEffect, useState } from 'react'
import { getOptions, type ContentOption } from './workspaceApi'
import GeneratePage from './pages/GeneratePage'
// import SamplesPage from './pages/SamplesPage' // 2026-10-23：原样本页入口保留供对照。
// import ArticlesPage from './pages/ArticlesPage' // 2026-10-24：v1 页面暂留供迁移对照，不再作为目标库入口。
// 2026-10-24：本次修改原因：Stage 2C 的文章管理与发现页改用目标库 v2 API 和统一文章表单。
import ArticleLibraryV2Page from './pages/ArticleLibraryV2Page'
import StrategiesPage from './pages/StrategiesPage'
import SettingsPage from './pages/SettingsPage'
// 2026-10-23：本次修改原因：增加可审核的品牌事实库入口。
import BrandPage from './pages/BrandPage'

// type PageKey = 'generate' | 'samples' | 'strategies' | 'settings' // 2026-10-23：原四页面导航暂留供对照。
// 2026-10-23：本次修改原因：品牌库成为独立工作页面。
type PageKey = 'generate' | 'samples' | 'strategies' | 'brands' | 'settings'

const pages: { key: PageKey; label: string; hint: string; symbol: string }[] = [
  { key: 'generate', label: '内容生成', hint: '按策略创作', symbol: '✦' },
  // { key: 'samples', label: '样本库', hint: '录入优质内容', symbol: '▤' }, // 2026-10-23：原导航文案保留供对照。
  // 2026-10-23：本次修改原因：明确此处管理可追溯的参考文章，而非生成后的稿件。
  { key: 'samples', label: '参考文章库', hint: '采集与风格分析', symbol: '▤' },
  { key: 'strategies', label: '内容策略', hint: '提炼与审核', symbol: '◇' },
  // 2026-10-23：本次修改原因：让品牌事实资料在生成前可集中维护。
  { key: 'brands', label: '品牌库', hint: '事实与来源', symbol: '▣' },
  { key: 'settings', label: '工作台设置', hint: '选项与模型', symbol: '⚙' },
]

// 2026-10-23：本次修改原因：侧边导航使用与功能含义一致的线条图标，收起后仍可识别入口。
function NavIcon({ page }: { page: PageKey }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {page === 'generate' && <><path d="M5 3h9l5 5v13H5z M14 3v5h5 M8 13h8 M8 17h5" /><path d="m17 14 .5 1.5L19 16l-1.5.5L17 18l-.5-1.5L15 16l1.5-.5z" /></>}
    {page === 'samples' && <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8 M8 12h8 M8 16h5" /></>}
    {page === 'strategies' && <><circle cx="5" cy="5" r="2" /><circle cx="19" cy="7" r="2" /><circle cx="12" cy="19" r="2" /><path d="M7 6l10 1 M6 7l5 10 M18 9l-5 8" /></>}
    {page === 'brands' && <><path d="M4 21V7l8-4 8 4v14z M4 21h16 M8 10h2 M14 10h2 M8 14h2 M14 14h2 M10 21v-4h4v4" /></>}
    {page === 'settings' && <><path d="M4 7h16 M4 17h16 M9 4v6 M15 14v6" /></>}
  </svg>
}

function route(): PageKey {
  const key = window.location.hash.replace(/^#\/?/, '')
  return pages.find((item) => item.key === key)?.key ?? 'generate'
}

export default function WorkspaceApp() {
  const [page, setPage] = useState<PageKey>(route)
  // 2026-10-23：本次修改原因：主导航可切换为只显示图标的窄侧栏。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [options, setOptions] = useState<ContentOption[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const refreshOptions = useCallback(async () => {
    try {
      setOptions(await getOptions(true))
      setLoadError('')
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : '选项读取失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const onHashChange = () => setPage(route())
    window.addEventListener('hashchange', onHashChange)
    void refreshOptions()
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [refreshOptions])

  const current = pages.find((item) => item.key === page) ?? pages[0]

  return <div className="appShell">
    {/* <aside className="sidebar"> 2026-10-23：原固定宽度侧栏留作对照。 */}
    {/* 2026-10-23：本次修改原因：侧栏右上角提供收起与展开按钮，并同步调整导航标签。 */}
    <aside className={sidebarCollapsed ? 'sidebar isCollapsed' : 'sidebar'}>
      <div className="sidebarHeader">
        <a className="brand" href="#/generate" aria-label="返回内容生成">
          <span className="brandMark">G</span>
          <span className="brandText"><strong>AI4Geo</strong><small>CONTENT OPERATIONS</small></span>
        </a>
        <button className="sidebarToggle" type="button" aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-expanded={!sidebarCollapsed} aria-controls="workspace-navigation"
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} onClick={() => setSidebarCollapsed((current) => !current)}>
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {sidebarCollapsed ? <path d="m5 4 5 6-5 6 M10 4l5 6-5 6" /> : <path d="m15 4-5 6 5 6 M10 4l-5 6 5 6" />}
          </svg>
        </button>
      </div>
      <div className="navCaption">工作空间</div>
      <nav className="sideNav" id="workspace-navigation" aria-label="主导航">
        {pages.map((item) => <a
          key={item.key}
          href={`#/${item.key}`}
          className={page === item.key ? 'navItem active' : 'navItem'}
          aria-current={page === item.key ? 'page' : undefined}
          aria-label={item.label} title={sidebarCollapsed ? item.label : undefined}
        >
          {/* <span className="navSymbol" aria-hidden="true">{item.symbol}</span> 2026-10-23：原抽象字符图标留作对照。 */}
          {/* 2026-10-23：本次修改原因：展开时图标位于文字左侧，收起时保留图标入口。 */}
          <span className="navSymbol" aria-hidden="true"><NavIcon page={item.key} /></span>
          <span className="navWords"><strong>{item.label}</strong><small>{item.hint}</small></span>
        </a>)}
      </nav>
      <div className="sidebarFoot">
        <span className="statusDot" /> 本地内容工作台
        <small>生成结果需人工审核</small>
      </div>
    </aside>

    <div className="appBody">
      <header className="topbar">
        <span className="breadcrumb">工作空间 <span>/</span> {current.label}</span>
        <span className="topbarBadge">策略驱动创作</span>
      </header>
      <main className="pageContent">
        {loadError && <div className="alert error" role="alert">{loadError}
          <button type="button" className="textButton" onClick={() => void refreshOptions()}>重试</button>
        </div>}
        {loading ? <div className="loadingBlock">正在加载工作台配置…</div> : <>
          {page === 'generate' && <GeneratePage options={options} />}
          {/* {page === 'samples' && <SamplesPage options={options} />} 2026-10-23：原页面挂载保留供对照。 */}
          {/* {page === 'samples' && <ArticlesPage options={options} />} 2026-10-24：v1 页面保留供对照。 */}
          {/* 2026-10-24：本次修改原因：文章库的正式录入和样本管理统一切换到 v2 目标数据契约。 */}
          {page === 'samples' && <ArticleLibraryV2Page options={options} />}
          {page === 'strategies' && <StrategiesPage options={options} />}
          {/* 2026-10-23：本次修改原因：呈现品牌资料管理与审核页面。 */}
          {page === 'brands' && <BrandPage />}
          {page === 'settings' && <SettingsPage options={options} onOptionsChange={refreshOptions} />}
        </>}
      </main>
    </div>
  </div>
}
