<script setup lang="ts">
import { useToonflowStore } from "../composables/useToonflowStore";

const store = useToonflowStore();
</script>

<template>
  <main class="settings-page">
    <section class="settings-header">
      <div class="section-title" style="font-size:16px; margin:0;">设置</div>
      <button class="settings-back-btn" type="button" @click="store.setTab('my')">返回</button>
    </section>

    <section class="surface section-block settings-card">
      <div class="field">
        <label>API Base URL</label>
        <input v-model="store.state.baseUrl" class="input" type="text" placeholder="http://127.0.0.1:60000" />
      </div>
      <div class="field">
        <label>用户名</label>
        <input v-model="store.state.loginUsername" class="input" type="text" placeholder="用户名" />
      </div>
      <div class="field">
        <label>密码</label>
        <input v-model="store.state.loginPassword" class="input" type="password" placeholder="密码" />
      </div>
      <div class="subtle">token 会在账号登录后自动获取，不需要手动填写。</div>
      <div class="settings-action-row">
        <button class="button primary" type="button" @click="store.loginAndSaveToken">账号登录</button>
        <button class="button" type="button" @click="store.saveConnection">保存连接</button>
      </div>
    </section>

    <section class="surface section-block settings-card">
      <div class="settings-status-row">
        <span>登录状态：{{ store.state.token ? "已登录" : "未登录" }}</span>
      </div>
      <button class="button danger-outline" type="button" @click="store.clearToken">退出登录</button>
    </section>
  </main>
</template>
