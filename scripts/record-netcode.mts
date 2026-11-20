import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";

const CDP = "http://127.0.0.1:9225";
const FRAMES = "/tmp/opencode/netcode-frames";
const OUTPUT = "docs/assets/lab-05-two-player.gif";
const urls = [
	"http://localhost:3001/?debug=1&latency=100&jitter=30&drop=0.02&pilot=Alpha",
	"http://localhost:3001/?debug=1&latency=100&jitter=30&drop=0.02&pilot=Beta",
];
const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

interface CdpTarget {
	type: string;
	url: string;
	webSocketDebuggerUrl: string;
}

interface CdpSession {
	ws: WebSocket;
	send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

interface PageClient extends CdpSession {
	url: string;
	evaluate(expression: string): Promise<unknown>;
	waitFor(expression: string, label: string): Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const browser = spawn(
	"chromium",
	[
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		"--mute-audio",
		"--disable-background-timer-throttling",
		"--disable-backgrounding-occluded-windows",
		"--disable-renderer-backgrounding",
		"--window-size=1280,720",
		"--remote-debugging-port=9225",
		"--user-data-dir=/tmp/opencode/chrome-record",
		"about:blank",
	],
	{ stdio: "ignore" },
);

async function transport(wsUrl: string): Promise<CdpSession> {
	const ws = new WebSocket(wsUrl);
	await new Promise<void>((resolve, reject) => {
		ws.onopen = () => resolve();
		ws.onerror = (event) => reject(event);
	});
	let id = 1;
	const pending = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (reason: unknown) => void;
		}
	>();
	ws.onmessage = ({ data }) => {
		const raw: unknown = JSON.parse(String(data));
		if (!isRecord(raw) || typeof raw.id !== "number" || !raw.id) return;
		const messageId = raw.id;
		const callbacks = pending.get(messageId);
		if (!callbacks) return;
		pending.delete(messageId);
		if (raw.error) callbacks.reject(new Error(JSON.stringify(raw.error)));
		else callbacks.resolve(raw.result);
	};
	const send = (
		method: string,
		params: Record<string, unknown> = {},
	): Promise<unknown> =>
		new Promise((resolve, reject) => {
			const next = id++;
			pending.set(next, { resolve, reject });
			ws.send(JSON.stringify({ id: next, method, params }));
		});
	return { ws, send };
}

async function pageClient(target: CdpTarget): Promise<PageClient> {
	const base = await transport(target.webSocketDebuggerUrl);
	const evaluate = async (expression: string): Promise<unknown> => {
		const response: unknown = await base.send("Runtime.evaluate", {
			expression,
			returnByValue: true,
			awaitPromise: true,
		});
		if (!isRecord(response))
			throw new TypeError("invalid Runtime.evaluate response");
		if (isRecord(response.exceptionDetails))
			throw new Error(String(response.exceptionDetails.text));
		if (!isRecord(response.result))
			throw new TypeError("invalid Runtime.evaluate response");
		return response.result.value;
	};
	const waitFor = async (expression: string, label: string): Promise<void> => {
		for (let i = 0; i < 150; i++) {
			if (await evaluate(expression)) return;
			await sleep(100);
		}
		throw new Error(`timeout waiting for ${label}`);
	};
	return { ...base, evaluate, waitFor, url: target.url };
}

type KeyName = "ArrowUp" | "ArrowLeft" | "ArrowRight" | "Space";
interface CdpKey {
	key: string;
	code: string;
	windowsVirtualKeyCode: number;
}
const KEYS: Record<KeyName, CdpKey> = {
	ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
	ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
	ArrowRight: {
		key: "ArrowRight",
		code: "ArrowRight",
		windowsVirtualKeyCode: 39,
	},
	Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32 },
};

const held = new WeakMap<PageClient, Set<KeyName>>();

async function setKey(
	page: PageClient,
	name: KeyName,
	down: boolean,
): Promise<void> {
	const state = held.get(page) ?? new Set<KeyName>();
	held.set(page, state);
	if (state.has(name) === down) return;
	const definition = KEYS[name];
	await page.send("Input.dispatchKeyEvent", {
		type: down ? "keyDown" : "keyUp",
		...definition,
	});
	if (down) state.add(name);
	else state.delete(name);
}

for (let i = 0; i < 60; i++) {
	try {
		if ((await fetch(`${CDP}/json/version`)).ok) break;
	} catch {}
	await sleep(100);
}

const version: unknown = await fetch(`${CDP}/json/version`).then((r) =>
	r.json(),
);
if (!isRecord(version) || typeof version.webSocketDebuggerUrl !== "string")
	throw new TypeError("invalid browser version response");
const browserSession = await transport(version.webSocketDebuggerUrl);
for (const url of urls) {
	await browserSession.send("Target.createTarget", { url });
}
const targetList: unknown = await fetch(`${CDP}/json/list`).then((r) =>
	r.json(),
);
if (!Array.isArray(targetList))
	throw new TypeError("invalid target list response");
const targetsRaw: unknown[] = targetList;
const targets: CdpTarget[] = targetsRaw
	.filter(
		(target): target is CdpTarget =>
			isRecord(target) &&
			target.type === "page" &&
			typeof target.url === "string" &&
			target.url.includes("pilot=") &&
			typeof target.webSocketDebuggerUrl === "string",
	)
	.sort((a, b) => a.url.localeCompare(b.url));
const pages: PageClient[] = await Promise.all(targets.map(pageClient));

try {
	for (const page of pages) {
		await page.send("Page.enable");
		await page.send("Runtime.enable");
		const name = page.url.includes("pilot=Beta") ? "Beta" : "Alpha";
		await page.waitFor(
			"document.querySelectorAll('select[name=room] option').length > 0",
			`rooms ${name}`,
		);
		await page.evaluate(
			`document.querySelector('[name=name]').value = '${name}'`,
		);
		await page.evaluate(
			`document.querySelector('.join-form button[type=submit]').click()`,
		);
		await page.waitFor(
			"!document.querySelector('.lobby-actions button.start').disabled",
			`join ${name}`,
		);
		await page.evaluate(
			`document.querySelector('.lobby-actions button.start').click()`,
		);
		await page.waitFor("!!window.__dogfight?.predictor?.ship", `ship ${name}`);
	}

	await rm(FRAMES, { recursive: true, force: true });
	await mkdir(FRAMES, { recursive: true });
	const directions: number[] = [1, -1];
	const turnKeys: readonly (readonly [KeyName, KeyName])[] = [
		["ArrowLeft", "ArrowRight"],
		["ArrowRight", "ArrowLeft"],
	];
	for (let i = 0; i < pages.length; i++) {
		const page = pages[i];
		const keys = turnKeys[i];
		const direction = directions[i];
		if (!page || !keys || direction === undefined)
			throw new TypeError("missing page or turn keys");
		await setKey(page, "ArrowUp", true);
		await setKey(page, "Space", true);
		await setKey(page, keys[direction > 0 ? 1 : 0], true);
	}

	for (let frame = 0; frame < 200; frame++) {
		if (frame % 20 === 0) {
			for (let i = 0; i < pages.length; i++) {
				const page = pages[i];
				const keys = turnKeys[i];
				const direction = directions[i];
				if (!page || !keys || direction === undefined)
					throw new TypeError("missing page or turn keys");
				const next = direction * -1;
				directions[i] = next;
				await setKey(page, keys[0], next < 0);
				await setKey(page, keys[1], next > 0);
			}
		}
		await Promise.all(
			pages.map(async (page, index) => {
				const response: unknown = await page.send("Page.captureScreenshot", {
					format: "png",
					fromSurface: true,
				});
				if (!isRecord(response) || typeof response.data !== "string")
					throw new TypeError("invalid screenshot response");
				await writeFile(
					`${FRAMES}/${index}-${String(frame).padStart(4, "0")}.png`,
					Buffer.from(response.data, "base64"),
				);
			}),
		);
		await sleep(100);
	}

	const result = spawnSync(
		"ffmpeg",
		[
			"-y",
			"-framerate",
			"10",
			"-i",
			`${FRAMES}/0-%04d.png`,
			"-framerate",
			"10",
			"-i",
			`${FRAMES}/1-%04d.png`,
			"-filter_complex",
			"[0:v][1:v]hstack=inputs=2,scale=1280:-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
			"-loop",
			"0",
			OUTPUT,
		],
		{ stdio: "inherit" },
	);
	if (result.status !== 0)
		throw new Error(`ffmpeg exited with ${result.status}`);
	console.log(`saved ${OUTPUT}`);
} finally {
	for (const page of pages) page.ws.close();
	browserSession.ws.close();
	browser.kill();
}
