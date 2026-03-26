# Strategy

## Default Decision Table

Use this table when choosing the automation stack:

| Situation | Prefer | Why |
| --- | --- | --- |
| Standard Android native screen with stable ids or descriptions | Appium | Best structure-aware locators and assertions |
| Android native screen visible in Poco inspector | Poco | Cleaner control-tree interaction than image matching |
| Game scene, canvas, custom render layer, animation-heavy control | Airtest | Visual matching works when UI tree is absent |
| Mostly native app, but one or two controls are invisible to Appium | Appium + Airtest | Keep most logic semantic and only use visual fallback where needed |
| User only wants quick validation on a live device | Smallest viable stack | Usually Appium first, Airtest if the UI tree is not usable |

## What To Capture

For a useful run, try to keep these artifacts:

- `current_screen.png`: pre-run or failure screenshot
- `page_source.xml`: Appium tree when locator issues occur
- `run.log` or raw terminal output
- `airtest_log/`: Airtest log directory
- `report.html`: Airtest report when Airtest is used
- `recording.mp4`: only when motion timing matters

## Script Placement

Use the smallest scope that matches the task:

- Temporary debugging: `tmp/airtest_appium/`
- Reusable project automation requested by the user: a stable repository path chosen for the task
- Image assets for Airtest: keep them adjacent to the script

Do not scatter one-off automation files across unrelated source directories.

## Locator Preference

For Appium, prefer this order:

1. accessibility id / content description
2. resource id
3. exact text or text contains
4. Android UIAutomator selector
5. XPath only as a last resort

For Poco, prefer:

1. stable node name
2. multiple attributes combined
3. parent-child or ancestor-descendant relationships
4. regex selectors when text or names vary

For Airtest:

1. smaller templates
2. stable visual anchors
3. region-limited search
4. explicit wait before touch

## Official Notes Confirmed While Writing This Skill

- Appium quickstart currently documents Android automation with the `uiautomator2` driver and `appium driver install uiautomator2`.
- Appium quickstart also exposes `appium driver doctor uiautomator2` for environment diagnosis.
- Airtest docs document `airtest run ... --device ... --log ...` and `airtest report ... --log_root ... --outfile ...`.
- Airtest docs show `AndroidUiautomationPoco` for Android native UI.
