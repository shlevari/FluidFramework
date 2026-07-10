/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { type IOdspAuthRequestInfo, authRequestWithRetry } from "./odspAuth.js";
import { isOdspHostname, isPushChannelHostname } from "./odspDocLibUtils.js";

// eslint-disable-next-line jsdoc/require-description -- TODO: Add documentation
/**
 * @internal
 */
export async function getAsync(
	url: string,
	authRequestInfo: IOdspAuthRequestInfo,
): Promise<Response> {
	assertOdspAuthHost(url);
	return authRequest(authRequestInfo, async (config: RequestInit) => fetch(url, config));
}

// eslint-disable-next-line jsdoc/require-description -- TODO: Add documentation
/**
 * @internal
 */
export async function putAsync(
	url: string,
	authRequestInfo: IOdspAuthRequestInfo,
): Promise<Response> {
	assertOdspAuthHost(url);
	return authRequest(authRequestInfo, async (config: RequestInit) => {
		const putConfig = {
			...config,
			method: "PUT",
		};
		return fetch(url, putConfig);
	});
}

// eslint-disable-next-line jsdoc/require-description -- TODO: Add documentation
/**
 * @internal
 */
export async function postAsync(
	url: string,
	body: BodyInit | undefined,
	authRequestInfo: IOdspAuthRequestInfo,
): Promise<Response> {
	assertOdspAuthHost(url);
	return authRequest(authRequestInfo, async (config: RequestInit) => {
		const postConfig = {
			...config,
			body,
			method: "POST",
		};
		return fetch(url, postConfig);
	});
}

// eslint-disable-next-line jsdoc/require-description -- TODO: Add documentation
/**
 * @internal
 */
export async function unauthPostAsync(
	url: string,
	body: BodyInit | undefined,
): Promise<Response> {
	return safeRequestCore(async () => {
		return fetch(url, { body, method: "POST" });
	});
}

async function authRequest(
	authRequestInfo: IOdspAuthRequestInfo,
	requestCallback: (config: RequestInit) => Promise<Response>,
): Promise<Response> {
	return authRequestWithRetry(authRequestInfo, async (config: RequestInit) =>
		safeRequestCore(async () => requestCallback(config)),
	);
}

/**
 * Guard the ODSP auth choke point: refuse to attach an `Authorization` header to a request for a host
 * that is not a trusted ODSP endpoint, or over a non-HTTPS connection (localhost excepted). This keeps
 * bearer tokens from ever being sent to an arbitrary or plaintext origin.
 */
function assertOdspAuthHost(url: string): void {
	let host: string;
	let protocol: string;
	try {
		const parsed = new URL(url);
		host = parsed.hostname;
		protocol = parsed.protocol;
	} catch {
		throw new Error("Refusing to attach Authorization header to an invalid URL");
	}
	const isLocalhost = host === "localhost";
	if (!(isOdspHostname(host) || isPushChannelHostname(host) || isLocalhost)) {
		throw new Error(`Refusing to attach Authorization header for non-ODSP host: ${host}`);
	}
	if (protocol !== "https:" && !isLocalhost) {
		throw new Error(`Refusing to attach Authorization header over non-HTTPS to host: ${host}`);
	}
}

async function safeRequestCore(requestCallback: () => Promise<Response>): Promise<Response> {
	let response: Response;
	try {
		response = await requestCallback();
	} catch (error: unknown) {
		// TODO: narrow to a real error type here
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
		if ((error as any)?.response?.status) {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
			response = (error as any).response;
		} else {
			throw error;
		}
	}
	return response;
}
