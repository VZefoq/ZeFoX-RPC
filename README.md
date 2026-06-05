# ZeFoX Presence Bridge

Electron desktop app for ZeFoX Discord Rich Presence.

## Setup

```bash
npm install
npm start
```

## Build Windows installer

```bash
npm run build:win
```

## Next time you release an update

Use this checklist every time you change the Presence Bridge and want users to receive the new version.

Important: the GitHub repo that hosts the release assets must be public. Auto-update cannot read release metadata from a private repo, and public users cannot download private release assets.

1. Bump the app version.

   Example:

   ```bash
   npm version patch --no-git-tag-version
   ```

   This updates both `package.json` and `package-lock.json`.

2. Build the Windows installer and update metadata.

   ```bash
   npm run build:win
   ```

3. Open GitHub releases for `VZefoq/ZeFoX-RPC`.

   Before publishing, make sure `VZefoq/ZeFoX-RPC` is public.

   Create a new release with:

   ```text
   Tag: bridge-v0.9.1
   Target: main
   Release title: ZeFoX Presence Bridge v0.9.1
   Release label: Latest
   ```

   Replace `0.9.1` with the version you just created.

4. Upload these three files from `dist` as release assets:

   ```text
   ZeFoX-Presence-Bridge-Setup.exe
   ZeFoX-Presence-Bridge-Setup.exe.blockmap
   latest.yml
   ```

   Do not upload old installer files like `ZeFoX Presence Bridge Setup 0.8.9.exe`.

5. Publish the release.

   Make sure it is marked as `Latest`, not `Pre-release`.

6. Test the website download link.

   The website download button uses:

   ```text
   https://github.com/VZefoq/ZeFoX-RPC/releases/latest/download/ZeFoX-Presence-Bridge-Setup.exe
   ```

   It should download the newest `ZeFoX-Presence-Bridge-Setup.exe`.

7. Test the auto-updater.

   Install the previous version, then start the app after publishing the new release. It should check the latest GitHub release, download the update, and ask to restart when the update is ready.

## Auto-update notes

- Users on versions before `0.9.1` do not have working auto-update support. They must manually install `0.9.1` or newer once.
- After users have `0.9.0` or newer, future updates can be downloaded by the app automatically.
- Always increase the app version before building an update. If the version does not change, users will not receive the update.
- Keep the release asset names exactly the same as listed above.
- If the app says `releases.atom` returned `404`, the release repo is private or the updater points to the wrong repo.

## Notes

- Discord desktop must be open.
- The app runs a local bridge on `127.0.0.1:3030`.
- Use the app window or tray menu to enable or disable the bridge.
- Closing the window hides it to the tray.
