<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { getBaselines, getProjects } from '@/api/http'
import RegionTraceList from '@/components/RegionTraceList.vue'
import type { Baseline } from '@/types'

const projectId = ref('')
const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: getProjects })
const { data: baselines, isLoading } = useQuery({
  queryKey: ['baselines', projectId],
  queryFn: () => getBaselines(projectId.value || undefined),
})

const activeBaselineId = ref<string | null>(null)
const traceVisible = ref(false)

const activeBaseline = computed(
  () => baselines.value?.find((baseline) => baseline.id === activeBaselineId.value) ?? null,
)

const projectName = (id: string) => projects.value?.find((project) => project.id === id)?.name ?? id

const openTrace = (baseline: Baseline) => {
  activeBaselineId.value = baseline.id
  traceVisible.value = true
}
</script>

<template>
  <section class="page-intro compact">
    <div>
      <h2>历史基线与批准证据</h2>
      <p>每次批准生成不可覆盖的新版本，记录批准人、原因、关联运行，以及新基线采用与忽略的差异区域。</p>
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
          <a-table-column title="设备 / 主题" :width="160">
            <template #cell="{ record }">{{ record.device }} · {{ record.theme === 'light' ? '浅色' : '深色' }}</template>
          </a-table-column>
          <a-table-column title="区域追溯" :width="150">
            <template #cell="{ record }">
              <a-space :size="4" wrap>
                <a-tag color="green">采用 {{ record.adoptedRegions?.length ?? 0 }}</a-tag>
                <a-tag color="orange">忽略 {{ record.ignoredRegions?.length ?? 0 }}</a-tag>
              </a-space>
            </template>
          </a-table-column>
          <a-table-column title="批准人" data-index="approvedBy" :width="90" />
          <a-table-column title="批准时间" :width="150">
            <template #cell="{ record }">{{ record.approvedAt.slice(0, 16).replace('T', ' ') }}</template>
          </a-table-column>
          <a-table-column title="状态" :width="80">
            <template #cell="{ record }"><a-tag :color="record.active ? 'green' : 'gray'">{{ record.active ? '有效' : '已停用' }}</a-tag></template>
          </a-table-column>
          <a-table-column title="操作" :width="130">
            <template #cell="{ record }">
              <a-space :size="8">
                <a-link @click="openTrace(record)">区域追溯</a-link>
                <router-link :to="`/runs/${record.runId}`">运行</router-link>
              </a-space>
            </template>
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
          <small>
            {{ baseline.approvedBy }} · {{ baseline.approvedAt.slice(0, 16).replace('T', ' ') }}
            · 采用 {{ baseline.adoptedRegions?.length ?? 0 }} / 忽略 {{ baseline.ignoredRegions?.length ?? 0 }}
          </small>
        </a-timeline-item>
      </a-timeline>
    </aside>
  </div>

  <a-drawer
    v-model:visible="traceVisible"
    :width="480"
    :title="activeBaseline ? `${activeBaseline.page} · ${activeBaseline.version}` : '区域追溯'"
  >
    <template v-if="activeBaseline">
      <a-descriptions
        :column="1"
        size="small"
        bordered
        :data="[
          { label: '批准人', value: activeBaseline.approvedBy },
          { label: '批准时间', value: activeBaseline.approvedAt.slice(0, 16).replace('T', ' ') },
          { label: '关联运行', value: activeBaseline.runId },
          { label: '审批原因', value: activeBaseline.reason },
        ]"
        style="margin-bottom: 16px"
      />
      <template v-if="(activeBaseline.adoptedRegions?.length ?? 0) + (activeBaseline.ignoredRegions?.length ?? 0)">
        <h4 class="trace-heading">新基线采用的区域（{{ activeBaseline.adoptedRegions.length }}）</h4>
        <RegionTraceList :snapshots="activeBaseline.adoptedRegions" mode="adopted" />
        <h4 class="trace-heading">已忽略的区域（{{ activeBaseline.ignoredRegions.length }}）</h4>
        <RegionTraceList :snapshots="activeBaseline.ignoredRegions" mode="ignored" />
      </template>
      <a-empty v-else description="该基线为历史版本，升级前未固化区域快照" />
    </template>
  </a-drawer>
</template>
