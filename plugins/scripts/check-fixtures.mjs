import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Proves the shipped preset loads and every plugin in it fires, under a real `oxlint` run
 * against the deliberately broken `fixtures/` tree.
 *
 * Exit codes alone cannot tell these apart: a preset that fails to load exits 1, and so does
 * a preset that found something. Only the diagnostics say which happened, so the run is read
 * as JSON and each plugin the preset registers has to account for at least one finding.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const presetPath = join(root, "oxlintrc.audit.json");
const preset = JSON.parse(readFileSync(presetPath, "utf8"));
const plugins = preset.jsPlugins.map((specifier) => basename(dirname(specifier)));

const run = spawnSync("oxlint", ["-c", presetPath, "--format=json", "fixtures"], {
	cwd: root,
	encoding: "utf8",
	shell: process.platform === "win32",
});

let diagnostics;
try {
	({ diagnostics } = JSON.parse(run.stdout));
} catch {
	const output = run.stdout.trim();
	console.error(output.length > 0 ? output : run.stderr.trim());
	throw new Error("The preset did not produce diagnostics; oxlint failed to load it.");
}

const firedBy = new Set(diagnostics.map(({ code }) => code.slice(0, code.indexOf("("))));
const silent = plugins.filter((plugin) => !firedBy.has(plugin));

if (silent.length > 0) {
	throw new Error(
		`No fixture trips ${silent.join(", ")}; the integration fixture has regressed for ${silent.length} plugin(s).`,
	);
}

console.log(`fixtures trip every plugin in the preset (${diagnostics.length} findings).`);
