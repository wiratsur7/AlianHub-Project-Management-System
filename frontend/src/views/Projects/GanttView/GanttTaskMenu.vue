<template>
    <div
        ref="root"
        class="gv__menu"
        role="menu"
        :style="{ left: x + 'px', top: y + 'px' }"
        @keydown="onKeydown"
        @contextmenu.prevent
    >
        <button type="button" role="menuitem" class="gv__menu-item" @click="emit('open')">
            {{ $t('Views.open_task') }}
        </button>
        <button
            type="button"
            role="menuitem"
            class="gv__menu-item"
            :disabled="!canUnschedule"
            :aria-disabled="canUnschedule ? 'false' : 'true'"
            :title="canUnschedule ? undefined : (lockedReason || $t('Views.unschedule_locked'))"
            @click="onUnschedule"
        >
            {{ $t('Views.unschedule') }}
        </button>
    </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    canUnschedule: { type: Boolean, required: true },
    lockedReason: { type: String, default: '' }
});
const emit = defineEmits(['open', 'unschedule', 'close']);

const root = ref(null);

const enabledItems = () => Array.from(root.value?.querySelectorAll('[role="menuitem"]:not([disabled])') ?? []);

const onUnschedule = () => {
    if (props.canUnschedule) emit('unschedule');
};

const onKeydown = (event) => {
    if (event.key === 'Escape') {
        event.preventDefault();
        emit('close');
        return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = enabledItems();
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = current === -1 ? (step === 1 ? 0 : items.length - 1) : (current + step + items.length) % items.length;
    items[next].focus();
};

const onOutsidePointerdown = (event) => {
    if (root.value && !root.value.contains(event.target)) emit('close');
};

onMounted(() => {
    document.addEventListener('pointerdown', onOutsidePointerdown, true);
    nextTick(() => enabledItems()[0]?.focus());
});

onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onOutsidePointerdown, true);
});
</script>
