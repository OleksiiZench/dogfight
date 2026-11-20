import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";

const CDP = "http://127.0.0.1:9225";
const FRAMES = "/tmp/opencode/netcode-frames";
const OUTPUT = "docs/assets/lab-05-two-player.gif";
const urls = [
	"http://localhost:3001/?debug=1&latency=100&jitter=30&drop=0.02&pilot=Alpha",
	"http://localhost:3001/?debug=1&latency=100&jitter=30&drop=0.02&pilot=Beta",
];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function transport(wsUrl) {
	const ws = new WebSocket(wsUrl);
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = reject;
	});
	let id = 1;
	const pending = new Map();
	ws.onmessage = ({ data }) => {
		const message = JSON.parse(data);
		if (!message.id || !pending.has(message.id)) return;
		const { resolve, reject } = pending.get(message.id);
		pending.delete(message.id);
		if (message.error) reject(new Error(JSON.stringify(message.error)));
		else resolve(message.result);
	};
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const next = id++;
			pending.set(next, { resolve, reject });
			ws.send(JSON.stringify({ id: next, method, params }));
		});
	return { ws, send };
}

async function pageClient(target) {
	const base = await transport(target.webSocketDebuggerUrl);
	const evaluate = async (expression) => {
		const { result, exceptionDetails } = await base.send("Runtime.evaluate", {
			expression,
			returnByValue: true,
			awaitPromise: true,
		});
		if (exceptionDetails) throw new Error(exceptionDetails.text);
		return result.value;
	};
	const waitFor = async (expression, label) => {
		for (let i = 0; i < 150; i++) {
			if (await evaluate(expression)) return;
			await sleep(100);
		}
		throw new Error(`timeout waiting for ${label}`);
	};
	return { ...base, evaluate, waitFor, url: target.url };
}

const KEYS = {
	ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
	ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
	ArrowRight: {
		key: "ArrowRight",
		code: "ArrowRight",
		windowsVirtualKeyCode: 39,
	},
	Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32 },
};
const held = new WeakMap();

async function setKey(page, name, down) {
	const state = held.get(page) ?? new Set();
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

const version = await fetch(`${CDP}/json/version`).then((r) => r.json());
const browserSession = await transport(version.webSocketDebuggerUrl);
for (const url of urls) {
	await browserSession.send("Target.createTarget", { url });
}
const targets = (await fetch(`${CDP}/json/list`).then((r) => r.json()))
	.filter((target) => target.type === "page" && target.url.includes("pilot="))
	.sort((a, b) => a.url.localeCompare(b.url));
const pages = await Promise.all(targets.map(pageClient));

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
	const directions = [1, -1];
	const turnKeys = [
		["ArrowLeft", "ArrowRight"],
		["ArrowRight", "ArrowLeft"],
	];
	for (let i = 0; i < pages.length; i++) {
		await setKey(pages[i], "ArrowUp", true);
		await setKey(pages[i], "Space", true);
		await setKey(pages[i], turnKeys[i][directions[i] > 0 ? 1 : 0], true);
	}

	for (let frame = 0; frame < 200; frame++) {
		if (frame % 20 === 0) {
			for (let i = 0; i < pages.length; i++) {
				directions[i] *= -1;
				await setKey(pages[i], turnKeys[i][0], directions[i] < 0);
				await setKey(pages[i], turnKeys[i][1], directions[i] > 0);
			}
		}
		await Promise.all(
			pages.map(async (page, index) => {
				const { data } = await page.send("Page.captureScreenshot", {
					format: "png",
					fromSurface: true,
				});
				await writeFile(
					`${FRAMES}/${index}-${String(frame).padStart(4, "0")}.png`,
					Buffer.from(data, "base64"),
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
