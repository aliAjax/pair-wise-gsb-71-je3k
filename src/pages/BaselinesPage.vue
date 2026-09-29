<script setup lang="ts">
import { ref } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { getBaselines, getProjects } from '@/api/http'
import { kindLabel } from '@/utils/regions'
import type { Baseline } from '@/types'

const projectId = ref('')
const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: getProjects })
const { data: baselines, isLoading } = useQuery({
  queryKey: ['baselines', projectId],
  queryFn: () => getBaselines(projectId.value || undefined),
})

const projectName = (id: string) => projects.value?.find((project) => project.id === id)?.name ?? id

const hasTrace = (baseline: Baseline) =>
  (baseline.adoptedRegions?.length ?? 0) + (baseline.ignoredRegions?.length ?? 0) > 0
</script>

<template>
  <section class="page-intro compact">
    <div>
      <h2>历史基线与批准证据</h2>
      <p>每次批准生成不可覆盖的新版本，记录批准人、原因、采用与忽略的区域、关联运行和启用状态。</p>
    </div>
    <a-select v-model="projectId" allow-clear placeholder="全部项目" style="width: 220px">
      <a-option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</a-option>
    </a-select>
  </section>

  <div class="baseline-layout">
    <a-card class="table-panel" :bordered="false">
      <a-table :data="baselines" :loading="isLoading" :pagination="false" row-key="id">
        <template #columns>
          <a-table-column title="项目 / 页面" :width="200">
            <template #cell="{ record }">
              <div class="primary-cell">
                <strong>{{ record.page }}</strong>
                <span>{{ projectName(record.projectId) }}</span>
              </div>
            </template>
          </a-table-column>
          <a-table-column title="基线版本" :width="170">
            <template #cell="{ record }"><code>{{ record.version }}</code></template>
          </a-table-column>
          <a-table-column title="设备 / 主题" :width="150">
            <template #cell="{ record }">{{ record.device }} · {{ record.theme === 'light' ? '浅色' : '深色' }}</template>
          </a-table-column>
          <a-table-column title="批准人" data-index="approvedBy" :width="90" />
          <a-table-column title="批准时间" :width="150">
            <template #cell="{ record }">{{ record.approvedAt.slice(0, 16).replace('T', ' ') }}</template>
          </a-table-column>
          <a-table-column title="区域追溯" :width="170">
            <template #cell="{ record }">
              <a-popover v-if="hasTrace(record)" trigger="hover" position="left">
                <a-link>采用 {{ record.adoptedRegions.length }} · 忽略 {{ record.ignoredRegions.length }}</a-link>
                <template #content>
                  <div class="region-trace">
                    <div v-if="record.ignoredRegions.length" class="trace-group">
                      <strong>忽略 {{ record.ignoredRegions.length }} 处</strong>
                      <p v-for="region in record.ignoredRegions" :key="region.id">
                        <span class="region-severity" :class="region.severity">{{ region.severity.toUpperCase() }}</span>
                        <span>{{ kindLabel(region.kind) }} · 区域 {{ region.x }}%, {{ region.y }}%</span>
                        <em>{{ region.disposition === 'ignored-rule' ? `规则：${region.ruleName ?? region.ruleId}` : '手动忽略' }}</em>
                      </p>
                    </div>
                    <div v-if="record.adoptedRegions.length" class="trace-group">
                      <strong>采用 {{ record.adoptedRegions.length }} 处</strong>
                      <p v-for="region in record.adoptedRegions" :key="region.id">
                        <span class="region-severity" :class="region.severity">{{ region.severity.toUpperCase() }}</span>
                        <span>{{ kindLabel(region.kind) }} · 区域 {{ region.x }}%, {{ region.y }}%</span>
                      </p>
                    </div>
                  </div>
                </template>
              </a-popover>
              <span v-else class="muted">—</span>
            </template>
          </a-table-column>
          <a-table-column title="状态" :width="90">
            <template #cell="{ record }"><a-tag :color="record.active ? 'green' : 'gray'">{{ record.active ? '有效' : '已停用' }}</a-tag></template>
          </a-table-column>
          <a-table-column title="操作" :width="100">
            <template #cell="{ record }"><router-link :to="`/runs/${record.runId}`">追溯运行</router-link></template>
          </a-table-column>
        </template>
      </a-table>
    </a-card>

    <aside class="history-panel">
      <div class="panel-title">
        <div><h3>基线变更时间线</h3><span>仅展示最近批准记录</span></div>
      </div>
      <a-timeline>
        <a-timeline-item v-for="baseline in baselines?.slice(0, 5)" :key="baseline.id" :dot-color="baseline.active ? 'green' : 'gray'">
          <strong>{{ baseline.page }} · {{ baseline.version }}</strong>
          <p>{{ baseline.reason }}</p>
          <small>{{ baseline.approvedBy }} · {{ baseline.approvedAt.slice(0, 16).replace('T', ' ') }}</small>
          <small v-if="hasTrace(baseline)" class="trace-line">
            采用 {{ baseline.adoptedRegions.length }} 处 · 忽略 {{ baseline.ignoredRegions.length }} 处
          </small>
        </a-timeline-item>
      </a-timeline>
    </aside>
  </div>
</template>
