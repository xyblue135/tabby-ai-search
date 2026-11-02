'use strict'

/**
 * Quick Commands Lite —— 纯逻辑层。
 * 不依赖 Angular / DOM，可单独用 node 跑测试（见 test/logic.test.js）。
 */

const CONTROL_RE = /\\x([0-9a-f]{2})/gi
const DELAY_RE = /^\\s(\d+)/
const MAX_DELAY = 60000

/** `\xHH` -> 对应控制字符 */
function decodeControl (text) {
    return String(text == null ? '' : text).replace(
        CONTROL_RE,
        (_, hex) => String.fromCharCode(parseInt(hex, 16))
    )
}

/**
 * config 里的终止符设置 -> 实际发送的字符。
 * 默认 '\r'：与手动敲回车完全一致，Windows / Linux / SSH / 串口都认。
 */
function terminatorFor (mode) {
    switch (mode) {
        case 'lf':
            return '\n'
        case 'crlf':
            return '\r\n'
        case 'cr':
        default:
            return '\r'
    }
}

/**
 * 把一条命令编译成发送步骤。
 *
 * 逐行模式（文本里出现 `\s毫秒` 延时行时启用，保持旧版语义）：
 *   每行单独发送并回车，`\s` 行变成延时。
 * 整段模式（默认）：
 *   整段文本一次性发送，内部换行统一转换成终止符。
 *   这样 `for ... do ... done`、`\` 续行、heredoc 不会被拆散。
 *
 * @returns {{data?: string, delay?: number, gap?: boolean}[]}
 */
function buildSendPlan (text, options) {
    const opts = options || {}
    const terminator = opts.terminator || '\r'
    const appendCR = opts.appendCR === true
    const raw = String(text == null ? '' : text)
    const lines = raw.split(/\r\n|\r|\n/)
    const steps = []

    if (lines.some(line => DELAY_RE.test(line))) {
        if (!appendCR) {
            throw new Error('含延时步骤的命令需要先开启全局“发送后自动回车”')
        }
        for (const line of lines) {
            const delay = DELAY_RE.exec(line)
            if (delay) {
                const ms = Math.min(parseInt(delay[1], 10), MAX_DELAY)
                if (ms > 0) {
                    steps.push({ delay: ms })
                }
                continue
            }
            if (!line.trim()) {
                continue
            }
            steps.push({ data: decodeControl(line) + terminator, gap: true })
        }
        return steps
    }

    const body = decodeControl(raw).replace(/[\r\n]+$/, '')
    if (!body.trim()) {
        return []
    }
    if (!appendCR) {
        return [{ data: body }]
    }
    // 内部换行统一换成"回车"。顺手吃掉续行行首的缩进：
    // 否则行首的 TAB 会被 shell 当成补全键，把命令补坏。
    // heredoc（<<）里的内容要原样保留，此时不动缩进。
    const normalized = /<</.test(body)
        ? body.replace(/\r\n|\r|\n/g, terminator)
        : body.replace(/\r?\n[ \t]*/g, terminator)
    return [{ data: normalized + terminator }]
}

/** 列表里显示的紧凑预览 */
function preview (text, max) {
    const limit = max || 200
    const flat = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
    return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

/** 相对时间："刚刚" / "N 分钟前" / ...；超过 30 天显示日期。ts 为空返回 '' */
function relativeTime (ts, now) {
    const time = Number(ts)
    if (!time) {
        return ''
    }
    const ref = Number(now) || Date.now()
    const diff = Math.max(0, ref - time)
    const MINUTE = 60000
    const HOUR = 3600000
    const DAY = 86400000
    if (diff < MINUTE) {
        return '刚刚'
    }
    if (diff < HOUR) {
        return `${Math.floor(diff / MINUTE)} 分钟前`
    }
    if (diff < DAY) {
        return `${Math.floor(diff / HOUR)} 小时前`
    }
    if (diff < DAY * 30) {
        return `${Math.floor(diff / DAY)} 天前`
    }
    const date = new Date(time)
    const pad = value => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function tokenize (query) {
    return String(query == null ? '' : query)
        .toLocaleLowerCase()
        .split(/\s+/)
        .filter(Boolean)
}

/** needle 的字符是否按顺序出现在 haystack 里（都是小写） */
function isSubsequence (haystack, needle) {
    let index = 0
    for (const ch of needle) {
        index = haystack.indexOf(ch, index)
        if (index < 0) {
            return false
        }
        index++
    }
    return true
}

function scoreEntry (entry, tokens) {
    let score = 0
    for (const token of tokens) {
        if (entry.nameLower.startsWith(token)) {
            score += 12
        } else if (entry.nameLower.includes(token)) {
            score += 8
        }
        if (entry.groupLower.includes(token)) {
            score += 3
        }
        if (entry.textLower.includes(token)) {
            score += 1
        }
    }
    return score
}

/**
 * 找出与一段命令文本最相似的收藏（用于"整理记忆"里的关联提示）。
 * 拿文本的前几个关键词给收藏打分，名称命中权重最高；不够相似返回 null。
 */
function findSimilarFavorite (index, text, threshold) {
    const tokens = tokenize(text).slice(0, 8)
    if (!tokens.length) {
        return null
    }
    let best = null
    let bestScore = 0
    for (const entry of index) {
        const score = scoreEntry(entry, tokens)
        if (score > bestScore) {
            bestScore = score
            best = entry
        }
    }
    if (!best || bestScore < (threshold || 10)) {
        return null
    }
    return { name: String(best.cmd.name || '未命名命令'), score: bestScore }
}

/**
 * 搜索 / 过滤命令。
 * 与旧版相比：支持多关键词（全部命中才算匹配，空格分隔），
 * 可选按相关度排序 + 名称子序列模糊匹配。
 */
function matchCommands (index, query, group, limit, options) {
    const opts = options || {}
    const tokens = tokenize(query)
    const max = limit > 0 ? limit : index.length
    const pool = opts.rank ? Math.max(max, opts.pool || 400) : max
    const items = []
    let total = 0

    for (const entry of index) {
        if (group !== null && group !== undefined && (entry.cmd.group || '') !== group) {
            continue
        }
        if (tokens.length) {
            const hit = tokens.every(token => entry.haystack.includes(token))
            // 模糊兜底只对 3 个字符以上的缩写生效，避免 "ps" 这种短词误命中 docker_compose
            const fuzzyHit = opts.fuzzy &&
                tokens.every(token => token.length >= 3 && isSubsequence(entry.nameLower, token))
            if (!hit && !fuzzyHit) {
                continue
            }
        }
        total++
        if (items.length < pool) {
            items.push({ entry, score: tokens.length ? scoreEntry(entry, tokens) : 0 })
        }
    }

    if (opts.rank && tokens.length) {
        items.sort((a, b) => b.score - a.score || a.entry.order - b.entry.order)
    }
    return {
        items: items.slice(0, max).map(x => x.entry.cmd),
        total,
    }
}

/** 历史记录：去重、限长、最新在前。条目为 {text, count, ts} 对象，兼容旧的纯字符串数据 */
function pushHistoryEntry (history, text, size) {
    const value = String(text == null ? '' : text).trim()
    if (!value) {
        return normalizeHistory(history).slice()
    }
    const previous = normalizeHistory(history)
    const next = previous.filter(item => item.text !== value)
    const existing = previous.find(item => item.text === value)
    next.unshift(existing
        ? { text: value, count: (existing.count || 1) + 1, ts: Date.now() }
        : { text: value, count: 1, ts: Date.now() })
    return next.slice(0, size > 0 ? size : 500)
}

/**
 * 旧版历史是纯字符串数组，1.4.0 起是 {text, count, ts} 对象。
 * 已是对象数组时原样返回（每秒心跳都会调用，避免无谓的重建）。
 */
function normalizeHistory (history) {
    if (!Array.isArray(history)) {
        return []
    }
    let needs = false
    for (const item of history) {
        if (!item || typeof item !== 'object' || typeof item.text !== 'string') {
            needs = true
            break
        }
    }
    if (!needs) {
        return history
    }
    const next = []
    for (const item of history) {
        if (typeof item === 'string' && item.trim()) {
            next.push({ text: item.trim(), count: 1, ts: null })
        } else if (item && typeof item === 'object' && typeof item.text === 'string' && item.text.trim()) {
            next.push({
                text: item.text.trim(),
                count: Number(item.count) > 0 ? Number(item.count) : 1,
                ts: Number(item.ts) || null,
            })
        }
    }
    return next
}

module.exports = {
    decodeControl,
    terminatorFor,
    buildSendPlan,
    preview,
    relativeTime,
    tokenize,
    isSubsequence,
    matchCommands,
    scoreEntry,
    findSimilarFavorite,
    pushHistoryEntry,
    normalizeHistory,
}
