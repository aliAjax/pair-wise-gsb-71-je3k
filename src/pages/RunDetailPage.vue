<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { Message } from '@arco-design/web-vue'
import DiffCanvas from '@/components/DiffCanvas.vue'
import RegionTraceList from '@/components/RegionTraceList.vue'
import StatusTag from '@/components/StatusTag.vue'
import { getRules, getRun, reviewRun } from '@/api/http'
import { useReviewStore } from '@/stores/review'
import {
  applyRulesToRegions,
  highRiskRegions,
  kindLabel,
} from '@/utils/rules'
import type { DifferenceRegion, ReviewCategory } from '@/types'

interface ReviewForm {
  category: ReviewCategory
  decision: 'approved' | 'rejected'
  reviewer: string
  reason: string
}

const route = useRoute()
const router = useRouter()
const queryClient = useQueryClient()
const reviewStore = useReviewStore()
const runId = computed(() => String(route.params.id))
const localRegions = ref<DifferenceRegion[]>([])
const rulesAppliedKey = ref('')

const form = reactive<ReviewForm>({
  category: 'design-change',
  decision: 'approved',
  reviewer: '林默',
  reason: '',
})

const { data: run, isLoading } = useQuery({
  queryKey: computed(() => ['run', runId.value]),
  queryFn: () => getRun(runId.value),
})

const { data: rules } = useQuery({ queryKey: ['rules'], queryFn: getRules })

// 首次载入某个运行时，按当前启用规则自动归类；之后保留评审人的人工判定
watch(
  [run, rules],
  ([runValue, rulesValue]) => {
    if (!runValue || !rulesValue) return
    const applyKey = `${runValue.id}:${rulesValue
      .filter((rule) => rule.enabled)
      .map((rule) => rule.id)
      .join(',')}`
    if (rulesAppliedKey.value === applyKey) return
    localRegions.value = applyRulesToRegions(
      {
        projectId: runValue.projectId,
        page: runValue.page,
        device: runValue.device,
      },
      runValue.regions.map((region) => ({ ...region })),
      rulesValue,
    )
    rulesAppliedKey.value = applyKey
    reviewStore.setDifferenceFilter('all')
  },
  { immediate: true },
)

watch(runId, () => {
  rulesAppliedKey.value = ''
})

const ruleMap = computed(() => new Map((rules.value ?? []).map((rule) => [rule.id, rule])))

const visibleRegions = computed(() =>
  localRegions.value.filter(
    (region) =>
      reviewStore.differenceFilter === 'all' || region.severity === reviewStore.differenceFilter,
  ),
)

const suspiciousPixels = computed(() =>
  localRegions.value
    .filter((region) => !region.ignored)
    .reduce((total, region) => total + region.pixels, 0),
)

const pendingHighRisk = computed(() => highRiskRegions(localRegions.value))

const blockingSummary = computed(
  () =>
    `${pendingHighRisk.value
      .map((region) => `${kindLabel(region.kind)}（${region.x}%, ${region.y}%）`)
      .join('、')}`,
)

const reviewSnapshots = computed(() => run.value?.review?.regions ?? [])
const adoptedSnapshots = computed(() => reviewSnapshots.value.filter((snapshot) => snapshot.adopted))
const ignoredSnapshots = computed(() => reviewSnapshots.value.filter((snapshot) => !snapshot.adopted))

const reviewMutation = useMutation({
  mutationFn: (payload: ReviewForm) =>
    reviewRun(runId.value, { ...payload, regions: localRegions.value }),
  onSuccess: async (updated) => {
    Message.success(updated.review?.decision === 'approved' ? '审批通过，新基线已留痕' : '已驳回归并保留原基线')
    await queryClient.invalidateQueries({ queryKey: ['run', runId.value] })
    await queryClient.invalidateQueries({ queryKey: ['runs'] })
    await queryClient.invalidateQueries({ queryKey: ['baselines'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    await router.push('/approvals')
  },
  onError: (error: Error) => Message.error(error.message),
})

// 人工忽略需要填写依据，规则忽略区域不允许人工恢复
const ignoreModalVisible = ref(false)
const ignoreReason = ref('')
const ignoreTargetId = ref<string | null>(null)

const ruleName = (ruleId?: string) => (ruleId ? ruleMap.value.get(ruleId)?.name ?? ruleId : '')

const toggleIgnored = (target: DifferenceRegion) => {
  const region = localRegions.value.find((item) => item.id === target.id)
  if (!region) return
  if (region.ignoredBy === 'rule') {
    Message.info(`该区域由启用规则「${ruleName(region.ruleId)}」自动忽略，请先在忽略规则页停用对应规则`)
    return
  }
  if (region.ignored) {
    region.ignored = false
    region.ignoredBy = undefined
    region.ignoredReason = undefined
    region.ignoredAt = undefined
    return
  }
  ignoreTargetId.value = region.id
  ignoreReason.value = ''
  ignoreModalVisible.value = true
}

const confirmIgnore = () => {
  if (!ignoreReason.value.trim()) {
    Message.warning('请填写忽略依据，便于后续追溯')
    return
  }
  const region = localRegions.value.find((item) => item.id === ignoreTargetId.value)
  if (region) {
    region.ignored = true
    region.ignoredBy = 'manual'
    region.ignoredReason = ignoreReason.value.trim()
    region.ignoredAt = new Date().toISOString()
  }
  ignoreModalVisible.value = false
}

const handleDifferenceFilter = (value: string | number | boolean) => {
  const allowed = ['all', 'high', 'medium', 'low']
  if (allowed.includes(String(value))) {
    reviewStore.setDifferenceFilter(String(value) as 'all' | 'high' | 'medium' | 'low')
  }
}

const submitReview = () => {
  if (!form.reason.trim()) {
    Message.warning('请填写审批原因')
    return
  }
  if (form.decision === 'approved' && pendingHighRisk.value.length > 0) {
    Message.error(
      `仍有 ${pendingHighRisk.value.length} 处未处理的高风险区域：${blockingSummary.value}，请先判定或忽略`,
    )
    return
  }
  reviewMutation.mutate({ ...form })
}
</script>

<template>
  <a-spin :loading="isLoading" style="width: 100%">
    <template v-if="run">
      <section class="detail-heading">
        <div>
          <a-space>
            <h2>{{ run.name }}</h2>
            <StatusTag :status="run.status" />
          </a-space>
          <p>{{ run.page }} · {{ run.device }} · {{ run.theme === 'light' ? '浅色主题' : '深色主题' }}</p>
        </div>
        <a-space>
          <a-button @click="router.push('/runs')"><icon-left /> 返回列表</a-button>
          <a-button type="primary" :loading="reviewMutation.isPending.value" @click="submitReview">
            <icon-check /> 提交审批
          </a-button>
        </a-space>
      </section>

      <div class="run-facts">
        <div><span>差异率</span><strong :class="{ danger: run.mismatchRate >= 5 }">{{ run.mismatchRate.toFixed(2) }}%</strong></div>
        <div><span>待判定像素</span><strong>{{ suspiciousPixels.toLocaleString() }}</strong></div>
        <div><span>运行标识</span><strong>{{ run.id }}</strong></div>
        <div><span>构建链路</span><strong>{{ run.baselineVersion }} → {{ run.currentVersion }}</strong></div>
      </div>

      <a-alert
        v-if="form.decision === 'approved' && pendingHighRisk.length > 0"
        type="error"
        style="margin-bottom: 16px"
      >
        <template #title>存在 {{ pendingHighRisk.length }} 处未处理的高风险区域，当前无法批准</template>
        请在下方区域列表中逐个人工判定或填写依据后忽略：{{ blockingSummary }}
      </a-alert>

      <div class="review-workspace">
        <div class="comparison-area">
          <div class="compare-toolbar">
            <a-space>
              <span class="toolbar-label">差异筛选</span>
              <a-radio-group
                type="button"
                :model-value="reviewStore.differenceFilter"
                size="small"
                @change="handleDifferenceFilter"
              >
                <a-radio value="all">全部</a-radio>
                <a-radio value="high">高</a-radio>
                <a-radio value="medium">中</a-radio>
                <a-radio value="low">低</a-radio>
              </a-radio-group>
            </a-space>
            <a-space>
              <a-button-group size="small">
                <a-button @click="reviewStore.setZoom(reviewStore.zoom - 10)"><icon-zoom-out /></a-button>
                <a-button>{{ reviewStore.zoom }}%</a-button>
                <a-button @click="reviewStore.setZoom(reviewStore.zoom + 10)"><icon-zoom-in /></a-button>
              </a-button-group>
              <a-button size="small" @click="reviewStore.setZoom(100)"><icon-refresh /> 复位</a-button>
            </a-space>
          </div>
          <div class="canvas-grid">
            <DiffCanvas :run="run" side="baseline" :zoom="reviewStore.zoom" :regions="visibleRegions" />
            <DiffCanvas :run="run" side="current" :zoom="reviewStore.zoom" :regions="visibleRegions" />
          </div>
        </div>

        <aside class="review-panel">
          <div class="panel-title">
            <div>
              <h3>差异区域</h3>
              <span>已按当前筛选展示 {{ visibleRegions.length }} 处</span>
            </div>
            <a-space :size="6">
              <a-tag color="red">{{ localRegions.filter((item) => !item.ignored).length }} 待判定</a-tag>
              <a-tag color="arcoblue">{{ localRegions.filter((item) => item.ignoredBy === 'rule').length }} 规则忽略</a-tag>
              <a-tag color="gold">{{ localRegions.filter((item) => item.ignoredBy === 'manual').length }} 人工忽略</a-tag>
            </a-space>
          </div>
          <div class="region-list">
            <button
              v-for="region in visibleRegions"
              :key="region.id"
              class="region-item"
              :class="{ ignored: region.ignored, locked: region.ignoredBy === 'rule' }"
              @click="toggleIgnored(region)"
            >
              <span class="region-severity" :class="region.severity">{{ region.severity.toUpperCase() }}</span>
              <span class="region-copy">
                <strong>
                  {{ kindLabel(region.kind) }}
                  <a-tag v-if="region.ignoredBy === 'rule'" color="arcoblue" size="small">规则</a-tag>
                  <a-tag v-else-if="region.ignoredBy === 'manual'" color="gold" size="small">人工忽略</a-tag>
                </strong>
                <small>区域 {{ region.x }}%, {{ region.y }}% · {{ region.pixels.toLocaleString() }} px</small>
                <small v-if="region.ignoredBy === 'rule'" class="ignore-reason">规则：{{ ruleName(region.ruleId) }}</small>
                <small v-else-if="region.ignoredReason" class="ignore-reason">依据：{{ region.ignoredReason }}</small>
              </span>
              <span class="ignore-action">
                <template v-if="region.ignoredBy === 'rule'">规则忽略</template>
                <template v-else>{{ region.ignored ? '恢复' : '忽略' }}</template>
              </span>
            </button>
          </div>

          <a-divider />

          <div class="panel-title">
            <div>
              <h3>评审结论</h3>
              <span>原因、批准人和忽略依据会随审批结果永久留痕</span>
            </div>
          </div>
          <a-form :model="form" layout="vertical" @submit-success="submitReview">
            <a-form-item
              field="category"
              label="变化类型"
              :rules="[{ required: true, message: '请选择变化类型' }]"
            >
              <a-select v-model="form.category">
                <a-option value="design-change">设计变更</a-option>
                <a-option value="render-error">渲染异常</a-option>
                <a-option value="environment-noise">环境噪声</a-option>
              </a-select>
            </a-form-item>
            <a-form-item
              field="decision"
              label="审批结论"
              :rules="[{ required: true, message: '请选择审批结论' }]"
            >
              <a-radio-group v-model="form.decision" type="button">
                <a-radio value="approved">批准为新基线</a-radio>
                <a-radio value="rejected">驳回归</a-radio>
              </a-radio-group>
            </a-form-item>
            <a-form-item
              field="reviewer"
              label="批准人"
              :rules="[{ required: true, message: '请填写批准人' }]"
            >
              <a-input v-model="form.reviewer" />
            </a-form-item>
            <a-form-item
              field="reason"
              label="审批原因"
              :rules="[
                { required: true, message: '请填写审批原因' },
                { minLength: 8, message: '审批原因至少 8 个字符' },
              ]"
            >
              <a-textarea
                v-model="form.reason"
                :auto-size="{ minRows: 4, maxRows: 7 }"
                placeholder="说明业务需求、设计稿或异常依据"
              />
            </a-form-item>
            <a-alert v-if="form.decision === 'approved'" type="warning" style="margin-bottom: 16px">
              批准后采用与忽略的区域都会固化到新基线；仍存在未处理高风险区域时无法批准。原基线仍可追溯，不会被覆盖。
            </a-alert>
            <a-alert v-else type="info" style="margin-bottom: 16px">
              驳回仅记录评审结论与区域判定，不会创建或停用任何基线，原基线继续生效。
            </a-alert>
            <a-button html-type="submit" type="primary" long :loading="reviewMutation.isPending.value">
              确认{{ form.decision === 'approved' ? '批准并创建基线' : '驳回' }}
            </a-button>
          </a-form>

          <div v-if="run.review" class="review-record">
            <h4>最近一次审批</h4>
            <dl>
              <dt>结论</dt><dd>{{ run.review.decision === 'approved' ? '已批准' : '已驳回' }}</dd>
              <dt>类型</dt><dd>{{ run.review.category }}</dd>
              <dt>人员</dt><dd>{{ run.review.reviewer }}</dd>
              <dt>时间</dt><dd>{{ run.review.reviewedAt.slice(0, 16).replace('T', ' ') }}</dd>
            </dl>
            <p>{{ run.review.reason }}</p>
            <template v-if="reviewSnapshots.length">
              <div class="trace-block">
                <h5>新基线采用的区域（{{ adoptedSnapshots.length }}）</h5>
                <RegionTraceList :snapshots="adoptedSnapshots" mode="adopted" />
              </div>
              <div class="trace-block">
                <h5>已忽略的区域（{{ ignoredSnapshots.length }}）</h5>
                <RegionTraceList :snapshots="ignoredSnapshots" mode="ignored" />
              </div>
            </template>
          </div>
        </aside>
      </div>

      <a-modal
        v-model:visible="ignoreModalVisible"
        title="人工忽略差异区域"
        :ok-text="`确认忽略${pendingHighRisk.some((item) => item.id === ignoreTargetId) ? '高风险区域' : ''}`"
        cancel-text="取消"
        @ok="confirmIgnore"
      >
        <div>
          <div class="arco-form-item">
            <label class="arco-form-item-label" for="ignore-reason-input">忽略依据 *</label>
            <a-textarea
              id="ignore-reason-input"
              v-model="ignoreReason"
              :auto-size="{ minRows: 3, maxRows: 5 }"
              placeholder="说明该差异可忽略的依据，例如设计稿编号、动态数据说明"
            />
          </div>
          <a-alert type="info">忽略依据会与审批结果一起保存，用于新基线与历史记录追溯。</a-alert>
        </div>
      </a-modal>
    </template>
  </a-spin>
</template>
