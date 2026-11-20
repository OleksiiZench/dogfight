import type { ServerMessage } from "shared/protocol.ts";
import { detailOf, dispatch } from "../events/bus.ts";
import { requireElement } from "./dom.ts";

export interface ChatConnection extends EventTarget {
	chat(text: string): void;
}

export interface ChatPanelOptions {
	mount: ParentNode;
	connection: ChatConnection;
	title?: string;
	variant?: string;
}

export interface ChatPanel {
	append(message: string): void;
	destroy(): void;
}

type ChatDetail = Extract<ServerMessage, { type: "chat" }>;
type RosterDetail = Extract<ServerMessage, { type: "roster" }>;
type NoticeDetail = { message?: string; reason?: string };
type ClosedDetail = { code?: number };

export function createChatPanel({
	mount,
	connection,
	title = "Чат",
	variant = "",
}: ChatPanelOptions): ChatPanel {
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

	const log = requireElement<HTMLDivElement>(root, ".chat-log");
	const form = requireElement<HTMLFormElement>(root, ".chat-form");
	const input = requireElement<HTMLInputElement>(root, "[name=message]");

	function append(message: string) {
		const line = document.createElement("div");
		line.textContent = message;
		log.append(line);
		while (log.childElementCount > 60) log.firstElementChild?.remove();
		log.scrollTop = log.scrollHeight;
	}

	function onChat(event: Event) {
		const { player, text } = detailOf<ChatDetail>(event);
		append(`${player?.name ?? "?"}: ${text}`);
	}

	function onRoster(event: Event) {
		const players = detailOf<RosterDetail>(event).players ?? [];
		append(
			`[ростер] ${players.map((player) => player.name).join(", ") || "нікого"}`,
		);
	}

	function onNotice(event: Event) {
		const { message, reason } = detailOf<NoticeDetail>(event);
		const text = message ?? reason;
		if (text) append(`[система] ${text}`);
	}

	function onClosed(event: Event) {
		const { code } = detailOf<ClosedDetail>(event);
		append(`[з'єднання] закрито (${code})`);
	}

	function onSubmit(event: SubmitEvent) {
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

export function announceConnection(
	connection: EventTarget,
	message: string,
): void {
	dispatch(connection, "notice", { message });
}
