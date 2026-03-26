---
name: airtest_appium
description: Use when the user wants Codex CLI to use Airtest, Poco, or Appium to inspect, script, run, or troubleshoot Android app UI testing on a real device or emulator, including screenshots, logs, reports, and locator strategy selection.
---

# Airtest + Appium Android UI Testing

Use this skill when the task is about:

- using Airtest, Poco, or Appium to test an Android app UI
- inspecting a connected Android device or emulator
- writing or running a minimal reproduction script for a UI bug
- collecting screenshots, page source, logs, videos, or HTML reports
- troubleshooting `adb`, Appium, Airtest, or Poco environment issues

This skill is for Codex CLI execution, not just explanation. The default behavior is:

1. probe the environment and connected devices first
2. choose the least fragile automation stack
3. run the smallest useful test
4. keep evidence artifacts
5. report outcome, blockers, and next action

## Tool Choice
env:[airtest_appium.yml](../../../airtest_appium.yml)
Use the following default order unless the user explicitly asks otherwise:

- `Appium`: first choice for standard Android native UI. Prefer it when the screen exposes a normal accessibility/UIAutomator tree and stable locators such as resource id, content description, or text.
- `Poco`: use when the target exposes a Poco tree. For Android native apps this can work directly; for games and engine-rendered UI it usually requires Poco SDK integration.
- `Airtest`: use for image-driven interaction, canvas/game scenes, animation-heavy flows, splash/login flows, or as a fallback when Appium/Poco cannot see the target control reliably.
- `Hybrid`: combine Appium for navigation/assertions and Airtest for one or two visual-only interactions when that is less brittle than forcing XPath everywhere.

If the task is ambiguous, read [strategy.md](./references/strategy.md) before writing code.

## First Step

Run the environment probe before creating or executing scripts:

```bash
bash .codex/skills/airtest_appium/scripts/check_android_automation_env.sh
```

Then confirm the target device and app identity:

- device serial from `adb devices -l`
- app package and focused activity if the app is already open
- whether the task is exploratory debugging or a reusable scripted test

Use [commands.md](./references/commands.md) for ready-to-run commands.

## Execution Workflow

### 1. Probe and Inspect

- Run the environment probe script.
- Verify at least one device is visible in `adb devices`.
- If more than one device is connected, always target a single serial explicitly.
- Capture a screenshot before automation if the current screen matters.
- For Appium work, also capture page source when a locator fails or the UI tree is unclear.

### 2. Choose the Stack

- Prefer Appium for this repository's Android app unless evidence says the target element is not visible in the UI tree.
- Prefer Poco over Airtest if a usable Poco tree exists.
- Fall back to Airtest when the target is purely visual or rendered in a way Appium/Poco cannot inspect.

### 3. Create the Smallest Useful Script

- For one-off debugging, prefer a temporary script under `tmp/airtest_appium/` or another user-specified scratch directory.
- For repository changes requested by the user, place reusable automation code in a stable project path and keep assets nearby.
- Keep the script minimal: launch app, navigate, assert the issue, save evidence, exit.

If you need code templates, read [snippets.md](./references/snippets.md).

### 4. Execute and Collect Evidence

Collect as many of these as the task warrants:

- exit code
- console output
- screenshot before and after the failing step
- Appium page source on failure
- Airtest log directory
- Airtest HTML report
- screen recording if the failure is motion dependent

### 5. Report Back

Always report:

- which stack was chosen and why
- which device was targeted
- the exact script or command that reproduced the behavior
- whether the issue reproduced
- where the artifacts were written
- what blocked progress, if anything

## Appium Rules

- Prefer Python client code.
- Use the `uiautomator2` driver for Android.
- Start Appium only when needed, and prefer a local server such as `http://127.0.0.1:4723`.
- Prefer locator order: accessibility id / resource id -> text/description -> Android UIAutomator -> XPath last.
- When locator attempts fail, dump page source and inspect the tree before adding more fallback selectors.
- Avoid brittle absolute XPath unless there is no better option.
- Use conservative capabilities such as `platformName=Android`, `appium:automationName=UiAutomator2`, `appium:udid`, `appium:noReset=true`, and either `appium:app` or `appium:appPackage` plus `appium:appActivity`.

See [commands.md](./references/commands.md) and [snippets.md](./references/snippets.md).

## Airtest Rules

- Use Airtest when visual interaction is the actual requirement, not as the first answer to every UI problem.
- Prefer `.py` scripts for quick Codex-authored iterations; use `.air` when bundling template images and reports is more convenient.
- Keep template images local to the script directory.
- Use `wait`, `exists`, tighter regions, and confidence thresholds instead of repeated blind `touch`.
- Run the script first, then generate the report from the matching log directory.

See [commands.md](./references/commands.md) for `airtest run` and `airtest report`.

## Poco Rules

- For Android native UI, `AndroidUiautomationPoco` is the usual entry point.
- For games, confirm whether the app already integrates Poco SDK before promising Poco-based automation.
- If Poco tree is unavailable, say so clearly and switch to Appium or Airtest instead of forcing Poco.

## Failure Handling

If the run fails, do not stop at the first error message. Triage in this order:

1. device visibility in `adb`
2. package/activity correctness
3. Appium driver installation and doctor output
4. whether the UI tree actually exposes the target element
5. whether the element is only visually present and needs Airtest
6. whether the task needs Poco SDK support that the app does not have

Use [troubleshooting.md](./references/troubleshooting.md) for common failure modes.

## Platform Notes

- In bash or WSL, quote device URIs containing `?` or `&`.
- In Windows PowerShell or `cmd`, special characters in Airtest device strings may need escaping.
- If the terminal shows Chinese garbling on Windows, switch to UTF-8 first:

```powershell
chcp 65001
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8
```

## Official References

When installation details or version-specific behavior matter, verify against the official documentation instead of relying on memory:

- Appium docs: <https://appium.io/docs/en/latest/>
- Airtest docs: <https://airtest.doc.io.netease.com/>
- Poco docs: <https://poco.readthedocs.io/zh_CN/latest/source/README.html>
