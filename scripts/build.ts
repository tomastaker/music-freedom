// Собирает приложение в один исполняемый файл под каждую платформу и упаковывает в zip для GitHub Releases.
import { $ } from "bun";

const ZIP = `
import os, sys, zipfile
name = sys.argv[1]
with zipfile.ZipFile(name + ".zip", "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, _, files in os.walk(name):
        for f in files:
            path = os.path.join(root, f)
            info = zipfile.ZipInfo.from_file(path)
            info.compress_type = zipfile.ZIP_DEFLATED
            with open(path, "rb") as fh:
                z.writestr(info, fh.read())
`;

const all = [
  ["bun-windows-x64", "music-freedom-windows-x64", ".exe"],
  ["bun-darwin-arm64", "music-freedom-macos-apple-silicon", ""],
  ["bun-darwin-x64", "music-freedom-macos-intel", ""],
  ["bun-linux-x64", "music-freedom-linux-x64", ""],
] as const;

// `bun run build linux` соберёт только подходящие цели.
const filter = process.argv[2];
const targets = filter ? all.filter(([target]) => target.includes(filter)) : all;

await $`rm -rf dist/app && mkdir -p dist/app`;
for (const [target, name, ext] of targets) {
  const outfile = `dist/app/${name}/${name}${ext}`;
  await $`bun build src/server/main.ts --compile --minify --sourcemap=none --target=${target} --define process.env.NODE_ENV='"production"' --outfile ${outfile}`;
  await $`cp README.md dist/app/${name}/`;
  // zip сохраняет право на запуск: на macOS и Linux файл открывается сразу после распаковки.
  await $`cd dist/app && python3 -I -c ${ZIP} ${name}`;
  console.log(`готово: dist/app/${name}.zip`);
}
