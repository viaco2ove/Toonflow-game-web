# Commands

## Environment Probe

```bash
bash .codex/skills/airtest_appium/scripts/check_android_automation_env.sh
```

## ADB Basics

```bash
adb devices -l
adb shell getprop ro.build.version.release
adb shell wm size
adb shell dumpsys window | rg 'mCurrentFocus|mFocusedApp'
adb exec-out screencap -p > tmp/airtest_appium/current_screen.png
adb logcat -d > tmp/airtest_appium/logcat.txt
```

If multiple devices are connected:

```bash
adb -s <serial> shell dumpsys window | rg 'mCurrentFocus|mFocusedApp'
adb -s <serial> exec-out screencap -p > tmp/airtest_appium/current_screen.png
```

## Appium Setup

Install or verify the Android driver:

```bash
appium driver list --installed
appium driver install uiautomator2
appium driver doctor uiautomator2
```

Start a local Appium server:

```bash
appium --address 127.0.0.1 --port 4723
```

Minimal Python dependency setup:

```bash
python -m venv .venv-ui
source .venv-ui/bin/activate
python -m pip install -U pip Appium-Python-Client
```

## Airtest Setup

```bash
python -m venv .venv-ui
source .venv-ui/bin/activate
python -m pip install -U pip airtest pocoui
```

Run an Airtest script:

```bash
airtest run tmp/airtest_appium/example.air --device "Android:///<serial>" --log tmp/airtest_appium/log
python -m airtest run tmp/airtest_appium/example.air --device "Android:///<serial>" --log tmp/airtest_appium/log
```

Generate an Airtest report:

```bash
airtest report tmp/airtest_appium/example.air --log_root tmp/airtest_appium/log --lang zh --outfile tmp/airtest_appium/report.html
python -m airtest report tmp/airtest_appium/example.air --log_root tmp/airtest_appium/log --lang zh --outfile tmp/airtest_appium/report.html
```

If Poco statements are present in the script, Airtest docs note that report generation may need plugins:

```bash
airtest report tmp/airtest_appium/example.air \
  --log_root tmp/airtest_appium/log \
  --lang zh \
  --outfile tmp/airtest_appium/report.html \
  --plugin airtest_selenium.report poco.utils.airtest.report
```

## Current App Hints

Package and activity from a running app:

```bash
adb shell dumpsys window | rg 'mCurrentFocus|mFocusedApp'
adb shell cmd package resolve-activity --brief <package_name>
```

Installed packages:

```bash
adb shell pm list packages | rg '<keyword>'
```

## Optional Screen Recording

ADB recording:

```bash
adb -s <serial> shell screenrecord /sdcard/ui-test.mp4
adb -s <serial> pull /sdcard/ui-test.mp4 tmp/airtest_appium/ui-test.mp4
```

Airtest recording during script run:

```bash
airtest run tmp/airtest_appium/example.air --device "Android:///<serial>" --log tmp/airtest_appium/log --recording recording.mp4
```

## Notes

- Quote Airtest device strings in bash when they contain query parameters.
- In Windows shells, special characters like `&` may need escaping.
- For Appium, create one server per local test session unless you already know an existing one is correct for the task.
