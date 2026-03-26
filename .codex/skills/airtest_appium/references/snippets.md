# Snippets

## Minimal Appium Python Example

```python
from appium import webdriver
from appium.options.android import UiAutomator2Options
from appium.webdriver.common.appiumby import AppiumBy

capabilities = {
    "platformName": "Android",
    "appium:automationName": "UiAutomator2",
    "appium:udid": "emulator-5554",
    "appium:appPackage": "com.example.app",
    "appium:appActivity": ".MainActivity",
    "appium:noReset": True,
    "appium:newCommandTimeout": 120,
}

driver = webdriver.Remote(
    "http://127.0.0.1:4723",
    options=UiAutomator2Options().load_capabilities(capabilities),
)

try:
    driver.find_element(AppiumBy.ID, "com.example.app:id/login").click()
    print(driver.page_source)
finally:
    driver.quit()
```

## Minimal Airtest Python Example

```python
from airtest.core.api import *

auto_setup(__file__)
connect_device("Android:///emulator-5554")

if exists(Template("tpl_login_button.png")):
    touch(Template("tpl_login_button.png"))

wait(Template("tpl_home_ready.png"), timeout=20)
snapshot(filename="home_ready.png")
```

## Minimal Poco Example For Android Native UI

```python
from airtest.core.api import *
from poco.drivers.android.uiautomation import AndroidUiautomationPoco

auto_setup(__file__)
connect_device("Android:///emulator-5554")

poco = AndroidUiautomationPoco(
    use_airtest_input=True,
    screenshot_each_action=False,
)

poco("com.example.app:id/login").click()
assert poco(text="Home").exists()
```

## Practical Guidance

- Appium snippet is better for assertions and structured locators.
- Airtest snippet is better for visual anchors and screenshots.
- Poco snippet is better when the UI tree is exposed but Appium is awkward or unavailable.
- Do not start with all three at once. Pick the smallest stack that can actually see the target element.
