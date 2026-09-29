<script setup lang="ts">
import { computed } from 'vue'
import type { DifferenceRegion, ScreenshotRun } from '@/types'
import { dispositionLabels, isIgnoredDisposition } from '@/utils/regions'
import { makeScreenshot } from '@/utils/visual'

const props = defineProps<{
  run: ScreenshotRun
  side: 'baseline' | 'current'
  zoom: number
  regions: DifferenceRegion[]
}>()

const image = computed(() => {
  if (props.side === 'current') return props.run.currentImage ?? makeScreenshot(props.run, true)
  return props.run.baselineImage ?? makeScreenshot(props.run, false)
})
</script>

<template>
  <div class="diff-canvas">
    <div class="canvas-label">
      <span>{{ side === 'baseline' ? '基线图' : '当前图' }}</span>
      <code>{{ side === 'baseline' ? run.baselineVersion : run.currentVersion }}</code>
    </div>
    <div class="canvas-viewport">
      <div class="canvas-stage" :style="{ width: `${zoom}%` }">
        <img :src="image" :alt="`${run.page}${side === 'baseline' ? '基线' : '当前'}截图`" />
        <template v-if="side === 'current'">
          <button
            v-for="region in regions"
            :key="region.id"
            class="diff-region"
            :class="[
              region.severity,
              {
                ignored: isIgnoredDisposition(region.disposition),
                adopted: region.disposition === 'adopted',
              },
            ]"
            :style="{
              left: `${region.x}%`,
              top: `${region.y}%`,
              width: `${region.width}%`,
              height: `${region.height}%`,
            }"
            :title="`${region.kind} · ${region.pixels} 像素差异 · ${dispositionLabels[region.disposition]}`"
          >
            <span>{{ region.severity.toUpperCase() }}</span>
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
