import type {
  DifferenceRegion,
  IgnoreRule,
  RegionDisposition,
  ReviewedRegion,
  ScreenshotRun,
} from '@/types'

export const kindLabels: Record<DifferenceRegion['kind'], string> = {
  layout: '布局位移',
  color: '色彩变化',
  content: '内容变更',
  environment: '环境噪声',
}

export const kindLabel = (kind: DifferenceRegion['kind']): string => kindLabels[kind]

export const dispositionLabels: Record<RegionDisposition, string> = {
  pending: '待判定',
  adopted: '已采用',
  'ignored-manual': '手动忽略',
  'ignored-rule': '规则忽略',
}

export const isIgnoredDisposition = (disposition: RegionDisposition): boolean =>
  disposition === 'ignored-manual' || disposition === 'ignored-rule'

const matchesPattern = (pattern: string, value: string): boolean => {
  const trimmed = pattern.trim()
  if (!trimmed || trimmed === '*') return true
  if (trimmed.endsWith('*')) return value.startsWith(trimmed.slice(0, -1))
  return trimmed === value
}

export const ruleCoversRun = (
  rule: IgnoreRule,
  run: Pick<ScreenshotRun, 'projectId' | 'page' | 'device'>,
): boolean =>
  (rule.projectId === 'all' || rule.projectId === run.projectId) &&
  matchesPattern(rule.pagePattern, run.page) &&
  matchesPattern(rule.devicePattern, run.device)

export const findEnabledRule = (
  region: DifferenceRegion,
  rules: IgnoreRule[],
  run: Pick<ScreenshotRun, 'projectId' | 'page' | 'device'>,
): IgnoreRule | undefined =>
  region.ruleId
    ? rules.find((rule) => rule.id === region.ruleId && rule.enabled && ruleCoversRun(rule, run))
    : undefined

/**
 * 命中启用规则的区域自动归为规则忽略；规则被停用或移出作用范围后回到待判定。
 * 评审页加载和提交审批时都会执行，保证口径一致。
 */
export const applyEnabledRules = (
  regions: DifferenceRegion[],
  rules: IgnoreRule[],
  run: Pick<ScreenshotRun, 'projectId' | 'page' | 'device'>,
): DifferenceRegion[] =>
  regions.map((region) => {
    const rule = findEnabledRule(region, rules, run)
    if (rule) return { ...region, disposition: 'ignored-rule', ruleId: rule.id }
    if (region.disposition === 'ignored-rule') return { ...region, disposition: 'pending' }
    return region
  })

export const unresolvedHighRegions = (regions: DifferenceRegion[]): DifferenceRegion[] =>
  regions.filter((region) => region.severity === 'high' && region.disposition === 'pending')

export const describeRegion = (region: Pick<DifferenceRegion, 'x' | 'y' | 'kind'>): string =>
  `区域 ${region.x}%, ${region.y}%（${kindLabels[region.kind]}）`

export const toReviewedRegion = (
  region: DifferenceRegion,
  rules: IgnoreRule[],
): ReviewedRegion => ({
  id: region.id,
  severity: region.severity,
  kind: region.kind,
  x: region.x,
  y: region.y,
  pixels: region.pixels,
  disposition: region.disposition,
  ruleId: region.ruleId,
  ruleName: region.ruleId ? rules.find((rule) => rule.id === region.ruleId)?.name : undefined,
})
