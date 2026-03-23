import axios from "axios";
import type { ApiEnvelope } from "../types/game";

export const BASE_URL_KEY = "TF_GAME_BASE_URL";
export const TOKEN_KEY = "TF_GAME_TOKEN";

export function getBaseUrl() {
  return localStorage.getItem(BASE_URL_KEY)?.trim() || "http://127.0.0.1:60000";
}

export function setBaseUrl(url: string) {
  localStorage.setItem(BASE_URL_KEY, url.trim());
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)?.trim() || "";
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

const client = axios.create({
  timeout: 30000,
});

client.interceptors.request.use((config) => {
  config.baseURL = getBaseUrl();
  const token = getToken();
  if (token) {
    config.headers.Authorization = token;
  }
  return config;
});

export async function postApi<T>(path: string, payload?: unknown): Promise<T> {
  const response = await client.post<ApiEnvelope<T>>(path, payload ?? {});
  const envelope = response.data;
  if (!envelope || envelope.code !== 200) {
    throw new Error(envelope?.message || "请求失败");
  }
  return envelope.data;
}

export async function getApi<T>(path: string): Promise<T> {
  const response = await client.get<ApiEnvelope<T>>(path);
  const envelope = response.data;
  if (!envelope || envelope.code !== 200) {
    throw new Error(envelope?.message || "请求失败");
  }
  return envelope.data;
}
