<template>
  <div class="markdown-body" v-html="renderedHtml"></div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
// 只有这一个文件需要引入这些复杂的引擎！
import MarkdownItCore from "markdown-it";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";
import markdownItHighlight from "markdown-it-highlightjs";

const props = defineProps<{ source: string }>();

const md = new MarkdownItCore({ html: true, linkify: true, breaks: true });
md.use(markdownItHighlight, { hljs });

const renderedHtml = computed(() => md.render(props.source || ''));
</script>