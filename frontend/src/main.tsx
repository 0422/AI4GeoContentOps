// 2026-10-23：挂载 React 页面，作为工作台的前端入口。
import React from 'react'
import ReactDOM from 'react-dom/client'
// import App from './App' // 2026-10-23：原单页入口暂保留供对照。
// 2026-10-23：本次修改原因：切换到有侧边栏的多页面内容工作台。
import WorkspaceApp from './WorkspaceApp'
// import './styles.css' // 2026-10-23：原骨架样式暂保留供对照。
// 2026-10-23：本次修改原因：加载统一的工作台布局和响应式视觉规范。
import './workspace.css'
// 2026-10-23：本次修改原因：以语义化主题变量和克制的视觉层覆盖旧样式，便于逐页迁移及以后扩展深色主题。
import './design-tokens.css'
import './workspace-modern.css'
// 2026-10-23：本次修改原因：加载文章库的列表、详情、画像和窄屏布局样式。
import './article-library.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* <App /> 2026-10-23：原单页入口暂保留供对照。 */}
    {/* 2026-10-23：本次修改原因：展示多页面导航和新的业务流程。 */}
    <WorkspaceApp />
  </React.StrictMode>,
)
