import { createApp } from "vue";
import App from "./App.vue";
import "./styles.css";

// 1. 引入你自己写的组件
import MyMarkdownView from "./components/MarkdownView.vue";




const app = createApp(App);
// 2. 全局注册！给它起个名字叫 MarkdownView
app.component("MarkdownView", MyMarkdownView);

app.mount("#app");
