import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const version = pkg.version;
if (!versionPattern.test(version)) {
  fail(`package.json 的 version 不是可用的语义化版本: ${version}`);
}

const tag = `v${version}`;
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const versionNotes = readFileSync(new URL("../版本改进.md", import.meta.url), "utf8");
const notes = changelogSection(changelog, version);
const improvements = changelogSection(versionNotes, version);
if (!notes) {
  fail(`CHANGELOG.md 缺少 “## ${version}” 段落。先把这一版的改进写进仓库文件并提交，再发布。`);
}
if (!improvements) {
  fail(`版本改进.md 缺少 “## ${version}” 段落。每版改进必须写在这个已提交的文件里，不能只放在 GitHub Release。`);
}

const dirty = exec("git", ["status", "--porcelain"]).trim();
if (dirty) {
  fail("工作区还有未提交的改动。先提交，再运行 npm run release。");
}

const localTag = exec("git", ["tag", "--list", tag]).trim();
if (localTag) {
  fail(`本地已经有标签 ${tag}。`);
}

console.log(`运行测试，确认 ${tag} 可以发布…`);
execFileSync(process.execPath, ["--experimental-strip-types", "--test", ...testFiles()], {
  stdio: "inherit",
});

const notesFile = join(tmpdir(), `pde-agent-${tag}-notes.md`);
writeFileSync(notesFile, notes.trim() + "\n");
const releaseFiles = ["CHANGELOG.md", "README.md"];
console.log("发布说明来自已提交的 CHANGELOG.md。附件：版本改进.md、CHANGELOG.md、README.md");

exec("git", ["tag", "-a", tag, "-m", tag], true);
try {
  exec("git", ["push", "origin", tag], true);
} catch (error) {
  fail(`标签 ${tag} 已在本地创建，但推送失败。发布说明在 ${notesFile}。\n${errorText(error)}`);
}

try {
  const branch = exec("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  exec(
    "gh",
    ["release", "create", tag, "--target", branch, "--title", tag, "--notes-file", notesFile, ...releaseFiles],
    true,
  );
  uploadVersionNotes(tag);
} catch (error) {
  fail(
    `标签 ${tag} 已经创建并推送，但 GitHub Release 没有创建成功。发布说明在 ${notesFile}，也可以直接用 CHANGELOG.md 里的 ${version} 段落。\n${errorText(error)}`,
  );
}

console.log(`已发布 ${tag}。`);

function uploadVersionNotes(releaseTag: string): void {
  const asset = join(tmpdir(), "version-notes.md");
  copyFileSync(new URL("../版本改进.md", import.meta.url), asset);
  exec("gh", ["release", "upload", releaseTag, `${asset}#版本改进.md`, "--clobber"], true);
}

function changelogSection(markdown: string, releaseVersion: string): string | null {
  const marker = `## ${releaseVersion}`;
  const start = markdown.indexOf(marker);
  if (start < 0) return null;
  const next = markdown.indexOf("\n## ", start + marker.length);
  return (next === -1 ? markdown.slice(start) : markdown.slice(start, next)).trim();
}

function testFiles(): string[] {
  return [
    "test/expression.test.ts",
    "test/poisson.test.ts",
    "test/heat.test.ts",
    "test/wave.test.ts",
    "test/boundary.test.ts",
    "test/tool.test.ts",
  ];
}

function exec(command: string, args: string[], inherit = false): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
