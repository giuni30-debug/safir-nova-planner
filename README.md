# NOVA Planner

NOVA Planner is a React + Capacitor Android application.

## What is real in this build

- Calendar with correct local dates, real month lengths, week navigation and event editing.
- Tasks and notes persisted locally on the device.
- Android local notifications for event reminders.
- In-app notification test from Profile.
- Nova local assistant connected to the planner data. It can read today's/tomorrow's agenda, create tasks, create notes and create timed reminders.
- Dark/light/system theme and reduced-motion preference.
- PWA/offline shell for the web build.
- Original NOVA icon used as the source for Android launcher/splash asset generation.

## Android package

`com.safirworld.novaplanner`

Change it in `capacitor.config.ts` before first Play Store publication if a different permanent package id is required.

## Local development

```bash
npm install
npm run dev
```

## Build the web bundle

```bash
npm run build
```

## Create Android once on a development machine

```bash
npm run android:add
npm run android:sync
npm run assets:android
```

Then build the APK:

```bash
cd android
./gradlew assembleDebug
```

The debug APK will be at `android/app/build/outputs/apk/debug/app-debug.apk`.

## Codemagic

`codemagic.yaml` is included. On a clean repository it installs dependencies, creates the Android project, syncs Capacitor, generates NOVA launcher/splash assets from `assets/icon.svg`, and builds an installable debug APK.

A signed release APK/AAB should be added after the permanent package id and Play signing/keystore setup are confirmed.
