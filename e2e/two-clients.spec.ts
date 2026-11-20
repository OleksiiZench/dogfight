import { expect, type Page, test } from "@playwright/test";

interface Point {
	x: number;
	y: number;
}

async function joinRoom(page: Page, name: string): Promise<void> {
	await page.goto("/?debug");
	await expect(page.locator(".join-form [name=name]")).toBeVisible();
	await expect(
		page.locator('.join-form [name=room] option[value="training"]'),
	).toHaveCount(1);
	await page.locator(".join-form [name=name]").fill(name);
	await page.locator(".join-form [name=room]").selectOption("training");
	await page.locator('.join-form button[type="submit"]').click();
	await expect(page.locator(".status")).toContainText(/Ви в кімнаті/);
	await expect(page.locator(".start")).toBeEnabled();
}

async function startMatch(page: Page): Promise<void> {
	await page.locator(".start").click();
	await expect(page.locator(".game-chat")).toBeVisible();
	await expect
		.poll(async () =>
			page.evaluate(() => Boolean(window.__dogfight?.predictor.visualPos)),
		)
		.toBe(true);
}

async function shipPositions(page: Page): Promise<Point[]> {
	return page.evaluate(() => {
		const game = window.__dogfight;
		if (!game) return [];
		return [...game.matchView.lastEntityData.values()]
			.filter((entity) => entity.kind === "ship")
			.map((entity) => ({ x: entity.x, y: entity.y }))
			.sort((a, b) => a.x + a.y - (b.x + b.y));
	});
}

function moved(before: Point[], after: Point[], threshold = 3): boolean {
	if (before.length === 0 || before.length !== after.length) return false;
	return before.some((point, index) => {
		const next = after[index];
		if (!next) return false;
		return Math.hypot(next.x - point.x, next.y - point.y) > threshold;
	});
}

test("two clients share a room, chat and observe movement", async ({
	browser,
	baseURL,
}) => {
	const firstContext = await browser.newContext({ baseURL });
	const secondContext = await browser.newContext({ baseURL });
	const alpha = await firstContext.newPage();
	const beta = await secondContext.newPage();
	const errors: string[] = [];
	for (const page of [alpha, beta]) {
		page.on("pageerror", (error) => errors.push(error.message));
	}

	try {
		await joinRoom(alpha, "Alpha");
		await joinRoom(beta, "Beta");
		await startMatch(alpha);
		await startMatch(beta);

		await alpha.screenshot({
			path: "docs/assets/lab-07-two-clients.png",
			fullPage: true,
		});

		await alpha.locator('.game-chat [name="message"]').fill("ping from Alpha");
		await alpha.locator('.game-chat button[type="submit"]').click();
		await expect(beta.locator(".chat-log")).toContainText(
			"Alpha: ping from Alpha",
		);

		const before = await shipPositions(beta);
		expect(before.length).toBeGreaterThanOrEqual(2);
		const startedAt = Date.now();
		let latencyMs = Number.POSITIVE_INFINITY;
		await alpha.keyboard.down("ArrowUp");
		try {
			for (let attempt = 0; attempt < 40; attempt++) {
				const after = await shipPositions(beta);
				if (moved(before, after)) {
					latencyMs = Date.now() - startedAt;
					break;
				}
				await beta.waitForTimeout(25);
			}
		} finally {
			await alpha.keyboard.up("ArrowUp");
		}

		expect(latencyMs).toBeLessThan(500);
		await expect
			.poll(
				async () =>
					alpha.evaluate(
						() => window.__dogfight?.loop.stats.framesPerSecond ?? 0,
					),
				{ timeout: 5_000 },
			)
			.toBeGreaterThan(0);
		const stats = await alpha.evaluate(() => window.__dogfight?.loop.stats);
		expect(stats?.frameTime ?? 0).toBeLessThanOrEqual(20);
		expect(errors).toEqual([]);
	} finally {
		await firstContext.close();
		await secondContext.close();
	}
});
