// 2026-10-23：本次修改原因：集中管理经人工核对的品牌介绍、关键事实和来源，供生成任务选择。
import { useEffect, useState, type FormEvent } from 'react'
import { activateBrand, archiveBrand, createBrand, getBrands, updateBrand,
  type Brand, type BrandFact } from '../workspaceApi'

const blankFact = (): BrandFact => ({ label: '', value: '', source: '' })

export default function BrandPage() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [selected, setSelected] = useState<Brand | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [facts, setFacts] = useState<BrandFact[]>([blankFact()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  // 2026-10-23：本次修改原因：阻止未保存的编辑被误当作已经审核的品牌资料。
  const unsaved = selected !== null && (
    name.trim() !== selected.name || description.trim() !== selected.description ||
    JSON.stringify(facts.filter((fact) => Object.values(fact).some((value) => value.trim()))) !== JSON.stringify(selected.facts)
  )

  useEffect(() => {
    getBrands().then(setBrands).catch((reason) =>
      setError(reason instanceof Error ? reason.message : '品牌读取失败'))
  }, [])

  function edit(brand: Brand) {
    setSelected(brand)
    setName(brand.name)
    setDescription(brand.description)
    setFacts(brand.facts.length ? brand.facts.map((fact) => ({ ...fact })) : [blankFact()])
    setError('')
    setMessage('')
  }

  function startNew() {
    setSelected(null)
    setName('')
    setDescription('')
    setFacts([blankFact()])
    setError('')
    setMessage('')
  }

  function remember(brand: Brand) {
    setBrands((current) => [brand, ...current.filter((item) => item.id !== brand.id)])
    edit(brand)
  }

  function changeFact(index: number, field: keyof BrandFact, value: string) {
    setFacts((current) => current.map((fact, at) => at === index ? { ...fact, [field]: value } : fact))
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    const cleaned = facts.filter((fact) => Object.values(fact).some((value) => value.trim()))
    if (cleaned.some((fact) => !fact.label.trim() || !fact.value.trim() || !fact.source.trim())) {
      setError('每条关键事实都需要填写名称、内容和来源。')
      return
    }
    setBusy(true)
    try {
      const payload = { name: name.trim(), description: description.trim(), facts: cleaned }
      const brand = selected ? await updateBrand(selected.id, payload) : await createBrand(payload)
      remember(brand)
      setMessage('品牌草稿已保存。核对事实及来源后，点击“审核并启用”。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '品牌保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function changeActive(active: boolean) {
    if (!selected) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const brand = active ? await activateBrand(selected.id) : await archiveBrand(selected.id)
      remember(brand)
      setMessage(active ? '品牌资料已启用，可在内容生成页选择。' : '品牌资料已停用。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '品牌状态更新失败')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <div className="pageHeading">
      {/* <div><p className="kicker">BRANDS / 品牌库</p><h1>把品牌事实带入内容创作</h1> 2026-10-23：原装饰性页眉保留供对照。 */}
      {/* 2026-10-23：本次修改原因：页面标题只保留模块名称，品牌状态通过列表表达。 */}
      <div><h1>品牌库</h1>
        <p>维护品牌介绍、关键数据和来源；审核启用后，生成任务才能使用对应版本。</p></div>
      <span className="headingIndex">04 / 05</span>
    </div>
    <div className="infoBanner"><span className="bannerIcon">i</span>
      关键事实请填写可核对的来源链接或资料名称。模型会参考这些信息，但生成结果仍需人工核对。
    </div>
    <div className="brandLayout">
      <section className="card">
        <div className="sectionHeading"><div><span className="stepTag">01</span><h2>品牌列表 <span className="countBadge">{brands.length}</span></h2></div>
          <button className="secondaryButton" type="button" onClick={startNew}>新建品牌</button></div>
        {brands.length === 0 ? <div className="emptyState"><h3>还没有品牌资料</h3><p>先创建一份品牌档案。</p></div> :
          <div className="strategyList">{brands.map((brand) => <button className={selected?.id === brand.id ? 'strategyListItem selected' : 'strategyListItem'}
            key={brand.id} type="button" onClick={() => edit(brand)}>
            <span className="strategyListTop"><strong>{brand.name}</strong><em className={`miniStatus ${brand.active ? 'published' : 'archived'}`}>{brand.active ? '已启用' : '草稿 / 停用'}</em></span>
            <span className="strategyListMeta">V{brand.version} · {brand.facts.length} 条关键事实</span>
          </button>)}</div>}
      </section>
      <section className="card brandEditor">
        <div className="sectionHeading"><div><span className="stepTag teal">02</span><h2>{selected ? `编辑品牌 V${selected.version}` : '创建品牌'}</h2></div></div>
        <form className="guideForm" onSubmit={save}>
          <label className="field"><span>品牌名称 <em>*</em></span><input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：某品牌" /></label>
          <label className="field"><span>品牌介绍 <em>*</em></span><textarea required maxLength={3000} rows={5} value={description}
            onChange={(event) => setDescription(event.target.value)} placeholder="定位、产品或服务、适用人群，以及已核实的品牌背景" /></label>
          <div className="brandFactsHeading"><div><h3>关键事实与数据</h3><p>一条事实配一个来源，方便生成后核查。</p></div>
            <button className="textButton" type="button" disabled={facts.length >= 20} onClick={() => setFacts((current) => [...current, blankFact()])}>＋ 添加事实</button></div>
          {facts.map((fact, index) => <div className="brandFact" key={index}>
            <div className="brandFactTitle"><strong>事实 {index + 1}</strong><button type="button" className="textButton" onClick={() => setFacts((current) => current.length === 1 ? [blankFact()] : current.filter((_, at) => at !== index))}>移除</button></div>
            <label className="field"><span>名称</span><input maxLength={100} value={fact.label} onChange={(event) => changeFact(index, 'label', event.target.value)} placeholder="例如：成立年份" /></label>
            <label className="field"><span>内容 / 数值</span><input maxLength={500} value={fact.value} onChange={(event) => changeFact(index, 'value', event.target.value)} placeholder="例如：2020 年" /></label>
            <label className="field"><span>来源</span><input maxLength={500} value={fact.source} onChange={(event) => changeFact(index, 'source', event.target.value)} placeholder="公开链接或内部资料名称" /></label>
          </div>)}
          <div className="guideActions"><button className="secondaryButton" disabled={busy} type="submit">{busy ? '保存中…' : '保存草稿'}</button>
            {selected && !selected.active && <button type="button" className="primaryButton" disabled={busy || unsaved} onClick={() => void changeActive(true)}>审核并启用</button>}
            {selected?.active && <button type="button" className="quietButton" disabled={busy} onClick={() => void changeActive(false)}>停用品牌</button>}</div>
        </form>
        {unsaved && <p className="subtle">有未保存的修改；请先保存草稿，再审核启用。</p>}
        {selected?.active && <p className="subtle">编辑后自动回到草稿，需要再次审核启用。</p>}
        {error && <p className="alert error" role="alert">{error}</p>}
        {message && <p className="alert success" role="status">{message}</p>}
      </section>
    </div>
  </>
}
