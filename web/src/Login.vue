<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, saveToken } from './api';

interface HistoryItem {
  username: string;
  password: string;
}

const emit = defineEmits<{ (e: 'success', admin: any): void }>();

const HISTORY_KEY = 'login_history';

const form = reactive({ username: '', password: '' });
const loading = ref(false);
const error = ref('');
const history = ref<HistoryItem[]>([]);

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    history.value = raw ? JSON.parse(raw) : [];
  } catch {
    history.value = [];
  }
}

function saveHistory(username: string, password: string) {
  const list = history.value.filter((item) => item.username !== username);
  list.unshift({ username, password });
  if (list.length > 10) list.pop();
  history.value = list;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

function querySearch(queryString: string, cb: (results: any[]) => void) {
  const q = queryString.trim().toLowerCase();
  const results = history.value
    .filter((item) => item.username.toLowerCase().includes(q))
    .map((item) => ({ value: item.username, password: item.password }));
  cb(results);
}

function onSelect(item: any) {
  form.username = item.value;
  form.password = item.password;
}

async function login() {
  if (!form.username || !form.password) {
    error.value = '请输入账号和密码';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const { data } = await api.post('/auth/login', {
      username: form.username,
      password: form.password,
    });
    saveToken(data.token);
    saveHistory(form.username, form.password);
    emit('success', data.admin);
  } catch (err: any) {
    error.value = err.response?.data?.message || '登录失败，请检查账号密码';
  } finally {
    loading.value = false;
  }
}

onMounted(loadHistory);
</script>

<template>
  <div class="login-page">
    <el-card class="login-card" shadow="always">
      <template #header>
        <div class="login-header">VITA 数据后台</div>
      </template>
      <el-form label-position="top" @submit.prevent="login">
        <el-form-item label="账号">
          <el-autocomplete
            v-model="form.username"
            :fetch-suggestions="querySearch"
            :trigger-on-focus="true"
            placeholder="请输入账号"
            value-key="value"
            style="width: 100%"
            @select="onSelect"
            @keyup.enter="login"
          />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" placeholder="请输入密码" show-password @keyup.enter="login" />
        </el-form-item>
        <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="login-error" />
        <el-button type="primary" size="large" :loading="loading" style="width: 100%; margin-top: 12px" @click="login">
          登录
        </el-button>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f3f6fa;
}
.login-card {
  width: 420px;
  border-radius: 12px;
}
.login-header {
  text-align: center;
  font-size: 22px;
  font-weight: bold;
  color: #14213d;
}
.login-error {
  margin-bottom: 12px;
}
</style>
