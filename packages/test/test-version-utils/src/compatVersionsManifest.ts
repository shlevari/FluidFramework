/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

// This package owns the generated compat manifest; keep the exception localized so
// versioned-apis can remain a TLA-safe subpath for CommonJS consumers.
// eslint-disable-next-line import-x/no-internal-modules
import generatedVersionsManifest from "../compat-workspaces/generated-versions.cjs";

/**
 * Exact versions installed in the committed compat workspace.
 *
 * @internal
 */
export const installedCompatVersions: readonly string[] = (
	generatedVersionsManifest as { versions: string[] }
).versions;
