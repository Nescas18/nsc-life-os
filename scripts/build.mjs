import { mkdir, copyFile, access } from "node:fs/promises";
import { constants } from "node:fs";

const rootFiles = ["index.html", "config.js", "manifest.webmanifest", "favicon.ico", "favicon-32.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "og-image.png", "cabeca-open-160.webp", "cabeca-open-256.webp", "cabeca-closed-160.webp", "cabeca-closed-256.webp", "cabeca-open-256.png", "cabeca-closed-256.png", ".htaccess"];
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

await mkdir("www/fonts", { recursive: true });
for (const file of ["sora.woff2", "inter.woff2", "LICENSE-sora.txt", "LICENSE-inter.txt"]) {
  await copyFile(`fonts/${file}`, `www/fonts/${file}`);
  console.log(`Copied fonts/${file} to www/fonts/`);
}
