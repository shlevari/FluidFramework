/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runCommand } from "@oclif/test";
import { expect } from "chai";
import { afterEach, describe, it } from "mocha";

const packageDirectory = process.cwd();
const testWorkspacesRoot = path.join(packageDirectory, ".fluid-imports-test-workspaces");
const testWorkspaces: string[] = [];

const cumulativePackageName = "@fluidframework/flub-import-cumulative-fixture";
const createChildLoggerPackageName = "@fluidframework/flub-import-telemetry-fixture";
const noInternalPackageName = "@fluidframework/flub-import-no-internal-fixture";

const sevenEntrypointExports = {
	".": "public.d.ts",
	"./beta": "beta.d.ts",
	"./legacy": "legacy.d.ts",
	"./legacy/beta": "legacy-beta.d.ts",
	"./alpha": "alpha.d.ts",
	"./legacy/alpha": "legacy-alpha.d.ts",
	"./internal": "internal.d.ts",
} as const;

const cumulativePackageDeclarations = {
	"public.d.ts": `
/**
 * @public
 */
export declare const publicSymbol: string;
`,
	"beta.d.ts": `
export { publicSymbol } from "./public.js";

/**
 * @beta
 */
export declare const betaSymbol: string;
`,
	"legacy.d.ts": `
export { publicSymbol } from "./public.js";

/**
 * @legacy
 * @public
 */
export declare const legacyPublicSymbol: string;
`,
	"legacy-beta.d.ts": `
export { publicSymbol } from "./public.js";
export { legacyPublicSymbol } from "./legacy.js";

/**
 * @legacy
 * @beta
 */
export declare const legacyBetaSymbol: string;
`,
	"alpha.d.ts": `
export { publicSymbol } from "./public.js";
export { betaSymbol } from "./beta.js";

/**
 * @alpha
 */
export declare const alphaSymbol: string;
`,
	"legacy-alpha.d.ts": `
export { publicSymbol } from "./public.js";
export { legacyPublicSymbol } from "./legacy.js";
export { legacyBetaSymbol } from "./legacy-beta.js";

/**
 * @legacy
 * @alpha
 */
export declare const legacyAlphaSymbol: string;
`,
	"internal.d.ts": `
export { publicSymbol } from "./public.js";
export { betaSymbol } from "./beta.js";
export { legacyPublicSymbol } from "./legacy.js";
export { legacyBetaSymbol } from "./legacy-beta.js";
export { alphaSymbol } from "./alpha.js";
export { legacyAlphaSymbol } from "./legacy-alpha.js";

/**
 * @internal
 */
export declare const internalSymbol: string;
`,
} as const;

async function createWorkspace(): Promise<string> {
	await mkdir(testWorkspacesRoot, { recursive: true });
	const workspace = await mkdtemp(path.join(testWorkspacesRoot, "workspace-"));
	testWorkspaces.push(workspace);
	await mkdir(path.join(workspace, "src"), { recursive: true });
	await writeFile(
		path.join(workspace, "package.json"),
		JSON.stringify(
			{
				name: "fluid-imports-test-workspace",
				private: true,
				type: "module",
			},
			undefined,
			"\t",
		),
	);
	await writeFile(
		path.join(workspace, "tsconfig.json"),
		JSON.stringify(
			{
				compilerOptions: {
					module: "Node16",
					moduleResolution: "Node16",
					skipLibCheck: true,
					strict: true,
					target: "ES2022",
				},
				include: ["src/**/*.ts"],
			},
			undefined,
			"\t",
		),
	);
	return workspace;
}

async function writeFluidPackage(
	workspace: string,
	packageName: string,
	declarationFiles: Record<string, string>,
	entrypoints: Record<string, string>,
): Promise<void> {
	const packagePath = path.join(workspace, "node_modules", ...packageName.split("/"));
	await mkdir(packagePath, { recursive: true });

	const packageExports: Record<string, { default: string; types: string }> = {};
	for (const [entrypoint, declarationFile] of Object.entries(entrypoints)) {
		const javascriptFile = declarationFile.replace(/\.d\.ts$/, ".js");
		packageExports[entrypoint] = {
			default: `./${javascriptFile}`,
			types: `./${declarationFile}`,
		};
	}

	await writeFile(
		path.join(packagePath, "package.json"),
		JSON.stringify(
			{
				name: packageName,
				version: "1.0.0",
				type: "module",
				exports: packageExports,
			},
			undefined,
			"\t",
		),
	);

	for (const [declarationFile, contents] of Object.entries(declarationFiles)) {
		await writeFile(path.join(packagePath, declarationFile), contents);
		await writeFile(
			path.join(packagePath, declarationFile.replace(/\.d\.ts$/, ".js")),
			"export {};\n",
		);
	}
}

async function writeConsumer(workspace: string, contents: string): Promise<string> {
	const sourceFile = path.join(workspace, "src", "index.ts");
	await writeFile(sourceFile, contents);
	return sourceFile;
}

async function runFluidImports(
	workspace: string,
	...args: string[]
): ReturnType<typeof runCommand> {
	const originalCwd = process.cwd();
	try {
		process.chdir(workspace);
		return await runCommand(
			["modify:fluid-imports", "--tsconfigs", "tsconfig.json", ...args],
			{
				root: packageDirectory,
			},
		);
	} finally {
		process.chdir(originalCwd);
	}
}

function escapeRegExp(value: string): string {
	return value.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}

function expectImportForSymbol(
	sourceText: string,
	symbolName: string,
	moduleSpecifier: string,
): void {
	expect(sourceText).to.match(
		new RegExp(
			`import\\s*\\{[^}]*\\b${escapeRegExp(symbolName)}\\b[^}]*\\}\\s*from\\s*"${escapeRegExp(
				moduleSpecifier,
			)}";`,
		),
	);
}

afterEach(async () => {
	process.chdir(packageDirectory);
	const workspacesToRemove = testWorkspaces.splice(0);
	await Promise.all(
		workspacesToRemove.map(async (workspace) =>
			rm(workspace, { recursive: true, force: true }),
		),
	);
});

describe("flub modify fluid-imports", () => {
	it("selects the most stable actual entrypoint from a cumulative seven-entrypoint package graph", async () => {
		const workspace = await createWorkspace();
		await writeFluidPackage(
			workspace,
			cumulativePackageName,
			cumulativePackageDeclarations,
			sevenEntrypointExports,
		);
		const sourceFile = await writeConsumer(
			workspace,
			`import { alphaSymbol, betaSymbol, internalSymbol, legacyAlphaSymbol, legacyBetaSymbol, legacyPublicSymbol, publicSymbol } from "${cumulativePackageName}/internal";

void [alphaSymbol, betaSymbol, internalSymbol, legacyAlphaSymbol, legacyBetaSymbol, legacyPublicSymbol, publicSymbol];
`,
		);

		const { error } = await runFluidImports(workspace, "--quiet");

		expect(error).to.equal(undefined);
		const sourceText = await readFile(sourceFile, "utf8");
		expectImportForSymbol(sourceText, "publicSymbol", cumulativePackageName);
		expectImportForSymbol(sourceText, "betaSymbol", `${cumulativePackageName}/beta`);
		expectImportForSymbol(sourceText, "legacyPublicSymbol", `${cumulativePackageName}/legacy`);
		expectImportForSymbol(
			sourceText,
			"legacyBetaSymbol",
			`${cumulativePackageName}/legacy/beta`,
		);
		expectImportForSymbol(sourceText, "alphaSymbol", `${cumulativePackageName}/alpha`);
		expectImportForSymbol(
			sourceText,
			"legacyAlphaSymbol",
			`${cumulativePackageName}/legacy/alpha`,
		);
		expectImportForSymbol(sourceText, "internalSymbol", `${cumulativePackageName}/internal`);
	});

	it("keeps createChildLogger on /legacy when /internal has an independent same-named API", async () => {
		const workspace = await createWorkspace();
		await writeFluidPackage(
			workspace,
			createChildLoggerPackageName,
			{
				"legacy.d.ts": `
/**
 * @legacy
 * @beta
 */
export declare function createChildLogger(): LegacyLogger;

declare interface LegacyLogger {
	readonly legacy: true;
}
`,
				"internal.d.ts": `
/**
 * @internal
 */
export declare function createChildLogger(): InternalLogger;

declare interface InternalLogger {
	readonly internal: true;
}
`,
			},
			{
				"./legacy": "legacy.d.ts",
				"./internal": "internal.d.ts",
			},
		);
		const sourceFile = await writeConsumer(
			workspace,
			`import { createChildLogger } from "${createChildLoggerPackageName}/legacy";

createChildLogger();
`,
		);

		const { error } = await runFluidImports(workspace, "--quiet");

		expect(error).to.equal(undefined);
		const sourceText = await readFile(sourceFile, "utf8");
		expectImportForSymbol(
			sourceText,
			"createChildLogger",
			`${createChildLoggerPackageName}/legacy`,
		);
	});

	it("keeps public imports public and maps non-public imports to /internal with --onlyInternal", async () => {
		const workspace = await createWorkspace();
		await writeFluidPackage(
			workspace,
			cumulativePackageName,
			cumulativePackageDeclarations,
			sevenEntrypointExports,
		);
		const sourceFile = await writeConsumer(
			workspace,
			`import { alphaSymbol, betaSymbol, internalSymbol, legacyAlphaSymbol, legacyBetaSymbol, legacyPublicSymbol, publicSymbol } from "${cumulativePackageName}";

void [alphaSymbol, betaSymbol, internalSymbol, legacyAlphaSymbol, legacyBetaSymbol, legacyPublicSymbol, publicSymbol];
`,
		);

		const { error } = await runFluidImports(workspace, "--onlyInternal", "--quiet");

		expect(error).to.equal(undefined);
		const sourceText = await readFile(sourceFile, "utf8");
		expectImportForSymbol(sourceText, "publicSymbol", cumulativePackageName);
		for (const symbolName of [
			"alphaSymbol",
			"betaSymbol",
			"internalSymbol",
			"legacyAlphaSymbol",
			"legacyBetaSymbol",
			"legacyPublicSymbol",
		]) {
			expectImportForSymbol(sourceText, symbolName, `${cumulativePackageName}/internal`);
		}
	});

	it("keeps strict duplicate validation for --data", async () => {
		const workspace = await createWorkspace();
		await writeFile(
			path.join(workspace, "api-data.json"),
			JSON.stringify(
				{
					[cumulativePackageName]: [
						{ kind: "function", level: "public", name: "duplicateSymbol" },
						{ kind: "function", level: "beta", name: "duplicateSymbol" },
					],
				},
				undefined,
				"\t",
			),
		);

		const { error } = await runFluidImports(workspace, "--data", "api-data.json", "--quiet");

		expect(error?.message).to.contain('"duplicateSymbol" already has entry mapped');
	});

	it("preserves the /internal eligibility gate for package discovery", async () => {
		const workspace = await createWorkspace();
		await writeFluidPackage(
			workspace,
			noInternalPackageName,
			{
				"public.d.ts": `
/**
 * @public
 */
export declare const publicSymbol: string;
`,
				"beta.d.ts": `
/**
 * @beta
 */
export declare const betaSymbol: string;
`,
			},
			{
				".": "public.d.ts",
				"./beta": "beta.d.ts",
			},
		);
		const sourceFile = await writeConsumer(
			workspace,
			`import { betaSymbol } from "${noInternalPackageName}";

void betaSymbol;
`,
		);

		const { error } = await runFluidImports(workspace, "--quiet");

		expect(error).to.equal(undefined);
		const sourceText = await readFile(sourceFile, "utf8");
		expectImportForSymbol(sourceText, "betaSymbol", noInternalPackageName);
	});
});
