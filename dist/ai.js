'use strict'
const fs = require('fs')
const path = require('path')
const configPath = path.join(__dirname, '..', 'ai-settings.json')
function settings (api) {
    const defaults = { baseURL: 'http://127.0.0.1:31415/v1', apiKey: '', model: 'auto', protocol: 'chat', excludedGroups: [], candidateLimit: 50 }
    const stored = api && api.config && api.config.store && api.config.store.qc && api.config.store.qc.ai
    if (stored) return Object.assign(defaults, stored)
    let saved = {}
    try { saved = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch (_) {}
    return Object.assign(defaults, saved)
}
function saveSettings (api, value) {
    if (api && api.config && api.config.store) {
        api.config.store.qc = api.config.store.qc || {}
        api.config.store.qc.ai = Object.assign({}, value)
        if (typeof api.config.save === 'function') api.config.save().catch(() => null)
        return
    }
    fs.writeFileSync(configPath, JSON.stringify(value, null, 2), { mode: 0o600 })
}
function corpus (commands, cfg, query) {
    const excluded = new Set(cfg.excludedGroups || [])
    const eligible = commands.filter(c => !excluded.has(c.group || ''))
    const q = String(query || '').toLocaleLowerCase().split(/\s+/).filter(Boolean)
    const scored = eligible.map((c, order) => { const hay = `${c.name || ''} ${c.group || ''} ${c.text || ''}`.toLocaleLowerCase(); let score = q.length ? q.reduce((n,t) => n + (hay.includes(t) ? (String(c.name||'').toLocaleLowerCase().includes(t) ? 5 : 1) : 0), 0) : 0; return { c, order, score } }).filter(x => !q.length || x.score > 0).sort((a,b) => b.score-a.score || a.order-b.order)
    const items = scored.slice(0, Math.max(1, Number(cfg.candidateLimit) || 50)).map(x => x.c)
    const records = items.map((c, i) => ({ id: i + 1, name: c.name || '', group: c.group || '', command: c.text || '' }))
    return { items, text: JSON.stringify(records), chars: eligible.reduce((n, c) => n + Array.from(String(c.text || '')).length, 0), candidateChars: items.reduce((n,c) => n + Array.from(String(c.text || '')).length, 0), eligibleCount: eligible.length }
}

function request (cfg, prompt, signal) {
    return new Promise((resolve, reject) => {
        let url
        try {
            const suffix = cfg.protocol === 'responses' ? 'responses' : cfg.protocol === 'messages' ? 'messages' : 'chat/completions'
            const base = String(cfg.baseURL || '').trim().replace(/\/(chat\/completions|responses|messages)\/?$/, '').replace(/\/+$/, '')
            url = new URL(base + '/' + suffix)
            if (!['http:', 'https:'].includes(url.protocol)) return reject(new Error('仅支持 HTTP/HTTPS 地址'))
        } catch (e) {
            return reject(new Error('基础 URL 无效：' + String(e && e.message ? e.message : e)))
        }
        const body = cfg.protocol === 'responses'
            ? { model: cfg.model || 'auto', input: prompt, stream: false }
            : { model: cfg.model || 'auto', messages: [{ role: 'user', content: prompt }], stream: false }
        if (cfg.protocol === 'messages') body.max_tokens = 2048
        const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey }
        if (cfg.protocol === 'messages') Object.assign(headers, { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' })
        const req = require(url.protocol === 'https:' ? 'https' : 'http').request(url, { method: 'POST', headers }, res => {
            let data = ''
            res.setEncoding('utf8')
            res.on('data', chunk => { data += chunk; if (data.length > 4000000) req.destroy(new Error('响应过大')) })
            res.on('error', reject)
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('API HTTP ' + res.statusCode + '：' + data.slice(0, 300)))
                try {
                    const json = JSON.parse(data)
                    const result = json.choices?.[0]?.message?.content || json.output_text || (json.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n') || (json.output || []).flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('\n')
                    if (!result || typeof result !== 'string') throw new Error('接口未返回文本，请检查模型与接口类型')
                    resolve(result)
                } catch (e) { reject(e) }
            })
        })
        const timeout = setTimeout(() => req.destroy(new Error('请求超过 90 秒，请检查本地 API 服务')), 90000)
        const abort = () => req.destroy(new Error('已取消'))
        if (signal) { if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }) }
        req.on('close', () => { clearTimeout(timeout); if (signal) signal.removeEventListener('abort', abort) })
        req.on('error', reject)
        req.end(JSON.stringify(body))
    })
}
function parseMatches (text, data) {
    const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    const result = JSON.parse(clean)
    if (!Array.isArray(result.matches)) throw new Error('AI 返回格式不正确，请重试')
    const seen = new Set()
    return result.matches.filter(m => Number.isInteger(m.id) && m.id > 0 && m.id <= data.items.length && !seen.has(m.id) && seen.add(m.id)).map(m => ({ cmd: data.items[m.id - 1], reason: String(m.reason || '') }))
}
function open (api) {
    const existing = document.getElementById('qcl-ai-overlay')
    if (existing && existing.removePanel) { existing.removePanel(); return }
    const cfg = settings(api); let controller = null; let closed = false
    const el = (tag, parent, text) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (parent) parent.appendChild(n); return n }
    const overlay = el('div', document.body); overlay.id = 'qcl-ai-overlay'
    overlay.style.cssText = 'position:fixed;inset:0;z-index:11000;background:#0008;display:flex;align-items:center;justify-content:center;color:#eee'
    const panel = el('section', overlay); panel.style.cssText = 'background:#20242b;border:1px solid #687080;border-radius:10px;padding:18px;width:min(1100px,96vw);height:min(720px,90vh);display:flex;flex-direction:column;box-shadow:0 12px 60px #0008;font:14px sans-serif'
    const style = el('style', panel); style.textContent = '#qcl-ai-overlay button{background:#384657;color:white;border:1px solid #8290a1;border-radius:4px;padding:7px 12px;cursor:pointer}#qcl-ai-overlay button:disabled{opacity:.5}#qcl-ai-overlay input{background:#303640;color:#fff;border:1px solid #768092;border-radius:4px;padding:9px;width:100%}#qcl-ai-aiwork{display:grid;grid-template-columns:minmax(260px,1fr) minmax(360px,1.25fr);gap:14px;flex:1;min-height:0}#qcl-ai-output{display:none;overflow:auto;background:#15191e;border:1px solid #687080;border-radius:6px;padding:10px;user-select:text}#qcl-ai-output.open{display:block}#qcl-ai-output pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#e4efff;background:#101318;padding:10px}#qcl-ai-form{display:flex;flex-direction:column;gap:10px}#qcl-ai-form textarea{flex:1;resize:vertical;min-height:180px;background:#303640;color:#fff;border:1px solid #768092;border-radius:4px;padding:10px;font:14px sans-serif}#qcl-ai-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.qcl-spinner{display:inline-block;width:14px;height:14px;border:2px solid #9ba9ba;border-top-color:transparent;border-radius:50%;animation:qclspin .8s linear infinite}@keyframes qclspin{to{transform:rotate(360deg)}}'
    const head = el('div', panel); head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px'; el('h3', head, 'AI 找命令')
    const close = el('button', head, '关闭'); const work = el('div', panel); work.id = 'qcl-ai-aiwork'; const form = el('div', work); form.id = 'qcl-ai-form'; el('label', form, '输入你的需求'); const query = el('textarea', form); query.placeholder = '例如：找出查看 Docker 容器日志的命令'; const actions = el('div', form); actions.id = 'qcl-ai-actions'; const search = el('button', actions, '开始检索'); const outputToggle = el('button', actions, '显示输出'); const status = el('span', actions); const output = el('div', work); output.id = 'qcl-ai-output'
    let data = corpus(api.store.ensureStore(), cfg); const countLabel = el('small', form, `可检索 ${data.chars.toLocaleString()} 字符 · 候选上限 ${cfg.candidateLimit}`)
    const escape = event => { if (event.key === 'Escape') { event.stopImmediatePropagation(); overlay.removePanel() } }; document.addEventListener('keydown', escape, true)
    overlay.removePanel = () => { closed = true; if (controller) controller.abort(); overlay.remove(); document.removeEventListener('keydown', escape, true) }
    close.onclick = overlay.removePanel; outputToggle.onclick = () => { output.classList.toggle('open'); outputToggle.textContent = output.classList.contains('open') ? '隐藏输出' : '显示输出' }
    for (const name of ['mousedown','pointerdown','click','keydown','keyup']) panel.addEventListener(name, e => e.stopPropagation())
    search.onclick = async () => { if (controller || !query.value.trim()) return; if (!cfg.apiKey.trim()) { status.textContent = '请在总设置中填写 API 密钥'; return }; data = corpus(api.store.ensureStore(), cfg, query.value); countLabel.textContent = `可检索 ${data.chars.toLocaleString()} 字符 · 本次发送候选 ${data.candidateChars.toLocaleString()} 字符 · ${data.items.length} 条`; controller = new AbortController(); search.disabled = true; output.classList.add('open'); outputToggle.textContent = '隐藏输出'; output.replaceChildren(); status.innerHTML = '<span class="qcl-spinner"></span> 正在检索…';
        try { const prompt = '你是命令收藏夹检索助手。仅从资料选择相关已有命令，不生成命令。返回纯 JSON：{"matches":[{"id":1,"reason":"匹配原因"}]}，最多10条。用户需求：' + query.value.trim() + '\n命令资料：' + data.text; const answer = await request(cfg, prompt, controller.signal); if (closed) return; const matches = parseMatches(answer, data); status.textContent = matches.length ? `找到 ${matches.length} 条命令` : '没有找到相关命令'; for (const {cmd,reason} of matches) { const row=el('article',output); el('h4',row,(cmd.name||'未命名')+' · '+(cmd.group||'未分组')); el('p',row,reason); el('pre',row,cmd.text||''); const copy=el('button',row,'复制命令'); copy.onclick=async()=>{try{await navigator.clipboard.writeText(cmd.text||'');copy.textContent='已复制'}catch(_){}} } } catch(e) { if (!closed) status.textContent='检索失败：'+String(e.message).split(cfg.apiKey).join('[密钥已隐藏]') } finally { controller=null; if(!closed) search.disabled=false } }
    query.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); search.click() } }; query.focus()
}

module.exports = { settings, saveSettings, corpus, request, parseMatches, open }
