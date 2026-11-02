'use strict'

/* eslint-disable no-console */

const assert = require('assert')
const logic = require('../dist/logic')

let passed = 0
const failures = []

function test (name, fn) {
    try {
        fn()
        passed++
        console.log(`  ok  ${name}`)
    } catch (error) {
        failures.push({ name, error })
        console.log(`FAIL  ${name}\n      ${error.message}`)
    }
}

const data = steps => steps.map(step => (step.delay ? `delay(${step.delay})` : step.data.replace(/\r/g, '\\r').replace(/\n/g, '\\n')))

console.log('buildSendPlan')

test('单行命令：整段发送 + 一个回车', () => {
    const steps = logic.buildSendPlan('docker ps -a', { appendCR: true, terminator: '\r' })
    assert.deepStrictEqual(data(steps), ['docker ps -a\\r'])
})

test('多行 for 循环整段发送，不被拆散', () => {
    const text = 'for CPUFREQ in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do\n\t[ -f $CPUFREQ ] || continue\n\techo -n performance > $CPUFREQ\ndone'
    const steps = logic.buildSendPlan(text, { appendCR: true, terminator: '\r' })
    assert.strictEqual(steps.length, 1)
    assert.ok(!steps[0].data.includes('\n'), '不应该残留裸 LF')
    assert.strictEqual(steps[0].data, 'for CPUFREQ in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do\r[ -f $CPUFREQ ] || continue\recho -n performance > $CPUFREQ\rdone\r')
})

test('续行行首缩进被吃掉（TAB 会被 shell 当补全键）', () => {
    const steps = logic.buildSendPlan('if true; then\n    echo hi\nfi', { appendCR: true, terminator: '\r' })
    assert.strictEqual(steps[0].data, 'if true; then\recho hi\rfi\r')
    assert.ok(!steps[0].data.includes('\t'))
})

test('heredoc 内容保持原样（不吞缩进）', () => {
    const text = 'cat <<EOF\n  indented line\nEOF'
    const steps = logic.buildSendPlan(text, { appendCR: true, terminator: '\r' })
    assert.strictEqual(steps[0].data, 'cat <<EOF\r  indented line\rEOF\r')
})

test('反斜杠续行整段发送', () => {
    const text = 'curl -X POST 192.168.3.100:5003/receive \\\n  -H "Content-Type: application/json" \\\n  -d \'{"k":"v"}\''
    const steps = logic.buildSendPlan(text, { appendCR: true, terminator: '\r' })
    assert.strictEqual(steps.length, 1)
    assert.ok(steps[0].data.includes('-H "Content-Type'))
})

test('末尾已有换行时不重复补回车', () => {
    const steps = logic.buildSendPlan('ls\n', { appendCR: true, terminator: '\r' })
    assert.deepStrictEqual(data(steps), ['ls\\r'])
})

test('appendCR=false：原样发送，不加回车（末尾换行被去除）', () => {
    const steps = logic.buildSendPlan('echo 1\necho 2\n', { appendCR: false, terminator: '\r' })
    assert.strictEqual(steps.length, 1)
    assert.strictEqual(steps[0].data, 'echo 1\necho 2', '1.3.0 起关闭自动回车会去掉末尾换行')
})

test('\\xHH 控制字符解码', () => {
    const steps = logic.buildSendPlan('echo hi\\x03', { appendCR: true, terminator: '\r' })
    assert.strictEqual(steps[0].data, 'echo hi\x03\r')
})

test('\\s 延时行走逐行模式', () => {
    const text = 'echo one\n\\s300\necho two'
    const steps = logic.buildSendPlan(text, { appendCR: true, terminator: '\r' })
    assert.deepStrictEqual(data(steps), ['echo one\\r', 'delay(300)', 'echo two\\r'])
    assert.ok(steps[0].gap, '多步发送之间应有间隔')
})

test('延时不超出上限', () => {
    const steps = logic.buildSendPlan('\\s99999999\necho x', { appendCR: true, terminator: '\r' })
    assert.strictEqual(steps[0].delay, 60000)
})

test('空内容不产生任何步骤', () => {
    assert.deepStrictEqual(logic.buildSendPlan('', { appendCR: true }), [])
    assert.deepStrictEqual(logic.buildSendPlan('   \n\n', { appendCR: true }), [])
})

test('terminatorFor 三种模式', () => {
    assert.strictEqual(logic.terminatorFor('cr'), '\r')
    assert.strictEqual(logic.terminatorFor('lf'), '\n')
    assert.strictEqual(logic.terminatorFor('crlf'), '\r\n')
    assert.strictEqual(logic.terminatorFor(undefined), '\r')
    assert.strictEqual(logic.terminatorFor('bogus'), '\r')
})

test('CRLF 模式下内部换行也用 CRLF', () => {
    const steps = logic.buildSendPlan('a\nb', { appendCR: true, terminator: '\r\n' })
    assert.strictEqual(steps[0].data, 'a\r\nb\r\n')
})

console.log('matchCommands')

const entries = [
    { id: '1', name: '查看 Docker 容器', group: '20_Docker', text: 'docker ps -a', appendCR: true },
    { id: '2', name: 'docker compose 起服务', group: '20_Docker', text: 'docker compose up -d', appendCR: true },
    { id: '3', name: '看温度', group: '10_系统', text: 'watch sensors', appendCR: true },
    { id: '4', name: '未分组命令', group: '', text: 'echo hi', appendCR: true },
].map((cmd, order) => ({
    cmd,
    order,
    nameLower: cmd.name.toLocaleLowerCase(),
    groupLower: cmd.group.toLocaleLowerCase(),
    textLower: cmd.text.toLocaleLowerCase(),
    haystack: `${cmd.name}\n${cmd.group}\n${cmd.text}`.toLocaleLowerCase(),
}))

test('多关键词需要全部命中', () => {
    const hit = logic.matchCommands(entries, 'docker compose', null, 10, { rank: true })
    assert.deepStrictEqual(hit.items.map(x => x.id), ['2'])
    const miss = logic.matchCommands(entries, 'docker 温度', null, 10, { rank: true })
    assert.strictEqual(miss.items.length, 0)
})

test('命中名称 / 分组 / 内容', () => {
    assert.strictEqual(logic.matchCommands(entries, '温度', null, 10, {}).items[0].id, '3')
    assert.strictEqual(logic.matchCommands(entries, '20_docker', null, 10, {}).items.length, 2)
    assert.strictEqual(logic.matchCommands(entries, 'ps -a', null, 10, {}).items[0].id, '1')
})

test('分组过滤（含未分组 = 空字符串）', () => {
    assert.strictEqual(logic.matchCommands(entries, '', '20_Docker', 10, {}).total, 2)
    assert.strictEqual(logic.matchCommands(entries, '', '', 10, {}).total, 1)
    assert.strictEqual(logic.matchCommands(entries, '', null, 10, {}).total, 4)
})

test('total 不受 limit 影响', () => {
    const result = logic.matchCommands(entries, '', null, 2, {})
    assert.strictEqual(result.items.length, 2)
    assert.strictEqual(result.total, 4)
})

test('rank 时按相关度排序（名称命中优先）', () => {
    const result = logic.matchCommands(entries, 'docker', null, 10, { rank: true })
    assert.strictEqual(result.items[0].id, '2')
})

test('非 rank 时保持原顺序（管理器列表用）', () => {
    const result = logic.matchCommands(entries, 'docker', null, 10, { rank: false })
    assert.deepStrictEqual(result.items.map(x => x.id), ['1', '2'])
})

test('rank 时支持名称子序列模糊匹配', () => {
    const result = logic.matchCommands(entries, 'dps', null, 10, { rank: true, fuzzy: true })
    assert.ok(result.items.some(x => x.id === '1') || result.items.some(x => x.id === '2'), 'dps 应能匹配到 docker ps')
})

test('大小写不敏感', () => {
    assert.strictEqual(logic.matchCommands(entries, 'DOCKER PS', null, 10, {}).items[0].id, '1')
})

console.log('历史记忆（1.4.0 对象条目）')

test('pushHistoryEntry：去重合并次数、置顶、限长', () => {
    let history = []
    history = logic.pushHistoryEntry(history, 'a', 500)
    history = logic.pushHistoryEntry(history, 'b', 500)
    history = logic.pushHistoryEntry(history, 'a', 500)
    assert.strictEqual(history.length, 2)
    assert.deepStrictEqual(history[0], { text: 'a', count: 2, ts: history[0].ts })
    assert.ok(typeof history[0].ts === 'number', '应有时间戳')
    assert.strictEqual(history[1].text, 'b')
    assert.strictEqual(history[1].count, 1)
})

test('pushHistoryEntry：容量上限', () => {
    let history = []
    for (let i = 0; i < 600; i++) {
        history = logic.pushHistoryEntry(history, `cmd-${i}`, 500)
    }
    assert.strictEqual(history.length, 500)
    assert.strictEqual(history[0].text, 'cmd-599')
})

test('pushHistoryEntry：兼容旧的字符串历史', () => {
    const history = logic.pushHistoryEntry(['old'], 'new', 500)
    assert.strictEqual(history[0].text, 'new')
    assert.strictEqual(history[1].text, 'old')
    assert.ok(typeof history[1] === 'object', '旧字符串应被迁移为对象')
})

test('pushHistoryEntry：空文本原样返回', () => {
    const history = [{ text: 'a', count: 1, ts: 1 }]
    assert.deepStrictEqual(logic.pushHistoryEntry(history, '   ', 500), history)
})

test('normalizeHistory：字符串数组迁移、坏数据剔除、幂等', () => {
    const migrated = logic.normalizeHistory(['ls -la', 'docker ps', '', null])
    assert.strictEqual(migrated.length, 2)
    assert.deepStrictEqual(migrated[0], { text: 'ls -la', count: 1, ts: null })

    const objects = [{ text: 'a', count: 2, ts: 5 }]
    assert.strictEqual(logic.normalizeHistory(objects), objects, '已是对象数组时原样返回')

    assert.deepStrictEqual(logic.normalizeHistory(null), [])
    assert.deepStrictEqual(logic.normalizeHistory('nope'), [])
    const broken = [{ text: 'ok', count: 1 }, { nope: true }, 'plain']
    const fixed = logic.normalizeHistory(broken)
    assert.deepStrictEqual(fixed.map(x => x.text), ['ok', 'plain'])
})

console.log('整理记忆的相似提示与相对时间')

test('findSimilarFavorite：名称命中返回，不相似返回 null', () => {
    const index = [{
        cmd: { name: 'docker 日志', text: 'docker logs -f x', group: '' },
        nameLower: 'docker 日志', groupLower: '', textLower: 'docker logs -f x',
    }]
    const similar = logic.findSimilarFavorite(index, 'docker logs -f x --tail 100')
    assert.ok(similar && similar.name === 'docker 日志')
    assert.strictEqual(logic.findSimilarFavorite(index, 'completely unrelated'), null)
    assert.strictEqual(logic.findSimilarFavorite(index, ''), null)
})

test('relativeTime：各档位与空值', () => {
    const now = Date.UTC(2026, 0, 10, 12, 0, 0)
    const MIN = 60000
    assert.strictEqual(logic.relativeTime(null), '')
    assert.strictEqual(logic.relativeTime(now - 30 * 1000, now), '刚刚')
    assert.strictEqual(logic.relativeTime(now - 5 * MIN, now), '5 分钟前')
    assert.strictEqual(logic.relativeTime(now - 3 * 60 * MIN, now), '3 小时前')
    assert.strictEqual(logic.relativeTime(now - 2 * 24 * 60 * MIN, now), '2 天前')
    assert.match(logic.relativeTime(now - 40 * 24 * 60 * MIN, now), /^\d{4}-\d{2}-\d{2}$/)
})

test('scoreEntry：名称命中权重高于正文命中', () => {
    const entry = { nameLower: 'docker 日志', groupLower: '', textLower: 'docker logs' }
    assert.ok(logic.scoreEntry(entry, ['docker']) > 0)
    assert.ok(logic.scoreEntry(entry, ['docker']) > logic.scoreEntry(entry, ['logs']))
})

test('preview 折叠空白并截断', () => {
    assert.strictEqual(logic.preview('a\n\n  b\tc'), 'a b c')
    assert.strictEqual(logic.preview('abcdef', 3), 'abc…')
    assert.strictEqual(logic.preview(null), '')
})

console.log('')
console.log(`通过 ${passed} 项，失败 ${failures.length} 项`)
if (failures.length) {
    for (const failure of failures) {
        console.log(`\n${failure.name}:\n${failure.error.stack}`)
    }
    process.exit(1)
}
process.exit(0)
