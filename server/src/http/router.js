export class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.name = "HttpError";
		this.status = status;
	}
}

export function sendJson(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": Buffer.byteLength(body),
		"Cache-Control": "no-store",
	});
	res.end(body);
}

export async function readJsonBody(req, maxBytes) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > maxBytes) throw new HttpError(413, "request body is too large");
		chunks.push(chunk);
	}
	if (size === 0) return {};
	try {
		const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new Error("body has to be an object");
		}
		return value;
	} catch (error) {
		throw new HttpError(400, `invalid JSON body: ${error.message}`);
	}
}

function methodNotAllowed(res, allow) {
	res.setHeader("Allow", allow);
	throw new HttpError(405, "method not allowed");
}

function busyWait(milliseconds) {
	const until = Date.now() + milliseconds;
	while (Date.now() < until) {}
}

export async function handleApi(req, res, url, context) {
	const { config, rooms, startedAt } = context;

	if (url.pathname === "/health") {
		if (req.method !== "GET") methodNotAllowed(res, "GET");
		sendJson(res, 200, {
			ok: true,
			uptimeMs: Date.now() - startedAt,
			rss: process.memoryUsage().rss,
			rooms: rooms.rooms.size,
		});
		return true;
	}

	if (url.pathname === "/api/slow") {
		if (req.method !== "GET") methodNotAllowed(res, "GET");
		busyWait(config.blockMs);
		sendJson(res, 200, { ok: true, blockedMs: config.blockMs });
		return true;
	}

	if (url.pathname === "/api/rooms") {
		if (req.method === "GET") {
			sendJson(res, 200, rooms.list());
			return true;
		}
		if (req.method === "POST") {
			const body = await readJsonBody(req, config.bodyMaxBytes);
			const room = rooms.create(body);
			sendJson(res, 201, room.info());
			return true;
		}
		methodNotAllowed(res, "GET, POST");
	}

	return false;
}
