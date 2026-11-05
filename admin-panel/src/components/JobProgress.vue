<script setup lang="ts">
import { computed } from 'vue';
import type { JobState } from '@/contracts/job.state';

const props = withDefaults(
    defineProps<{
        job: JobState;
        doneText?: string;
        doneIcon?: string;
        showCounters?: boolean;
        showCountWithoutTotal?: boolean;
        compact?: boolean;
        inline?: boolean;
        indeterminate?: boolean;
    }>(),
    { doneText: 'готово', doneIcon: 'mdi-check-circle', showCountWithoutTotal: true },
);
const running = computed(() => props.job.status === 'running');
const percent = computed(() => {
    const p = props.job.progress;
    return p?.percent ?? (p?.total ? Math.round((p.done / p.total) * 100) : undefined);
});
const text = computed(() => {
    if (props.inline && !running.value) return props.doneText;
    if (props.job.status === 'failed') return `ошибка: ${props.job.error}`;
    if (!running.value) return props.doneText;
    const p = props.job.progress;
    const phase = p?.phase ?? (props.compact ? '' : '…');
    if (props.compact) return `${phase} ${p?.done ?? 0}${p?.total ? ' из ' + p.total : ''}`;
    return p?.total
        ? `${phase}: ${p.done} из ${p.total}`
        : props.showCountWithoutTotal && p?.done
          ? `${phase}: ${p.done}`
          : phase;
});
</script>

<template>
    <span v-if="inline">{{ text }}</span>
    <template v-else>
        <div class="d-flex align-center" :class="{ 'mb-2': !compact }">
            <v-icon
                :icon="running ? 'mdi-progress-clock' : job.status === 'failed' ? 'mdi-alert-circle' : doneIcon"
                class="me-2"
            />
            <span class="font-weight-medium">
                <slot name="title" /><template v-if="$slots.title"> · </template>
                <template v-if="job.progress?.percent !== undefined">{{ percent }}% · </template>{{ text }}
            </span>
        </div>
        <v-progress-linear
            v-if="running"
            :model-value="percent"
            :indeterminate="indeterminate || percent === undefined"
            :height="compact ? 6 : 8"
            rounded
            :class="{ 'mt-2': compact }"
        />
        <div v-if="showCounters && Object.keys(job.progress?.counters ?? {}).length" class="mt-2 text-body-2">
            <span v-for="(value, key) in job.progress.counters" :key="key" class="me-4">{{ key }}: {{ value }}</span>
        </div>
    </template>
</template>
