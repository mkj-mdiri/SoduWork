import React, { useEffect, useState } from 'react'
import { api, can } from '../api.js'
import { translateText as tx } from '../i18n.js'
import { Modal, navTo } from '../ui.jsx'
import './first-run-setup.css'

const copy = {
  connect: ['准备好你的 SoduWork 工作空间', '接入并验证一个模型，让团队成员登录后就能开始协作。', '开始配置'],
  test: ['确认 SoduWork 能调用你的模型', '为「{0}」发送一条测试消息，确认模型可以正常回复。', '测试模型'],
  default: ['让成员用上已验证的模型', '「{0}」已通过测试。确认适用范围并设为默认，即可完成设置。', '设置默认模型'],
}

export default function FirstRunSetup() {
  const [state, setState] = useState(null)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState('')
  const [fields, setFields] = useState({ baseUrl: '', apiKey: '', name: '' })
  const [providerId, setProviderId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function refresh() {
    const next = await api.firstRunSetup()
    setState(next)
    setSelected(next.modelId || '')
    return next
  }

  useEffect(() => { refresh().catch(err => setError(err.message)) }, [])

  if (!state) return error && <button className="btn btn-ghost" onClick={() => refresh().catch(err => setError(err.message))}>{tx('无法读取首次设置进度，点击重试')}</button>
  if (state.stage === 'complete' && !open) return null

  const model = state.models?.find(row => row.id === selected)
  const cardModel = state.models?.find(row => row.id === state.modelId)
  const stage = state.stage === 'complete' ? 'complete' : model?.verified ? 'default' : model ? 'test' : 'connect'
  const card = copy[state.stage]

  async function advance(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (stage === 'default') {
        setState(await api.finishFirstRunSetup({ modelId: model.id, configRevision: model.configRevision }))
        return
      }
      let service = model?.providerId
      let name = model?.name
      if (!model) {
        name = fields.name.trim()
        service = providerId || 's-' + globalThis.crypto.getRandomValues(new Uint32Array(1))[0].toString(36)
        setProviderId(service)
        const catalog = await api.modelCatalog()
        const provider = catalog.providers.find(row => row.id === service)
        await api.saveModelProvider(service, {
          name: tx('首次设置模型服务'), kind: 'openai-compat', baseUrl: fields.baseUrl.trim(),
          apiKey: fields.apiKey.trim(), expectedRevision: provider?.revision || 'new',
        })
        if (!catalog.models.some(row => row.providerId === service && row.name === name)) {
          await api.saveModelDef({ providerId: service, name, modality: 'chat', enabled: true, expectedRevision: 'new' })
        }
      }
      const result = await api.checkModelCapabilities({ providerId: service, model: name, checks: ['connection'] })
      if (!result.ok) throw new Error(tx('模型未通过测试。请核对接口地址、API Key 和模型 ID 后重试。'))
      await refresh()
      setSelected(service + ':' + name)
      setFields(current => ({ ...current, apiKey: '' }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function close() {
    if (busy) return
    setOpen(false)
    setError('')
    setNotice('')
    setFields(current => ({ ...current, apiKey: '' }))
    if (state.stage !== 'complete') refresh().catch(() => {})
  }

  async function copyAccess() {
    const message = tx('下载 SoduWork 桌面端：{0}。打开客户端，在「连接」中输入 Hub 地址 {1}，使用管理员提供的成员账号登录。', [location.origin + '/#downloads', location.origin])
    try {
      await navigator.clipboard.writeText(message)
      setNotice(tx('已复制客户端接入说明'))
    } catch {
      setNotice(message)
    }
  }

  return <>
    {card && <aside className="first-run-card" aria-labelledby="first-run-title">
      <div><h2 id="first-run-title">{tx(card[0])}</h2><p>{tx(card[1], [cardModel?.label || cardModel?.name || ''])}</p></div>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>{tx(card[2])}</button>
    </aside>}
    {open && <Modal title={stage === 'complete' ? tx('你的 SoduWork 工作空间已就绪') : tx(copy.connect[0])} onClose={close}>
      {stage === 'complete' ? <>
        <p>{tx('默认模型已通过测试，团队成员可以使用。')}</p>
        <div className="first-run-actions">
          {can('user.manage') && <button className="btn btn-ghost" onClick={() => { close(); navTo('users') }}>{tx('管理成员')}</button>}
          <button className="btn btn-ghost" onClick={copyAccess}>{tx('复制客户端接入说明')}</button>
          <button className="btn btn-primary" onClick={close}>{tx('返回首页')}</button>
        </div>
        {notice && <p role="status">{notice}</p>}
      </> : <form className="first-run-form" onSubmit={advance}>
        <ol className="first-run-progress">
          {Object.entries({ connect: '连接模型', test: '测试连接', default: '设为默认' }).map(([step, label]) =>
            <li key={step} aria-current={stage === step ? 'step' : undefined}>{tx(label)}</li>)}
        </ol>
        {state.models?.length > 0 && <label>{tx('对话模型')}
          <select className="f-in" disabled={busy} value={selected} onChange={event => { setSelected(event.target.value); setError('') }}>
            {state.models.map(row => <option key={row.id} value={row.id}>{row.label || row.name} ({row.providerId})</option>)}
            <option value="">{tx('接入新模型')}</option>
          </select>
        </label>}
        {stage === 'connect' && [
          ['baseUrl', 'OpenAI 兼容接口地址', 'url'],
          ['apiKey', 'API Key', 'password'],
          ['name', '模型 ID', 'text'],
        ].map(([field, label, type]) => <label key={field}>{tx(label)}
          <input className="f-in" required type={type} autoComplete="off" disabled={busy} value={fields[field]}
            onChange={event => setFields({ ...fields, [field]: event.target.value })} />
        </label>)}
        {stage === 'test' && <p>{tx(copy.test[1], [model.label || model.name])}</p>}
        {stage === 'default' && <p>{tx('使用范围：连接到此 Hub 的成员。已配置个人默认模型的成员将继续使用自己的选择。')}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="first-run-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={close}>{tx('稍后设置')}</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? tx('正在处理…') : tx(stage === 'connect' ? '保存并测试' : copy[stage][2])}</button>
        </div>
      </form>}
    </Modal>}
  </>
}
