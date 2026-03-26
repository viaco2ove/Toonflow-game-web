# Troubleshooting

## `adb devices` Shows Nothing

Check:

- USB debugging enabled on the device
- emulator is actually booted
- `adb start-server` and `adb kill-server && adb start-server`
- device authorization prompt accepted

## Device Shows `offline`

Try:

```bash
adb kill-server
adb start-server
adb devices -l
```

If still offline, reconnect the device or restart the emulator.

## Appium Server Starts But Session Creation Fails

Check:

- target serial is correct
- `appium driver list --installed` includes `uiautomator2`
- `appium driver doctor uiautomator2` output
- `appium:appPackage` and `appium:appActivity` are correct when launching by package
- an old server process is not holding stale state

## Appium Finds No Element

Do not immediately add XPath layers. First:

1. capture screenshot
2. print or save `driver.page_source`
3. inspect whether the control is actually in the UI tree
4. if not present, switch to Airtest or Poco rather than fighting the wrong tool

## Airtest Image Match Is Unstable

Tighten the visual strategy:

- crop a smaller template
- avoid animated areas
- add `wait` before `touch`
- narrow the search region
- use more stable anchors
- make sure device resolution or scale has not changed unexpectedly

## Airtest Device String Issues

Airtest docs show command lines such as:

```bash
airtest run test.air --device "Android:///<serial>" --log log/
```

If a more complex URI is needed and it works in Airtest IDE, prefer copying the IDE-generated `--device` argument instead of hand-authoring it.

## Poco Tree Is Empty Or Missing

Interpret it correctly:

- Android native app: confirm the current screen is not a WebView/canvas-only surface
- game: Poco usually requires Poco SDK integration
- if no Poco tree is exposed, switch to Appium or Airtest instead of waiting on Poco to work magically

## Multiple Devices Connected

Always pin the target:

- `adb -s <serial> ...`
- Appium capability `appium:udid`
- Airtest device string `"Android:///<serial>"`

## Shell Escaping Problems

- bash or WSL: quote the entire Airtest device URI if it contains `?` or `&`
- Windows `cmd` or PowerShell: special characters may need escaping
- if the terminal mangles Chinese output on Windows, switch to UTF-8 before continuing
