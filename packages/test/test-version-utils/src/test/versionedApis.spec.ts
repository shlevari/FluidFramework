/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

import { pkgVersion } from "../packageVersion.js";
import {
	ensureCompatVersionPairLoaded,
	enumerateCrossClientCompatVersionPairs,
	getLoadedCompatApisForVersionPair,
} from "../versionedApis.js";

const versionedApisCjsConfigPath = fileURLToPath(
	new URL("../../tsconfig.versioned-apis.cjs.json", import.meta.url),
);
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

function getResolvedVersionedApisCjsRootFiles(): string[] {
	const configFile = ts.readConfigFile(versionedApisCjsConfigPath, ts.sys.readFile);
	if (configFile.error !== undefined) {
		throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
	}
	const parsedConfig = ts.parseJsonConfigFileContent(
		configFile.config,
		ts.sys,
		packageRoot,
		{},
		versionedApisCjsConfigPath,
	);
	return parsedConfig.fileNames.map((fileName) =>
		path.relative(packageRoot, fileName).replaceAll("\\", "/"),
	);
}

describe("versionedApis", () => {
	const descriptors = enumerateCrossClientCompatVersionPairs();

	it("declares a CommonJS require condition for the TLA-free subpath", () => {
		const packageJson = JSON.parse(
			readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
		) as {
			exports: Record<string, unknown>;
		};

		assert.deepEqual(packageJson.exports["./versioned-apis"], {
			import: {
				types: "./lib/versionedApis.d.ts",
				default: "./lib/versionedApis.js",
			},
			require: {
				types: "./dist/versionedApis.d.ts",
				default: "./dist/versionedApis.js",
			},
		});
	});

	it("resolves only the TLA-free versioned API file as the CommonJS build root", () => {
		const rootFiles = getResolvedVersionedApisCjsRootFiles();

		assert.deepEqual(rootFiles, ["src/versionedApis.ts"]);
		assert(!rootFiles.includes("src/describeCompat.ts"));
	});

	it("synchronously enumerates ordered exact version-pair descriptors", () => {
		assert.notEqual(descriptors.length, 0, "Expected cross-client version descriptors");

		for (const descriptor of descriptors) {
			assert(descriptor.name.includes(descriptor.createVersion));
			assert(descriptor.name.includes(descriptor.loadVersion));
			assert(descriptor.failureLabel.includes(`create-${descriptor.createVersion}`));
			assert(descriptor.failureLabel.includes(`load-${descriptor.loadVersion}`));
			assert.equal(descriptor.topology.versionPair.createVersion, descriptor.createVersion);
			assert.equal(descriptor.topology.versionPair.loadVersion, descriptor.loadVersion);
		}
	});

	it("loads exact versions before synchronous API getters are used", async function () {
		this.timeout(180_000);

		const descriptor = descriptors.find(
			(d) => d.createVersion !== pkgVersion || d.loadVersion !== pkgVersion,
		);
		assert(descriptor !== undefined, "Expected at least one non-current compat pair");

		await ensureCompatVersionPairLoaded(descriptor);
		const apis = getLoadedCompatApisForVersionPair(descriptor);

		assert.equal(
			(apis.containerRuntime as { version: string }).version,
			descriptor.createVersion,
		);
		assert.equal(apis.dataRuntime.version, descriptor.createVersion);
		assert.equal((apis.loader as { version: string }).version, descriptor.createVersion);
		assert.equal(
			(apis.containerRuntimeForLoading as { version: string }).version,
			descriptor.loadVersion,
		);
		assert.equal(apis.dataRuntimeForLoading.version, descriptor.loadVersion);
		assert.equal(
			(apis.loaderForLoading as { version: string }).version,
			descriptor.loadVersion,
		);
		assert.equal(apis.mode, "CrossClientCompat");
	});
});
