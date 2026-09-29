import assert from 'node:assert'
import { readDb, writeDb } from '../src/mocks/db'
import { api } from '../src/api/http'
import type { DifferenceRegion } from '../src/types'

void (async () => {
  const store = new Map<string, string>()
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  ;(globalThis as any).window = { setTimeout }

  // 重置为种子数据
  const db = readDb()
  writeDb(db)

  const runId = 'run-1048' // 结算页，含 1 个高风险区域
  const before = readDb()
  const baselineCountBefore = before.baselines.length
  const activeBefore = before.baselines.filter((b) => b.active).length

  const regions = (): DifferenceRegion[] =>
    readDb().runs.find((r) => r.id === runId)!.regions.map((r) => ({ ...r }))

  // 1. 高风险未处理 -> 批准被拒，错误信息指出具体区域
  const withHigh = regions()
  await assert.rejects(
    () =>
      api.patch(`/runs/${runId}/review`, {
        category: 'design-change',
        decision: 'approved',
        reviewer: '测试员',
        reason: '尝试批准但还有高风险区域没有处理掉哦',
        regions: withHigh,
      }),
    (err: Error) => {
      assert.ok(err.message.includes('高风险区域'), err.message)
      assert.ok(err.message.includes('布局位移'), err.message)
      assert.ok(err.message.includes('11%, 18%'), err.message)
      return true
    },
  )
  let after = readDb()
  assert.equal(after.baselines.length, baselineCountBefore, '拒绝批准后不产生新基线')
  const runAfterBlock = after.runs.find((r) => r.id === runId)!
  assert.equal(runAfterBlock.status, 'pending', '状态保持待审批')
  assert.equal(runAfterBlock.review, undefined, '未写入审批记录')

  // 2. 驳回 -> 保留原基线（不新增、不停用），但记录审批结果与区域快照
  const rejectedRegions = regions()
  await api.patch(`/runs/${runId}/review`, {
    category: 'render-error',
    decision: 'rejected',
    reviewer: '测试员',
    reason: '主操作区错位，驳回等待开发修复后重新截图',
    regions: rejectedRegions,
  })
  after = readDb()
  assert.equal(after.baselines.length, baselineCountBefore, '驳回不新增基线')
  assert.equal(after.baselines.filter((b) => b.active).length, activeBefore, '驳回不停用原基线')
  const rejectedRun = after.runs.find((r) => r.id === runId)!
  assert.equal(rejectedRun.status, 'rejected')
  assert.ok(rejectedRun.review?.regions?.length === 3, '驳回也固化区域快照')

  // 3. 处理掉高风险（人工忽略，带依据）后批准 -> 新基线可追溯采用/忽略区域
  const pendingRun = readDb().runs.find((r) => r.id === runId)!
  pendingRun.status = 'pending'
  pendingRun.review = undefined
  writeDb(readDb())
  const toApprove = regions().map((r) =>
    r.severity === 'high'
      ? {
          ...r,
          ignored: true,
          ignoredBy: 'manual' as const,
          ignoredReason: '设计稿 DS-401 已确认改版',
          ignoredAt: new Date().toISOString(),
        }
      : r,
  )
  const approved = await api.patch(`/runs/${runId}/review`, {
    category: 'design-change',
    decision: 'approved',
    reviewer: '测试员',
    reason: '高风险区域已核对设计稿确认忽略，其余差异符合预期，批准为新基线',
    regions: toApprove,
  })
  assert.equal(approved.data.status, 'approved')
  after = readDb()
  assert.equal(after.baselines.length, baselineCountBefore + 1, '批准新增一条基线')
  const newBaseline = after.baselines[0]
  assert.equal(newBaseline.active, true)
  assert.equal(newBaseline.runId, runId)
  assert.equal(newBaseline.adoptedRegions.length, 1, '采用 1 处（中风险 r2）')
  assert.equal(newBaseline.ignoredRegions.length, 2, '忽略 2 处（人工高风险 + 规则时间区域）')
  const manual = newBaseline.ignoredRegions.find((s) => s.regionId === '1048-r1')
  assert.equal(manual!.ignoredBy, 'manual')
  assert.equal(manual!.ignoredReason, '设计稿 DS-401 已确认改版')
  const ruleIgnored = newBaseline.ignoredRegions.find((s) => s.regionId === '1048-r3')
  assert.equal(ruleIgnored!.ignoredBy, 'rule')
  assert.equal(ruleIgnored!.ruleId, 'rule-time')
  assert.equal(ruleIgnored!.ruleName, '动态时间区域', '规则名称随快照固化')
  const adoptedRun = after.runs.find((r) => r.id === runId)!
  assert.deepEqual(
    adoptedRun.review!.regions!.map((s) => s.regionId).sort(),
    newBaseline.adoptedRegions
      .concat(newBaseline.ignoredRegions)
      .map((s) => s.regionId)
      .sort(),
    '运行记录与新基线区域一致',
  )
  // 原基线被停用但保留
  const oldBaseline = after.baselines.find((b) => b.id === 'base-commerce-checkout')
  assert.equal(oldBaseline!.active, false)

  // 4. 服务端强制规则归类：即使前端把规则区域标记成待判定，提交时仍归为规则忽略
  pendingRun.status = 'pending'
  pendingRun.review = undefined
  writeDb(readDb())
  const tampered = regions().map((r) =>
    r.severity === 'high'
      ? { ...r, ignored: true, ignoredBy: 'manual' as const, ignoredReason: 'x'.repeat(8) }
      : { ...r, ignored: false, ignoredBy: undefined, ruleId: undefined },
  )
  const r3 = tampered.find((r) => r.id === '1048-r3')!
  r3.ignored = false
  r3.ignoredBy = undefined
  r3.ruleId = undefined
  await api.patch(`/runs/${runId}/review`, {
    category: 'environment-noise',
    decision: 'approved',
    reviewer: '测试员',
    reason: '验证服务端规则归类不可被前端绕过需要八个字',
    regions: tampered,
  })
  const finalRun = readDb().runs.find((r) => r.id === runId)!
  const finalR3 = finalRun.review!.regions!.find((s) => s.regionId === '1048-r3')!
  assert.equal(finalR3.adopted, false)
  assert.equal(finalR3.ignoredBy, 'rule', '服务端重新应用规则')

  console.log('mock api tests passed')
})()
