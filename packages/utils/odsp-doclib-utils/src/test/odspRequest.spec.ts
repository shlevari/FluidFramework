/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { strict as assert } from "node:assert";

import type { IOdspAuthRequestInfo } from "../odspAuth.js";
import { getAsync, postAsync, putAsync, unauthPostAsync } from "../odspRequest.js";

describe("odspRequest auth host guard", () => {
	const authInfo: IOdspAuthRequestInfo = { accessToken: "secret-access-token" };
	let fetchCount: number;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		fetchCount = 0;
		originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			fetchCount += 1;
			return new Response("{}", { status: 200 });
		}) as typeof globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("rejects a non-ODSP host before calling fetch", async () => {
		await assert.rejects(getAsync("https://evil.example.com/api", authInfo), /non-ODSP host/);
		assert.strictEqual(fetchCount, 0);
	});

	it("rejects the loose evil-suffix host before calling fetch", async () => {
		await assert.rejects(
			getAsync("https://evilsharepoint.com/api", authInfo),
			/non-ODSP host/,
		);
		assert.strictEqual(fetchCount, 0);
	});

	it("rejects a non-HTTPS ODSP host before calling fetch", async () => {
		await assert.rejects(getAsync("http://contoso.sharepoint.com/api", authInfo), /non-HTTPS/);
		assert.strictEqual(fetchCount, 0);
	});

	it("allows a valid SPO host over https", async () => {
		const response = await getAsync(
			"https://contoso.sharepoint.com/_api/v2.1/drive",
			authInfo,
		);
		assert.strictEqual(response.status, 200);
		assert.strictEqual(fetchCount, 1);
	});

	it("allows localhost over http", async () => {
		const response = await getAsync("http://localhost:8080/api", authInfo);
		assert.strictEqual(response.status, 200);
		assert.strictEqual(fetchCount, 1);
	});

	it("guards putAsync and postAsync the same way", async () => {
		await assert.rejects(putAsync("https://evil.example.com/api", authInfo), /non-ODSP host/);
		await assert.rejects(
			postAsync("https://evil.example.com/api", undefined, authInfo),
			/non-ODSP host/,
		);
		assert.strictEqual(fetchCount, 0);
	});

	it("does not guard the unauthenticated unauthPostAsync", async () => {
		const response = await unauthPostAsync("https://any.example.com/api", undefined);
		assert.strictEqual(response.status, 200);
		assert.strictEqual(fetchCount, 1);
	});
});
