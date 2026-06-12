<template>
  <div class="markdown-body" v-html="renderedHtml"></div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MarkdownItCore from "markdown-it";
import hljs from "highlight.js";
// 这里引入 github 主题，如果你是暗黑模式，可以换成 "highlight.js/styles/github-dark.css"
import "highlight.js/styles/github.css";
import markdownItHighlight from "markdown-it-highlightjs";

const props = defineProps<{ source: string }>();

const md = new MarkdownItCore({ html: true, linkify: true, breaks: true });
md.use(markdownItHighlight, { hljs });

const renderedHtml = computed(() => md.render(props.source || ''));
</script>

<style scoped>
/* 容器本身的样式不需要 deep */
.markdown-body {
  line-height: 1.6;
  color: #c9d1d9; /* 你的截图看起来是暗色背景，这里给了个偏白的字色，可自调 */
  font-size: 14px;
}

/* v-html 内部的样式必须用 :deep() 包裹！ */

:deep(pre) {
  /* 代码块外层容器 */
  background: #161b22; /* 深色背景 */
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  border: 1px solid #30363d;
  margin-top: 10px;
  margin-bottom: 10px;
}

:deep(pre code.hljs) {
  /* 代码块内层文字 */
  display: block;
  font-family: "JetBrains Mono", Consolas, Monaco, "Courier New", monospace;

  /* 解决问题一的关键：保留手动换行，且允许超长文本自动折行 */
  white-space: pre-wrap !important;
  word-wrap: break-word !important;

  padding: 0; /* 清除 highlight.js 默认的多余 padding */
  background: transparent; /* 背景交给 pre 控制 */
  color: #e6edf3;
}

/* 其他排版美化 */
:deep(p) {
  margin-top: 0;
  margin-bottom: 10px;
}
:deep(h3) {
  font-size: 1.1rem;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
  font-weight: 600;
}
:deep(ul) {
  padding-left: 20px;
}
</style>