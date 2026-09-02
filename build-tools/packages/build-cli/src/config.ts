/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { statSync } from "node:fs";
import {
	DEFAULT_INTERDEPENDENCY_RANGE,
	type InterdependencyRange,
} from "@fluid-tools/version-tools";
import { MonoRepo } from "@fluidframework/build-tools";
import { lilconfigSync } from "lilconfig";
import type { Context } from "./library/context.js";
import type { ReleaseGroup } from "./releaseGroups.js";

/**
 * Flub configuration that is expected in the flub config file or package.json.
 */
export interface FlubConfig {
	/**
	 * The version of the config.
	 *
	 * IMPORTANT: this will become required in a future release.
	 *
	 * @remarks
	 *
	 * For backwards-compatibility with the fluidBuild config file - that is, supporting both the flub config and the
	 * fluidBuild config in the same config file - this value must match the version value of the
	 * fluidBuildConfig. Once they diverge, the flub config must be separate from the fluidBuild config.
	 *
	 * In other words, version 1 is the only version of the configs where they can be stored in the same file.
	 */
	version?: 1;

	/**
	 * Ponfiguration for the `check:policy` command.
	 */
	policy?: PolicyConfig;

	/**
	 * Configuration for assert tagging.
	 * @remarks
	 * Some of this applies to the root where flub is being run,
	 * and some of it applies to the specific package being processed.
	 * @privateRemarks
	 * It seems like having each package have its own configuration would be simpler.
	 */
	assertTagging?: AssertTaggingConfig;

	/**
	 * Configuration for `flub bump`.
	 */
	bump?: BumpConfig;

	/**
	 * Configuration for the `generate:releaseNotes` command.
	 */
	releaseNotes?: ReleaseNotesConfig;

	/**
	 * Configuration for `release report` command
	 */
	releaseReport?: ReleaseReportConfig;
}

/**
 * Configuration for the `release report` command. If this configuration is not present in the config, the
 * `release report` command will report an error.
 */
export interface ReleaseReportConfig {
	/**
	 * Each key in the `legacyCompatInterval` object represents a specific release group or package name as string,
	 * and the associated value is a number that defines the legacy compatibility interval for that group.
	 */
	legacyCompatInterval: Record<ReleaseGroup | string, number>;
}

/**
 * A short name for the section. Each section in a {@link ReleaseNotesConfig} must have a unique name.
 */
export type ReleaseNotesSectionName = string;

/**
 * Configuration for a release notes section.
 */
export interface ReleaseNotesSection {
	/**
	 * A full string to serve as the heading for the section when displayed in release notes.
	 */
	heading: string;
}

/**
 * Configuration for the `generate:releaseNotes` command. If this configuration is not present in the config, the
 * `generate:releaseNotes` command will report an error.
 */
export interface ReleaseNotesConfig {
	sections: Record<ReleaseNotesSectionName, ReleaseNotesSection>;
}

/**
 * Policy configuration for the `check:policy` command.
 */
export interface PolicyConfig {
	additionalLockfilePaths?: string[];
	pnpmSinglePackageWorkspace?: string[];
	fluidBuildTasks: {
		tsc: {
			ignoreTasks: string[];
			ignoreDependencies: string[];
			ignoreDevDependencies: string[];
		};
	};
	dependencies?: {
		commandPackages: [string, string][];
	};
	/**
	 * An array of strings/regular expressions. Paths that match any of these expressions will be completely excluded from
	 * policy-check.
	 */
	exclusions?: string[];

	/**
	 * An object with handler name as keys that maps to an array of strings/regular expressions to
	 * exclude that rule from being checked.
	 */
	handlerExclusions?: { [rule: string]: (string | RegExp)[] };

	packageNames?: PackageNamePolicyConfig;

	/**
	 * (optional) requirements to enforce against each public package.
	 */
	publicPackageRequirements?: PackageRequirements;
}

/**
 * Used by `TagAssertsCommand`.
 */
export interface AssertTaggingConfig {
	/**
	 * An array of paths under which assert tagging applies to. If this setting is provided, only packages whose paths
	 * match the regular expressions in this setting will be assert-tagged.
	 *
	 * This is used from the root where flub is run.
	 * TODO: this should be replaced by package selection flags passed to the command.
	 */
	enabledPaths?: RegExp[];
}

/**
 * Configuration settings that influence `flub bump`.
 */
export interface BumpConfig {
	/**
	 * The interdependencyRange controls the type of semver range to use between packages in the same release group. This
	 * setting controls the default range that will be used when updating the version of a release group. The default can
	 * be overridden using the `--interdependencyRange` flag in the `flub bump` command.
	 */
	defaultInterdependencyRange?: Record<ReleaseGroup, InterdependencyRange>;
}

/**
 * Configuration for package naming and publication policies.
 */
export interface PackageNamePolicyConfig {
	/**
	 * A list of package scopes that are permitted in the repo.
	 */
	allowedScopes?: string[];
	/**
	 * A list of packages that have no scope.
	 */
	unscopedPackages?: string[];
	/**
	 * Packages that must be published.
	 */
	mustPublish: {
		/**
		 * A list of package names or scopes that must publish to npm, and thus should never be marked private.
		 */
		npm?: string[];

		/**
		 * A list of package names or scopes that must publish to an internal feed, and thus should always be marked
		 * private.
		 */
		internalFeed?: string[];
	};

	/**
	 * Packages that may or may not be published.
	 */
	mayPublish: {
		/**
		 * A list of package names or scopes that may publish to npm, and thus might or might not be marked private.
		 */
		npm?: string[];

		/**
		 * A list of package names or scopes that must publish to an internal feed, and thus might or might not be marked
		 * private.
		 */
		internalFeed?: string[];
	};
}

/**
 * Expresses requirements for a given package, applied to its package.json.
 */
export interface PackageRequirements {
	/**
	 * (optional) list of script requirements for the package.
	 */
	requiredScripts?: ScriptRequirement[];

	/**
	 * (optional) list of required dev dependencies for the package.
	 * @remarks Note: there is no enforcement of version requirements, only that a dependency on the specified name must exist.
	 */
	requiredDevDependencies?: string[];
}

/**
 * Requirements for a given script.
 */
export interface ScriptRequirement {
	/**
	 * Name of the script to check.
	 */
	name: string;

	/**
	 * Body of the script being checked.
	 * A contents match will be enforced iff {@link ScriptRequirement.bodyMustMatch}.
	 * This value will be used as the default contents inserted by the policy resolver (regardless of {@link ScriptRequirement.bodyMustMatch}).
	 */
	body: string;

	/**
	 * Whether or not the script body is required to match {@link ScriptRequirement.body} when running the policy checker.
	 * @defaultValue `false`
	 */
	bodyMustMatch?: boolean;
}

const configName = "flub";

/**
 * A lilconfig explorer to find the fluidBuild config. First looks for javascript config files and falls back to the
 * fluidBuild property in package.json. We create a single explorer here because lilconfig internally caches configs
 * for performance. The cache is per-explorer, so re-using the same explorer is a minor perf improvement.
 */
const configExplorer = lilconfigSync(configName, {
	searchPlaces: [
		// `${configName}.ts`,
		`${configName}.config.cjs`,
		`${configName}.config.js`,
		// Back-compat entries - we'll load settings from the old fluidBuild config files if present.
		"fluidBuild.config.cjs",
		"fluidBuild.config.js",
		"package.json",
	],
	packageProp: [
		configName,
		// Back-compat entry
		"fluidBuild",
	],
});

/**
 * Get an IFlubConfig from the flub property in a package.json file, or from flub.config.[c]js.
 *
 * @param configPath - The path to start searching for the config file. If a path to a file is provided, the file will
 * be loaded directly. Otherwise it will search upwards looking for config files until it finds one.
 * @param noCache - If true, the config cache will be cleared and the config will be reloaded.
 * @returns The flub config
 */
export function getFlubConfig(configPath: string, noCache = false): FlubConfig {
	if (noCache === true) {
		configExplorer.clearCaches();
	}

	// const configResult = configExplorer.search(rootDir);

	const configResult = statSync(configPath).isFile()
		? configExplorer.load(configPath)
		: configExplorer.search(configPath);

	const config = configResult?.config as FlubConfig | undefined;

	if (config === undefined) {
		throw new Error(`No flub configuration found (configPath='${configPath}').`);
	}

	// Only version 1 of the config is supported. If any other value is provided, throw an error.
	if ((config.version ?? 1) !== 1) {
		throw new Error(
			`Configuration version is not supported: ${config?.version}. Config version must be 1.`,
		);
	}

	return config;
}

/**
 * Convenience function to extract the default interdependency range for a release group from the flub config. For
 * back-compat, it will also load the relevant setting from the fluid-build config.
 */
export function getDefaultInterdependencyRange(
	releaseGroup: ReleaseGroup | MonoRepo,
	context: Context,
): InterdependencyRange {
	const releaseGroupName = releaseGroup instanceof MonoRepo ? releaseGroup.name : releaseGroup;

	// Prefer to use the configuration in the flub config if available.
	const flubConfigRanges = context.flubConfig.bump?.defaultInterdependencyRange;
	const interdependencyRangeFromFlubConfig: InterdependencyRange | undefined =
		flubConfigRanges?.[releaseGroupName as ReleaseGroup];

	// Return early if the flub config had a range configured - no need to check/load other configs.
	if (interdependencyRangeFromFlubConfig !== undefined) {
		return interdependencyRangeFromFlubConfig;
	}

	// For back-compat with earlier configs, try to load the default interdependency range from the fluid-build config.
	// This can be removed once we are no longer supporting release branches older than release/client/2.4
	const fbConfig = context.fluidBuildConfig.repoPackages?.[releaseGroupName];
	const interdependencyRangeFromFluidBuildConfig =
		fbConfig !== undefined && typeof fbConfig === "object" && !Array.isArray(fbConfig)
			? fbConfig.defaultInterdependencyRange
			: undefined;

	// Once the back-compat code above is removed, this should change to
	// return interdependencyRangeFromFlubConfig ?? DEFAULT_INTERDEPENDENCY_RANGE
	return interdependencyRangeFromFluidBuildConfig ?? DEFAULT_INTERDEPENDENCY_RANGE;
}
