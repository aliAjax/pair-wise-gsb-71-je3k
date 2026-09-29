import assert from 'node:assert'
import { applyRulesToRegions, buildRegionSnapshots, highRiskRegions } from '../src/utils/rules'
import type { DifferenceRegion, IgnoreRule, ScreenshotRun } from '../src/types'

const rules: IgnoreRule[] = [
  {
    id: 'rule-time',
    name: '动态时间区域',
    projectId: 'all',
    selector: '[data-visual-ignore="relative-time"]',
    pagePattern: '*',
    devicePattern: '*',
    maxDelta: 12,
    enabled: true,
    createdAt: '',
  },
  {
    id: 'rule-disabled',
    name: '已停用规则',
    projectId: 'all',
    selector: '.x',
    pagePattern: '*',
    devicePattern: '*',
    maxDelta: 12,
    enabled: false,
    createdAt: '',
  },
]

const run: Pick<ScreenshotRun, 'projectId' | 'page' | 'device'> = {
  projectId: 'p-commerce',
  page: '订单结算页',
  device: 'Desktop 1440',
}

const regions: DifferenceRegion[] = [
  { id: 'r1', x: 1, y: 1, width: 1, height: 1, severity: 'high', pixels: 100, kind: 'layout', ignored: false, delta: 40 },
  { id: 'r2', x: 2, y: 2, width: 1, height: 1, severity: 'medium', pixels: 50, kind: 'color', ignored: false, delta: 18 },
  {
    id: 'r3',
    x: 3,
    y: 3,
    width: 1,
    height: 1,
    severity: 'low',
    pixels: 10,
    kind: 'environment',
    ignored: true,
    selector: '[data-visual-ignore="relative-time"]',
    delta: 8,
  },
  {
    id: 'r4',
    x: 4,
    y: 4,
    width: 1,
    height: 1,
    severity: 'medium',
    pixels: 20,
    kind: 'color',
    ignored: true,
    ignoredBy: 'manual',
    ignoredReason: '人工测试',
    delta: 100,
  },
]

// 1. 命中启用规则的区域自动归为规则忽略；人工忽略保持不变
const resolved = applyRulesToRegions(run, regions, rules)
const byId = Object.fromEntries(resolved.map((r) => [r.id, r]))
assert.equal(byId.r1.ignored, false, '高风险区域保持待判定')
assert.equal(byId.r3.ignored, true)
assert.equal(byId.r3.ignoredBy, 'rule')
assert.equal(byId.r3.ruleId, 'rule-time')
assert.ok(byId.r3.ignoredReason!.includes('动态时间区域'))
assert.equal(byId.r4.ignoredBy, 'manual', '人工忽略不被规则覆盖')
assert.equal(byId.r4.ignoredReason, '人工测试')

// 2. 规则停用后，原规则忽略区域恢复待判定；人工忽略不受影响
const disabled = applyRulesToRegions(
  run,
  resolved,
  rules.map((r) => (r.id === 'rule-time' ? { ...r, enabled: false } : r)),
)
const disabledById = Object.fromEntries(disabled.map((r) => [r.id, r]))
assert.equal(disabledById.r3.ignored, false, '规则停用后恢复')
assert.equal(disabledById.r3.ignoredBy, undefined)
assert.equal(disabledById.r3.ruleId, undefined)
assert.equal(disabledById.r4.ignored, true)

// 3. maxDelta 超限不命中
const strictRules = [{ ...rules[0], maxDelta: 3 }]
const overDelta = applyRulesToRegions(run, [regions[2]], strictRules)
assert.equal(overDelta[0].ignoredBy, undefined, '超色差不命中')

// 4. 高风险阻断
assert.equal(highRiskRegions(resolved).map((r) => r.id).join(','), 'r1')
assert.equal(highRiskRegions(applyRulesToRegions(run, [{ ...regions[0], ignored: true, ignoredBy: 'manual' }], rules)).length, 0)

// 5. 快照
const snapshots = buildRegionSnapshots(resolved, rules)
const snapById = Object.fromEntries(snapshots.map((s) => [s.regionId, s]))
assert.equal(snapById.r1.adopted, true)
assert.equal(snapById.r1.ignoredBy, undefined)
assert.equal(snapById.r3.adopted, false)
assert.equal(snapById.r3.ignoredBy, 'rule')
assert.equal(snapById.r3.ruleName, '动态时间区域', '规则名称固化')
assert.equal(snapById.r4.adopted, false)
assert.equal(snapById.r4.ignoredBy, 'manual')
assert.equal(snapById.r4.ignoredReason, '人工测试')

// 6. 无选择器信息的区域不得被通配规则误匹配
const anonymous = applyRulesToRegions(run, [regions[0]], rules)
assert.equal(anonymous[0].ignoredBy, undefined, '无选择器/规则归属的区域不命中通配规则')

// 7. 规则改名不影响已固化快照
const renamed = buildRegionSnapshots(resolved, [{ ...rules[0], name: '改名后' }])
const r3snap = renamed.find((s) => s.regionId === 'r3')!
assert.equal(r3snap.ruleName, '改名后')

console.log('utils tests passed')
