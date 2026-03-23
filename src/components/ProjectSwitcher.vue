<script setup lang="ts">
import { computed } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";

const store = useToonflowStore();

const projects = computed(() => store.state.projects);
</script>

<template>
  <div v-if="projects.length" class="row" style="overflow-x:auto; padding-bottom:2px;">
    <button
      v-for="project in projects"
      :key="project.id"
      class="chip"
      :class="{ active: store.state.selectedProjectId === project.id }"
      type="button"
      @click="store.selectProject(project.id)"
    >
      {{ project.name }}
    </button>
  </div>
</template>
