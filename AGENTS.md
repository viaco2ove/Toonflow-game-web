# Repository Guidelines

## Project Structure & Module Organization
This repository is a Vue 3 + Vite + TypeScript web client for Toonflow Game. Main application code lives in `src/`: `components/` contains screen and shared UI components such as `SceneHome.vue`, `ScenePlay.vue`, and dialogs; `composables/` holds stateful logic like `useToonflowStore.ts`; `api/` wraps backend requests in `ToonflowApi`; `types/` stores shared TypeScript models; `utils/` contains small helpers. Global entry points are `src/main.ts`, `src/App.vue`, and `src/styles.css`. Build helpers live in `scripts/`, and WSL notes are in `md/wsl/`.

## Build, Test, and Development Commands
Use Yarn in this repo because `yarn.lock` is committed.

- `yarn`: install dependencies.
- `yarn dev`: start the Vite dev server on `http://localhost:5173`.
- `yarn build`: create a production build, then inline dist assets with `scripts/inline-dist-assets.mjs`.
- `yarn preview`: preview the built app locally.
- `yarn type-check`: run TypeScript checks with `tsc --noEmit`.

## Coding Style & Naming Conventions
Match the existing style: TypeScript uses double quotes, semicolons, and concise helper functions. Use PascalCase for Vue SFCs (`StoryCover.vue`, `SceneSettings.vue`), `useXxx` for composables, and camelCase for utilities and API methods. Keep screen-level views in `src/components/Scene*.vue`. Prefer small focused functions over deeply nested logic, and keep shared types in `src/types/toonflow.ts`.

## Testing Guidelines
There is no automated test suite configured yet. Before opening a PR, run `yarn type-check`, `yarn build`, and manually smoke-test affected flows in the browser, especially story creation, session play, settings, and API-backed dialogs. When adding tests later, place them beside the feature or under a dedicated `tests/` folder and name them `*.spec.ts`.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commit prefixes such as `refactor:`. Continue using `feat:`, `fix:`, `refactor:`, or `docs:` with a short summary, for example `fix: guard empty base URL in session loader`. PRs should include scope, affected screens or API routes, manual verification steps, and screenshots or recordings for UI changes.

## Repository-Specific Notes
Do not edit `review_xxx.md`; add or update matching `review_xxx.answer.md` files instead. Also do not modify files whose first line is `@no_modify` or `# @no_modify`.

# 系统环境配置
[system.yml](system/system.yml)

# web端和安卓端同步修改
web端和安卓端需要同步修改内容
但是也得考虑一下web 是否适用！
例如按住语音输入这个适用安卓，但是不适用web.
同样的web的实现安卓是否适用

# 设计要点
按钮多用奥森字体图标而不是文字

# wsl test
[test_wsl.md](md/wsl/test_wsl.md)