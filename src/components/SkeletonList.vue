<template>
  <div class="sk-list" :class="'sk-list--' + variant">
    <div v-for="i in count" :key="i" class="sk-card">
      <div class="sk-cover sk-anim"></div>
      <div class="sk-lines">
        <div class="sk-line sk-line--title sk-anim"></div>
        <div class="sk-line sk-line--sub sk-anim"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * SkeletonList —— 分模块加载骨架屏（2026-11-16，页面接口速度优化）
 * 接口 pending 期间替代「暂无 XX」空态文案（空态只在确认加载完成后才显示）。
 * variant: card = 横向卡片（我的作品/聊过会话） / hero = 大图位（主页推荐）
 */
withDefaults(defineProps<{
  count?: number;
  variant?: "card" | "hero";
}>(), { count: 3, variant: "card" });
</script>

<style scoped>
.sk-list { display: flex; flex-direction: column; gap: 10px; width: 100%; }
.sk-list--hero { display: block; }
.sk-card {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border-radius: 10px;
  background: rgba(255, 255, 255, .04); border: 1px solid rgba(255, 255, 255, .06);
}
.sk-list--hero .sk-card { display: block; padding: 0; border: none; background: transparent; }
.sk-cover { width: 64px; height: 64px; flex: none; border-radius: 8px; }
.sk-list--hero .sk-cover { width: 100%; height: 210px; border-radius: 14px; }
.sk-lines { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.sk-line { height: 12px; border-radius: 6px; }
.sk-line--title { width: 62%; }
.sk-line--sub { width: 38%; height: 10px; }
.sk-anim {
  background: linear-gradient(90deg, rgba(255,255,255,.05) 25%, rgba(255,255,255,.12) 37%, rgba(255,255,255,.05) 63%);
  background-size: 400% 100%;
  animation: sk-shimmer 1.3s ease infinite;
}
@keyframes sk-shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}
</style>
