import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import pkg from './package.json'

export default defineConfig({
  base: "./",
  define:{
    // 放到 import.meta.env 下面
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version)
  },
  plugins: [vue()],
  server: {
    port: 5175,
    watch: {
      usePolling: true,
      interval: 200,
    },
  },
});
