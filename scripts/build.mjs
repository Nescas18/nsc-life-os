import { mkdir, copyFile, access } from "node:fs/promises";
import { constants } from "node:fs";

const rootFiles = ["index.html", "home.html", "car3d.js", "config.js", "manifest.webmanifest", "favicon.ico", "favicon-32.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "og-image.png", "cabeca-open-160.webp", "cabeca-open-256.webp", "cabeca-closed-160.webp", "cabeca-closed-256.webp", "cabeca-open-256.png", "cabeca-closed-256.png"];
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
for (const file of ["bricolage.woff2", "geist.woff2", "geist-mono.woff2", "LICENSE-bricolage.txt", "LICENSE-geist.txt"]) {
  await copyFile(`fonts/${file}`, `www/fonts/${file}`);
  console.log(`Copied fonts/${file} to www/fonts/`);
}

// carro 3D da aba Manutenção: three.js r170 (módulos) e o modelo otimizado
for (const [dir, files] of [["vendor/three", ["three.module.min.js", "GLTFLoader.js", "BufferGeometryUtils.js", "RoomEnvironment.js", "LICENSE"]], ["models", ["carro-v1.glb", "LICENSE.md"]]]) {
  await mkdir(`www/${dir}`, { recursive: true });
  for (const file of files) {
    await copyFile(`${dir}/${file}`, `www/${dir}/${file}`);
    console.log(`Copied ${dir}/${file} to www/${dir}/`);
  }
}
