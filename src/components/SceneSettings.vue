<script setup lang="ts">
import { useToonflowStore } from "../composables/useToonflowStore";

const store = useToonflowStore();
</script>

<template>
  <section class="card section">
    <div class="row-between">
      <div>
        <h2 class="section-title">设置</h2>
        <div class="subtle">token 会在账号登录后自动获取，不需要手动填写。</div>
      </div>
      <button class="button small" type="button" @click="store.setTab('my')">返回</button>
    </div>
  </section>

  <section class="card section stack-gap">
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
    <div class="row">
      <button class="button primary" type="button" @click="store.loginAndSaveToken">账号登录</button>
      <button class="button" type="button" @click="store.saveConnection">保存连接</button>
      <button class="button ghost" type="button" @click="store.state.token=''; store.saveConnection();">清除 token</button>
    </div>
    <div class="subtle">当前状态：{{ store.state.token ? '已登录' : '未登录' }}</div>
  </section>
</template>
