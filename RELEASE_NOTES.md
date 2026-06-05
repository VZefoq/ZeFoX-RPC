# ZeFoX Presence Bridge Release Notes

This note is for maintaining and releasing the app. Keep `README.md` user-facing.

## Developer Setup

```bash
npm install
npm start
```

## Build Windows Installer

```bash
npm run build:win
```

## Release Checklist

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
