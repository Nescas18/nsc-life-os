import { mkdir, copyFile, access } from "node:fs/promises";
import { constants } from "node:fs";

const rootFiles = ["index.html", "config.js", "manifest.webmanifest", "favicon.ico", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "og-image.png"];
await mkdir("www", { recursive: true });

for (const file of rootFiles) {
  try {
    await access(file, constants.R_OK);
    await copyFile(file, `www/${file}`);
    console.log(`Copied ${file} to www/`);
  } catch {
    if (file === "index.html") {
      console.error("Required file index.html was not found.");
      process.exitCode = 1;
    } else {
      console.warn(`Optional file ${file} was not found; continuing.`);
    }
  }
}
