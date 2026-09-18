/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import * as semver from "semver";

import {
	checkpointResolutionRange,
	getCurrentCheckpoint,
	getInWindowPriorCheckpoints,
} from "./checkpoints.js";
import { installedCompatVersions } from "./compatVersionsManifest.js";
import { pkgVersion } from "./packageVersion.js";

interface TestApiModule {
	ensureVersionLoaded: (baseVersion: string, version: number | string) => Promise<void>;
	getContainerRuntimeApi: (requestedStr: string) => unknown;
	getDataRuntimeApi: (requestedStr: string) => {
		readonly dds: Readonly<Record<string, unknown>>;
		readonly [key: string]: unknown;
	};
	getDriverApi: (requestedStr: string) => unknown;
	getLoaderApi: (requestedStr: string) => unknown;
}

const testApiModulePath = "../lib/testApi.js";
let pendingTestApiModule: Promise<TestApiModule> | undefined;
let loadedTestApiModule: TestApiModule | undefined;

// Keep this subpath's CommonJS build TLA-safe by avoiding a static runtime-utils dependency.
const deployedClientCompatibilityFloor = "2.0.0";

/**
 * Exact-version topology for version-aware DDS fuzz suites.
 *
 * @internal
 */
export interface DDSFuzzClientVersioningTopologyDescriptor {
	readonly versionPair: {
		readonly createVersion: string;
		readonly loadVersion: string;
	};
	readonly initialTopology: {
		readonly detachedClientVersion: string;
		readonly attachLoadClientVersion: string;
		readonly clientVersions: readonly string[];
	};
	readonly dynamicAddClientVersions: readonly string[];
	readonly rehydrateClientVersion?: string;
}

/**
 * Ordered exact-version pair descriptor for cross-client compatibility fuzz tests.
 *
 * @internal
 */
export interface OrderedCompatVersionPairDescriptor {
	readonly name: string;
	readonly createVersion: string;
	readonly loadVersion: string;
	readonly topology: DDSFuzzClientVersioningTopologyDescriptor;
	readonly failureLabel: string;
}

/**
 * Versioned APIs for an ordered cross-client compatibility pair.
 *
 * @internal
 */
export interface VersionedCompatApis {
	readonly mode: "CrossClientCompat";
	readonly containerRuntime: unknown;
	readonly dataRuntime: {
		readonly dds: Readonly<Record<string, unknown>>;
		readonly [key: string]: unknown;
	};
	readonly dds: Readonly<Record<string, unknown>>;
	readonly driver: unknown;
	readonly loader: unknown;
	readonly containerRuntimeForLoading: unknown;
	readonly dataRuntimeForLoading: {
		readonly dds: Readonly<Record<string, unknown>>;
		readonly [key: string]: unknown;
	};
	readonly ddsForLoading: Readonly<Record<string, unknown>>;
	readonly driverForLoading: unknown;
	readonly loaderForLoading: unknown;
}

function sanitizeLabelSegment(segment: string): string {
	return segment.replace(/[^\d+.A-Za-z-]+/g, "-");
}

function createFailureLabel(topology: DDSFuzzClientVersioningTopologyDescriptor): string {
	const { createVersion, loadVersion } = topology.versionPair;
	const { detachedClientVersion, attachLoadClientVersion, clientVersions } =
		topology.initialTopology;
	const parts = [
		`create-${createVersion}`,
		`load-${loadVersion}`,
		`detached-${detachedClientVersion}`,
		`attachLoad-${attachLoadClientVersion}`,
		`clients-${clientVersions.join("+")}`,
	];
	if (topology.rehydrateClientVersion !== undefined) {
		parts.push(`rehydrate-${topology.rehydrateClientVersion}`);
	}
	return parts.map(sanitizeLabelSegment).join("__");
}

function resolveRangeViaManifest(rangeSpec: string): string {
	if (semver.valid(rangeSpec)) {
		return rangeSpec;
	}
	if (!semver.validRange(rangeSpec)) {
		throw new Error(`Invalid semver range: "${rangeSpec}"`);
	}
	const matching = installedCompatVersions
		.filter((v) => semver.valid(v) && semver.satisfies(v, rangeSpec))
		.sort(semver.rcompare);
	if (matching.length > 0) {
		return matching[0];
	}
	throw new Error(`No version in manifest satisfies range: "${rangeSpec}"`);
}

function createDescriptor(versionDetails: {
	createVersion: string;
	loadVersion: string;
	createDelta: string;
	loadDelta: string;
}): OrderedCompatVersionPairDescriptor {
	const { createVersion, loadVersion, createDelta, loadDelta } = versionDetails;
	const topology: DDSFuzzClientVersioningTopologyDescriptor = {
		versionPair: {
			createVersion,
			loadVersion,
		},
		initialTopology: {
			detachedClientVersion: createVersion,
			attachLoadClientVersion: loadVersion,
			clientVersions: [loadVersion, loadVersion, createVersion],
		},
		dynamicAddClientVersions: [createVersion, loadVersion],
		rehydrateClientVersion: loadVersion,
	};

	return {
		name: `compat cross-client - create with ${createVersion} (${createDelta}) + load with ${loadVersion} (${loadDelta})`,
		createVersion,
		loadVersion,
		topology,
		failureLabel: createFailureLabel(topology),
	};
}

async function getTestApiModule(): Promise<TestApiModule> {
	pendingTestApiModule ??= import(testApiModulePath).then((module): TestApiModule => {
		const loaded = module as TestApiModule;
		loadedTestApiModule = loaded;
		return loaded;
	});
	return pendingTestApiModule;
}

function getLoadedTestApiModule(): TestApiModule {
	if (loadedTestApiModule === undefined) {
		throw new Error("Call ensureCompatVersionPairLoaded before getting compat APIs.");
	}
	return loadedTestApiModule;
}

/**
 * Synchronously enumerates the ordered exact-version pairs used by cross-client compat tests.
 *
 * @internal
 */
export function enumerateCrossClientCompatVersionPairs(): readonly OrderedCompatVersionPairDescriptor[] {
	const currentVersion = pkgVersion;
	const deltaVersions: Map<string, string> = new Map();
	const current = getCurrentCheckpoint(pkgVersion);

	const currentCheckpointVersion = resolveRangeViaManifest(checkpointResolutionRange(current));
	if (currentCheckpointVersion !== currentVersion) {
		deltaVersions.set(currentCheckpointVersion, current.name);
	}

	for (const c of getInWindowPriorCheckpoints(current, deployedClientCompatibilityFloor)) {
		const v = resolveRangeViaManifest(checkpointResolutionRange(c));
		deltaVersions.set(v, c.name);
	}

	const descriptors: OrderedCompatVersionPairDescriptor[] = [];
	for (const [v, delta] of deltaVersions) {
		descriptors.push(
			createDescriptor({
				createVersion: currentVersion,
				loadVersion: v,
				createDelta: "N",
				loadDelta: delta,
			}),
		);
	}
	for (const [v, delta] of deltaVersions) {
		descriptors.push(
			createDescriptor({
				createVersion: v,
				loadVersion: currentVersion,
				createDelta: delta,
				loadDelta: "N",
			}),
		);
	}

	return descriptors;
}

/**
 * Ensures both exact versions for the descriptor are loaded before synchronous API getters are used.
 *
 * @internal
 */
export async function ensureCompatVersionPairLoaded(
	descriptor: OrderedCompatVersionPairDescriptor,
): Promise<void> {
	const { ensureVersionLoaded } = await getTestApiModule();
	await Promise.all([
		ensureVersionLoaded(descriptor.createVersion, 0),
		ensureVersionLoaded(descriptor.loadVersion, 0),
	]);
}

/**
 * Gets synchronously available compat APIs for a descriptor after
 * {@link ensureCompatVersionPairLoaded} has completed.
 *
 * @internal
 */
export function getLoadedCompatApisForVersionPair(
	descriptor: OrderedCompatVersionPairDescriptor,
): VersionedCompatApis {
	const { getContainerRuntimeApi, getDataRuntimeApi, getDriverApi, getLoaderApi } =
		getLoadedTestApiModule();
	const dataRuntime = getDataRuntimeApi(descriptor.createVersion);
	const dataRuntimeForLoading = getDataRuntimeApi(descriptor.loadVersion);
	return {
		mode: "CrossClientCompat",
		containerRuntime: getContainerRuntimeApi(descriptor.createVersion),
		containerRuntimeForLoading: getContainerRuntimeApi(descriptor.loadVersion),
		dataRuntime,
		dataRuntimeForLoading,
		dds: dataRuntime.dds,
		ddsForLoading: dataRuntimeForLoading.dds,
		driver: getDriverApi(descriptor.createVersion),
		driverForLoading: getDriverApi(descriptor.loadVersion),
		loader: getLoaderApi(descriptor.createVersion),
		loaderForLoading: getLoaderApi(descriptor.loadVersion),
	};
}
