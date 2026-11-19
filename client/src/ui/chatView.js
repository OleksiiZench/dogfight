import { dispatch } from "../events/bus.js";

export function createChatPanel({
	mount,
	connection,
	title = "Чат",
	variant = "",
}) {
	const root = document.createElement("div");
	root.className = `chat-panel ${variant}`.trim();
	root.innerHTML = `
		<strong>${title}</strong>
		<div class="chat-log" aria-live="polite"></div>
		<form class="chat-form">
			<input name="message" maxlength="240" placeholder="Повідомлення" autocomplete="off" />
			<button type="submit">›</button>
		</form>`;
	mount.append(root);

	const log = root.querySelector(".chat-log");
	const form = root.querySelector(".chat-form");
	const input = root.querySelector("[name=message]");

	function append(message) {
		const line = document.createElement("div");
		line.textContent = message;
		log.append(line);
		while (log.childElementCount > 60) log.firstElementChild.remove();
		log.scrollTop = log.scrollHeight;
	}

	function onChat(event) {
		const { player, text } = event.detail;
		append(`${player?.name ?? "?"}: ${text}`);
	}

	function onRoster(event) {
		const players = event.detail.players ?? [];
		append(
			`[ростер] ${players.map((player) => player.name).join(", ") || "нікого"}`,
		);
	}

	function onNotice(event) {
		const message = event.detail.message ?? event.detail.reason;
		if (message) append(`[система] ${message}`);
	}

	function onClosed(event) {
		append(`[з'єднання] закрито (${event.detail.code})`);
	}

	function onSubmit(event) {
		event.preventDefault();
		const text = input.value.trim();
		if (!text) return;
		connection.chat(text);
		input.value = "";
	}

	connection.addEventListener("chat", onChat);
	connection.addEventListener("roster", onRoster);
	connection.addEventListener("notice", onNotice);
	connection.addEventListener("closed", onClosed);
	form.addEventListener("submit", onSubmit);

	return {
		append,
		destroy() {
			connection.removeEventListener("chat", onChat);
			connection.removeEventListener("roster", onRoster);
			connection.removeEventListener("notice", onNotice);
			connection.removeEventListener("closed", onClosed);
			form.removeEventListener("submit", onSubmit);
			root.remove();
		},
	};
}

export function announceConnection(connection, message) {
	dispatch(connection, "notice", { message });
}
