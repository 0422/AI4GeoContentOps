// 2026-10-23：本次修改原因：以可返回、可分享的页面导航组织生成、样本、策略和设置。
import { useCallback, useEffect, useState } from 'react'
import { getOptions, type ContentOption } from './workspaceApi'
import GeneratePage from './pages/GeneratePage'
import SamplesPage from './pages/SamplesPage'
import StrategiesPage from './pages/StrategiesPage'
import SettingsPage from './pages/SettingsPage'
// 2026-10-23：本次修改原因：增加可审核的品牌事实库入口。
import BrandPage from './pages/BrandPage'

// type PageKey = 'generate' | 'samples' | 'strategies' | 'settings' // 2026-10-23：原四页面导航暂留供对照。
// 2026-10-23：本次修改原因：品牌库成为独立工作页面。
type PageKey = 'generate' | 'samples' | 'strategies' | 'brands' | 'settings'

const pages: { key: PageKey; label: string; hint: string; symbol: string }[] = [
  { key: 'generate', label: '内容生成', hint: '按策略创作', symbol: '✦' },
  { key: 'samples', label: '样本库', hint: '录入优质内容', symbol: '▤' },
  { key: 'strategies', label: '内容策略', hint: '提炼与审核', symbol: '◇' },
  // 2026-10-23：本次修改原因：让品牌事实资料在生成前可集中维护。
  { key: 'brands', label: '品牌库', hint: '事实与来源', symbol: '▣' },
  { key: 'settings', label: '工作台设置', hint: '选项与模型', symbol: '⚙' },
]

function route(): PageKey {
  const key = window.location.hash.replace(/^#\/?/, '')
  return pages.find((item) => item.key === key)?.key ?? 'generate'
}

export default function WorkspaceApp() {
  const [page, setPage] = useState<PageKey>(route)
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
    <aside className="sidebar">
      <a className="brand" href="#/generate" aria-label="返回内容生成">
        <span className="brandMark">G</span>
        <span><strong>AI4Geo</strong><small>CONTENT OPERATIONS</small></span>
      </a>
      <div className="navCaption">工作空间</div>
      <nav className="sideNav" aria-label="主导航">
        {pages.map((item) => <a
          key={item.key}
          href={`#/${item.key}`}
          className={page === item.key ? 'navItem active' : 'navItem'}
          aria-current={page === item.key ? 'page' : undefined}
        >
          <span className="navSymbol" aria-hidden="true">{item.symbol}</span>
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
          {page === 'samples' && <SamplesPage options={options} />}
          {page === 'strategies' && <StrategiesPage options={options} />}
          {/* 2026-10-23：本次修改原因：呈现品牌资料管理与审核页面。 */}
          {page === 'brands' && <BrandPage />}
          {page === 'settings' && <SettingsPage options={options} onOptionsChange={refreshOptions} />}
        </>}
      </main>
    </div>
  </div>
}
