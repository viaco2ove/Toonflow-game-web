#!/usr/bin/env bash

set -u

section() {
  printf '\n== %s ==\n' "$1"
}

have() {
  command -v "$1" >/dev/null 2>&1
}

print_cmd_version() {
  local name="$1"
  shift
  if have "$name"; then
    printf '[OK] %s: ' "$name"
    "$@" 2>/dev/null | head -n 1
  else
    printf '[MISSING] %s\n' "$name"
  fi
}

print_python_pkg() {
  local python_bin="$1"
  local pkg="$2"

  if "$python_bin" -m pip show "$pkg" >/tmp/codex_skill_pkg_$$.txt 2>/dev/null; then
    local version
    version="$(awk -F': ' '/^Version: / {print $2; exit}' /tmp/codex_skill_pkg_$$.txt)"
    printf '[OK] python package %s: %s\n' "$pkg" "${version:-installed}"
  else
    printf '[MISSING] python package %s\n' "$pkg"
  fi
  rm -f /tmp/codex_skill_pkg_$$.txt
}

section "System"
uname -a 2>/dev/null || true
printf 'PWD: %s\n' "$(pwd)"

section "Base Commands"
print_cmd_version adb adb version
print_cmd_version node node --version
print_cmd_version npm npm --version
print_cmd_version python python --version
print_cmd_version python3 python3 --version
print_cmd_version appium appium --version

section "Android Environment"
printf 'ANDROID_HOME=%s\n' "${ANDROID_HOME:-<unset>}"
printf 'ANDROID_SDK_ROOT=%s\n' "${ANDROID_SDK_ROOT:-<unset>}"
printf 'JAVA_HOME=%s\n' "${JAVA_HOME:-<unset>}"

if have adb; then
  adb devices -l || true
fi

section "Appium"
if have appium; then
  appium driver list --installed || true
  appium driver doctor uiautomator2 || true
else
  printf '[SKIP] appium commands unavailable\n'
fi

section "Python Packages"
if have python; then
  print_python_pkg python Appium-Python-Client
  print_python_pkg python airtest
  print_python_pkg python pocoui
elif have python3; then
  print_python_pkg python3 Appium-Python-Client
  print_python_pkg python3 airtest
  print_python_pkg python3 pocoui
else
  printf '[SKIP] no python interpreter available\n'
fi

section "Summary"
printf 'Use this output to decide whether to proceed with Appium, Poco, or Airtest.\n'
printf 'If multiple devices are listed, pin one serial before running automation.\n'
