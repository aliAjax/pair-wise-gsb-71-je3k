import type {
  DifferenceRegion,
  IgnoreRule,
  RegionSnapshot,
  ScreenshotRun,
} from '@/types'

export const severityLabel = (severity: RegionSnapshot['severity']) =>
  severity === 'high' ? '高风险' : severity === 'medium' ? '中风险' : '低风险'

export const kindLabel = (kind: RegionSnapshot['kind']) =>
  kind === 'layout'
    ? '布局位移'
    : kind === 'color'
      ? '色彩变化'
      : kind === 'content'
        ? '内容变更'
        : '环境噪声'

export const regionPosition = (
  region: Pick<RegionSnapshot, 'x' | 'y' | 'width' | 'height'>,
) => `区域 ${region.x}%, ${region.y}% · ${region.width}% × ${region.height}%`

const wildcardMatch = (pattern: string, value: string) => {
  const source = (pattern ?? '*').trim() || '*'
  if (source === '*') return true
  const escaped = source
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(value)
}

/** 判断某条启用规则是否命中指定运行中的某个差异区域。 */
export const regionMatchesRule = (
  run: Pick<ScreenshotRun, 'projectId' | 'page' | 'device'>,
  region: DifferenceRegion,
  rule: IgnoreRule,
) => {
  if (!rule.enabled) return false
  if (rule.projectId !== 'all' && rule.projectId !== run.projectId) return false
  if (!wildcardMatch(rule.pagePattern, run.page)) return false
  if (!wildcardMatch(rule.devicePattern, run.device)) return false
  // 规则以 DOM 选择器为粒度：区域必须带有匹配的选择器，或已标记归属该规则
  const selectorHit = region.selector === rule.selector || region.ruleId === rule.id
  if (!selectorHit) return false
  if (typeof region.delta === 'number' && region.delta > rule.maxDelta) return false
  return true
}

/**
 * 按启用规则重算区域归属：命中的区域强制归入“规则忽略”，
 * 原规则忽略但规则已停用/不再命中的区域恢复为待判定。人工忽略不受影响。
 */
export const applyRulesToRegions = (
  run: Pick<ScreenshotRun, 'projectId' | 'page' | 'device'>,
  regions: DifferenceRegion[],
  rules: IgnoreRule[],
): DifferenceRegion[] => {
  const activeRules = rules.filter((rule) => rule.enabled)
  return regions.map((region) => {
    const matched = activeRules.find((rule) => regionMatchesRule(run, region, rule))
    if (matched) {
      return {
        ...region,
        ignored: true,
        ignoredBy: 'rule',
        ruleId: matched.id,
        ignoredReason: `命中启用规则「${matched.name}」`,
      }
    }
    if (region.ignoredBy === 'rule') {
      const { ruleId: _ruleId, ignoredReason: _reason, ...rest } = region
      return { ...rest, ignored: false, ignoredBy: undefined }
    }
    return region
  })
}

export const ruleNameOf = (ruleId: string | undefined, rules: IgnoreRule[]) =>
  rules.find((rule) => rule.id === ruleId)?.name

/** 把提交时的区域状态固化为可追溯快照，规则名称一并落库，避免后续规则改名/删除导致断链。 */
export const buildRegionSnapshots = (
  regions: DifferenceRegion[],
  rules: IgnoreRule[],
): RegionSnapshot[] =>
  regions.map((region) => {
    const snapshot: RegionSnapshot = {
      regionId: region.id,
      kind: region.kind,
      severity: region.severity,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      pixels: region.pixels,
      adopted: !region.ignored,
    }
    if (region.ignored) {
      snapshot.ignoredBy = region.ignoredBy ?? 'manual'
      snapshot.ignoredReason =
        region.ignoredReason ??
        (snapshot.ignoredBy === 'rule' ? '命中忽略规则' : '评审人工忽略')
      if (region.ruleId) {
        snapshot.ruleId = region.ruleId
        snapshot.ruleName = ruleNameOf(region.ruleId, rules)
      }
    }
    return snapshot
  })

export const highRiskRegions = (regions: DifferenceRegion[]) =>
  regions.filter((region) => region.severity === 'high' && !region.ignored)
