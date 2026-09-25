#!/usr/bin/env node
// kirodotdev/Kiro#11610: read_file returns NUL-filled garbage for UTF-16 (and other non-UTF-8) files.
//
// Kiro IDE 1.1.70 / kiro.kiro-agent 1.1.158: extensions/kiro.kiro-agent/dist/extension.js
// The IDE answers the agent's file reads in two ACP handlers, `_kiro/fs/read_file` and
// `fs/read_text_file`. Both decode the raw bytes with `new TextDecoder("utf-8")`. This swaps in
// `vscode.workspace.decode(bytes, { uri })`, the decoder the editor already uses: BOM,
// `files.encoding`, `files.autoGuessEncoding`, and binary content is rejected instead of returned.
//
//   node kiro-patch-11610.mjs [--check | --apply | --revert]
//
// Close Kiro before --apply / --revert and start it again afterwards. Re-apply after every update.
// ponytail: exact anchors for 1.1.70 only (other builds report "unknown" and are left alone);
// the real fix is the same one-line swap in both handlers in Kiro's source.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const roots = process.env.KIRO_APP_ROOT ? [process.env.KIRO_APP_ROOT] : [
  join(process.env.LOCALAPPDATA ?? "", "Programs", "Kiro", "resources", "app"),
  "/Applications/Kiro.app/Contents/Resources/app",
  join(homedir(), "Applications", "Kiro.app", "Contents", "Resources", "app"),
  "/usr/share/kiro/resources/app",
  "/opt/Kiro/resources/app",
];
const FILE = roots.map((r) => join(r, "extensions", "kiro.kiro-agent", "dist", "extension.js")).find(existsSync);
if (!FILE) throw new Error("Kiro not found; set KIRO_APP_ROOT to <install>/resources/app");

// One hunk per handler: `s4e` is the `vscode` binding in `_kiro/fs/read_file`, `a4e` in `fs/read_text_file`.
const HUNKS = ["s4e", "a4e"].map((v) => [
  `s=await ${v}.workspace.fs.readFile(n),a=new TextDecoder("utf-8").decode(s);`,
  `s=await ${v}.workspace.fs.readFile(n),a=await ${v}.workspace.decode(s,{uri:n});`,
]);

const text = readFileSync(FILE, "utf8");
const count = (s) => text.split(s).length - 1;
const states = HUNKS.map(([stock, patched]) =>
  count(stock) === 1 && count(patched) === 0 ? "stock" : count(stock) === 0 && count(patched) === 1 ? "patched" : "unknown");
console.log(`${FILE}\n${states.join(" ")}`);
if (states.includes("unknown")) { console.log("Anchors do not match this build; leaving it alone."); process.exit(1); }

const mode = process.argv[2] ?? "--check";
if (mode === "--check") process.exit(0);
if (mode !== "--apply" && mode !== "--revert") { console.log("usage: --check | --apply | --revert"); process.exit(2); }

const [from, to] = mode === "--apply" ? [0, 1] : [1, 0];
let out = text;
for (const h of HUNKS) out = out.replace(h[from], () => h[to]);
if (out === text) { console.log(mode === "--apply" ? "Already patched." : "Already stock."); process.exit(0); }
new Function(out); // parse check: throws on a syntax error before anything is written
writeFileSync(`${FILE}.tmp`, out);
renameSync(`${FILE}.tmp`, FILE);
console.log(`${mode === "--apply" ? "Patched" : "Reverted"}. Restart Kiro.`);
