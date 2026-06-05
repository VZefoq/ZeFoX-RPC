const fs = require("fs");
const path = require("path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const projectDir = context.packager.projectDir;
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const iconPath = path.join(projectDir, "assets", "app.ico");

  if (!fs.existsSync(exePath) || !fs.existsSync(iconPath)) {
    return;
  }

  try {
    const { rcedit } = await import("rcedit");
    await rcedit(exePath, { icon: iconPath });
  } catch (error) {
    console.warn("Skipping exe resource icon update:", error.message || error);
  }
};
