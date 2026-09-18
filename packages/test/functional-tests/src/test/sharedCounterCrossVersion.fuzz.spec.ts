/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import type { AsyncGenerator } from "@fluid-private/stochastic-test-utils";
import { asyncGeneratorFromArray, takeAsync } from "@fluid-private/stochastic-test-utils";
import {
	createDDSFuzzSuite,
	type DDSFuzzModel,
	type DDSFuzzSuiteOptions,
	type DDSFuzzTestState,
	type Synchronize,
} from "@fluid-private/test-dds-utils";
import {
	ensureCompatVersionPairLoaded,
	enumerateCrossClientCompatVersionPairs,
	getLoadedCompatApisForVersionPair,
	type OrderedCompatVersionPairDescriptor,
	type VersionedCompatApis,
} from "@fluid-private/test-version-utils/versioned-apis";
import { assert } from "@fluidframework/core-utils/internal";
import { SharedCounter } from "@fluidframework/counter/internal";

type CounterFactory = ReturnType<typeof SharedCounter.getFactory>;
type CounterFuzzState = DDSFuzzTestState<CounterFactory>;

interface CounterOperation {
	type: "increment";
	incrementAmount: number;
}

interface StashReplacementOperation {
	type: "stashClient";
	existingClientId: string;
	newClientId: string;
	clientVersion: string;
}

type DeterministicStashOperation = CounterOperation | StashReplacementOperation | Synchronize;

interface SharedCounterApi {
	getFactory: () => CounterFactory;
}

function isSharedCounterApi(value: unknown): value is SharedCounterApi {
	if (typeof value !== "object" || value === null || !("getFactory" in value)) {
		return false;
	}
	return typeof value.getFactory === "function";
}

function getSharedCounterFactory(
	ddsApis: VersionedCompatApis["dds"],
): CounterFactory | undefined {
	const sharedCounterApi: unknown = ddsApis.SharedCounter;
	return isSharedCounterApi(sharedCounterApi) ? sharedCounterApi.getFactory() : undefined;
}

function createCounterGenerator(): AsyncGenerator<CounterOperation, CounterFuzzState> {
	return async ({ random }) => ({
		type: "increment",
		incrementAmount: random.integer(-10, 10),
	});
}

function createModel(
	descriptor: OrderedCompatVersionPairDescriptor,
): DDSFuzzModel<CounterFactory, CounterOperation, CounterFuzzState> {
	return {
		workloadName: "SharedCounter cross-version",
		factory: SharedCounter.getFactory(),
		generatorFactory: () => takeAsync(12, createCounterGenerator()),
		reducer: ({ client }, { incrementAmount }) => {
			client.channel.increment(incrementAmount);
		},
		validateConsistency: (clientA, clientB) => {
			assert(
				clientA.channel.value === clientB.channel.value,
				"Counter values should match",
				() => `Counter values do not match for ${descriptor.failureLabel}`,
			);
		},
	};
}

function isLoadableSharedCounterDescriptor(
	descriptor: OrderedCompatVersionPairDescriptor,
): boolean {
	return ![descriptor.createVersion, descriptor.loadVersion].some((version) =>
		version.startsWith("2.0."),
	);
}

const loadableSharedCounterDescriptors = enumerateCrossClientCompatVersionPairs().filter(
	isLoadableSharedCounterDescriptor,
);

function getRequiredInitialClientVersion(
	descriptor: OrderedCompatVersionPairDescriptor,
	index: number,
): string {
	const version = descriptor.topology.initialTopology.clientVersions[index];
	assert(version !== undefined, "Initial client version should exist");
	return version;
}

function createStashReplacementModel(
	descriptor: OrderedCompatVersionPairDescriptor,
): DDSFuzzModel<CounterFactory, DeterministicStashOperation, CounterFuzzState> {
	const firstClientVersion = getRequiredInitialClientVersion(descriptor, 0);
	return {
		workloadName: "SharedCounter cross-version stash replacement",
		factory: SharedCounter.getFactory(),
		generatorFactory: () =>
			asyncGeneratorFromArray<DeterministicStashOperation, CounterFuzzState>([
				{ type: "increment", incrementAmount: 1 },
				{
					type: "stashClient",
					existingClientId: "A",
					newClientId: "A_1",
					clientVersion: firstClientVersion,
				},
				{ type: "synchronize" },
			]),
		reducer: (state, operation) => {
			if (operation.type === "increment") {
				const firstClient = state.clients[0];
				assert(firstClient !== undefined, "First client should exist");
				firstClient.channel.increment(operation.incrementAmount);
			}
		},
		validateConsistency: (clientA, clientB) => {
			assert(
				clientA.channel.value === clientB.channel.value,
				"Counter values should match",
				() => `Counter values do not match for ${descriptor.failureLabel}`,
			);
		},
	};
}

describe("SharedCounter cross-version fuzz", () => {
	for (const descriptor of loadableSharedCounterDescriptors) {
		describe(descriptor.name, () => {
			const factories = new Map<string, CounterFactory>();

			before(async function () {
				this.timeout(180_000);
				await ensureCompatVersionPairLoaded(descriptor);
				const apis = getLoadedCompatApisForVersionPair(descriptor);
				const createFactory = getSharedCounterFactory(apis.dds);
				const loadFactory = getSharedCounterFactory(apis.ddsForLoading);
				assert(createFactory !== undefined, "Create-side SharedCounter should be available");
				assert(loadFactory !== undefined, "Load-side SharedCounter should be available");
				factories.set(descriptor.createVersion, createFactory);
				factories.set(descriptor.loadVersion, loadFactory);
			});

			const options: Partial<DDSFuzzSuiteOptions> = {
				defaultTestCount: 1,
				numberOfClients: descriptor.topology.initialTopology.clientVersions.length,
				detachedStartOptions: {
					numOpsBeforeAttach: 1,
					attachingBeforeRehydrateDisable: true,
				},
				clientJoinOptions: {
					maxNumberOfClients: descriptor.topology.initialTopology.clientVersions.length + 1,
					clientAddProbability: 1,
					stashableClientProbability: 0.2,
				},
				clientVersioning: descriptor.topology,
				factoryForVersion: (version) => {
					const factory = factories.get(version);
					assert(
						factory !== undefined,
						"Versioned SharedCounter factory should be loaded",
						() => `Version ${version} was not loaded for ${descriptor.failureLabel}`,
					);
					return factory;
				},
				rollbackProbability: 0,
				rebaseProbability: 0,
				validationStrategy: { type: "fixedInterval", interval: 5 },
			};

			createDDSFuzzSuite(createModel(descriptor), options);
		});
	}

	const stashReplacementDescriptor = loadableSharedCounterDescriptors[0];
	if (stashReplacementDescriptor !== undefined) {
		describe(`${stashReplacementDescriptor.name} deterministic stash replacement`, () => {
			const factories = new Map<string, CounterFactory>();

			before(async function () {
				this.timeout(180_000);
				await ensureCompatVersionPairLoaded(stashReplacementDescriptor);
				const apis = getLoadedCompatApisForVersionPair(stashReplacementDescriptor);
				const createFactory = getSharedCounterFactory(apis.dds);
				const loadFactory = getSharedCounterFactory(apis.ddsForLoading);
				assert(createFactory !== undefined, "Create-side SharedCounter should be available");
				assert(loadFactory !== undefined, "Load-side SharedCounter should be available");
				factories.set(stashReplacementDescriptor.createVersion, createFactory);
				factories.set(stashReplacementDescriptor.loadVersion, loadFactory);
			});

			const options: Partial<DDSFuzzSuiteOptions> = {
				defaultTestCount: 1,
				numberOfClients:
					stashReplacementDescriptor.topology.initialTopology.clientVersions.length,
				detachedStartOptions: {
					numOpsBeforeAttach: 0,
				},
				clientJoinOptions: {
					maxNumberOfClients:
						stashReplacementDescriptor.topology.initialTopology.clientVersions.length,
					clientAddProbability: 0,
					stashableClientProbability: 1,
				},
				clientVersioning: stashReplacementDescriptor.topology,
				factoryForVersion: (version) => {
					const factory = factories.get(version);
					assert(
						factory !== undefined,
						"Versioned SharedCounter factory should be loaded",
						() =>
							`Version ${version} was not loaded for ${stashReplacementDescriptor.failureLabel}`,
					);
					return factory;
				},
				rollbackProbability: 0,
				rebaseProbability: 0,
				validationStrategy: { type: "fixedInterval", interval: 100 },
			};

			createDDSFuzzSuite(createStashReplacementModel(stashReplacementDescriptor), options);
		});
	}
});
