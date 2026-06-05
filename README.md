<p align="center">
  <img src="assets/app-icon-256.png" alt="ZeFoX logo" width="160">
</p>

# ZeFoX Presence Bridge

ZeFoX Presence Bridge is the optional Windows app that lets the ZeFoX browser extension show Discord Rich Presence while you use Roblox.

## Download

Download the latest setup file from the official ZeFoX RPC releases:

```text
https://github.com/VZefoq/ZeFoX-RPC/releases/latest/download/ZeFoX-Presence-Bridge-Setup.exe
```

Run the setup file and follow the installer.

## What it does

- Connects ZeFoX to Discord Rich Presence.
- Runs locally on `127.0.0.1:3030`.
- Starts automatically when the app opens.
- Keeps running from the Windows tray when the window is closed.
- Lets you enable or disable the bridge, Rich Presence, and account display.

Discord desktop must be open for Rich Presence to appear.

## Updates

The app checks for updates automatically after it starts.

If an update is available, ZeFoX Presence Bridge downloads it and asks you to restart the app when it is ready.

If you run the setup file while the latest version is already installed, it will say that you already have the latest version instead of offering to uninstall.

## Uninstalling

To uninstall, use Windows Settings:

```text
Settings > Apps > Installed apps > ZeFoX Presence Bridge > Uninstall
```

## Troubleshooting

- If Discord Rich Presence does not appear, make sure Discord desktop is open.
- If the extension cannot connect, make sure ZeFoX Presence Bridge is running.
- If Windows SmartScreen appears, choose `More info`, then `Run anyway`, but only if you downloaded the setup from the official ZeFoX site or GitHub release.

## Developer Setup

```bash
npm install
npm start
```

## Build Windows Installer

```bash
npm run build:win
```

## Maintainer Release Checklist

Use this checklist every time you change the Presence Bridge and want users to receive the new version.

The GitHub repo that hosts the release assets must be public. Auto-update cannot read release metadata from a private repo, and public users cannot download private release assets.

1. Bump the app version.

   ```bash
   npm version patch --no-git-tag-version
   ```

2. Build the Windows installer and update metadata.

   ```bash
   npm run build:win
   ```

3. Open GitHub releases for `VZefoq/ZeFoX-RPC`.

   Create a new release with:

   ```text
   Tag: bridge-v0.9.2
   Target: main
   Release title: ZeFoX Presence Bridge v0.9.2
   Release label: Latest
   ```

   Replace `0.9.2` with the version you just created.

4. Upload these three files from `dist` as release assets:

   ```text
   ZeFoX-Presence-Bridge-Setup.exe
   ZeFoX-Presence-Bridge-Setup.exe.blockmap
   latest.yml
   ```

5. Publish the release.

   Make sure it is marked as `Latest`, not `Pre-release`.

6. Test the website download link.

   ```text
   https://github.com/VZefoq/ZeFoX-RPC/releases/latest/download/ZeFoX-Presence-Bridge-Setup.exe
   ```

7. Test the auto-updater.

   Install the previous version, start the app after publishing the new release, and confirm it downloads the update.
