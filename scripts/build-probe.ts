// Собирает проверочную программу под все платформы с одной машины.
const targets = [
  ["bun-windows-x64", "music-freedom-probe-windows-x64.exe"],
  ["bun-darwin-arm64", "music-freedom-probe-mac-apple-silicon"],
  ["bun-darwin-x64", "music-freedom-probe-mac-intel"],
  ["bun-linux-x64", "music-freedom-probe-linux-x64"],
] as const;

for (const [target, outfile] of targets) {
  const proc = Bun.spawnSync(
    ["bun", "build", "scripts/probe.ts", "--compile", "--minify", `--target=${target}`, "--outfile", `dist/${outfile}`],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1);
}
