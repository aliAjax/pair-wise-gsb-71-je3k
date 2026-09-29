<script setup lang="ts">
import { kindLabel, regionPosition, severityLabel } from '@/utils/rules'
import type { RegionSnapshot } from '@/types'

defineProps<{
  snapshots: RegionSnapshot[]
  mode: 'adopted' | 'ignored'
}>()
</script>

<template>
  <div v-if="snapshots.length" class="region-trace">
    <div v-for="snapshot in snapshots" :key="snapshot.regionId" class="trace-item">
      <span class="region-severity" :class="snapshot.severity">{{ snapshot.severity.toUpperCase() }}</span>
      <div class="trace-copy">
        <strong>
          {{ kindLabel(snapshot.kind) }} · {{ severityLabel(snapshot.severity) }}
          <a-tag v-if="mode === 'ignored' && snapshot.ignoredBy === 'rule'" color="arcoblue" size="small">规则忽略</a-tag>
          <a-tag v-else-if="mode === 'ignored'" color="gold" size="small">人工忽略</a-tag>
        </strong>
        <small>{{ regionPosition(snapshot) }} · {{ snapshot.pixels.toLocaleString() }} px</small>
        <template v-if="mode === 'ignored'">
          <small v-if="snapshot.ruleName" class="ignore-reason">命中规则：{{ snapshot.ruleName }}</small>
          <small v-if="snapshot.ignoredReason" class="ignore-reason">{{ snapshot.ignoredReason }}</small>
        </template>
      </div>
    </div>
  </div>
  <p v-else class="trace-empty">{{ mode === 'adopted' ? '无采用区域' : '无忽略区域' }}</p>
</template>
