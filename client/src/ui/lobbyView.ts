import type { ServerMessage } from "shared/protocol.ts";
import { detailOf } from "../events/bus.ts";
import type {
	ConnectionStateDetail,
	JoinedInfo,
	Lobby,
	LobbyRoom,
} from "../net/lobby.ts";
import { createChatPanel } from "./chatView.ts";
import { errorMessage, requireElement } from "./dom.ts";

const STATE_TEXT: Record<ConnectionStateDetail["state"], string> = {
	connected: "З'єднання встановлено",
	connecting: "Підключення…",
	reconnecting: "Перепідключення…",
	closed: "З'єднання закрито",
	error: "Помилка з'єднання",
};

export interface LobbyViewOptions {
	mount: ParentNode;
	lobby: Lobby;
}

export interface LobbyView {
	destroy(): void;
}

type RoomsChangedDetail = { rooms: LobbyRoom[] };
type RosterDetail = Extract<ServerMessage, { type: "roster" }>;
type NoticeDetail = { message?: string };

export function createLobbyView({ mount, lobby }: LobbyViewOptions): LobbyView {
	const root = document.createElement("div");
	root.className = "overlay";
	root.innerHTML = `
		<div class="panel lobby-panel">
			<h1>Dogfight — лобі</h1>
			<form class="join-form">
				<label>Позивний <input name="name" maxlength="24" value="PILOT" /></label>
				<label>Кімната <select name="room"></select></label>
				<p class="room-info"></p>
				<p class="status muted">Завантаження кімнат…</p>
				<button type="submit">Приєднатися</button>
			</form>
			<div class="lobby-actions">
				<button class="start" type="button" disabled>Почати бій</button>
			</div>
			<div class="roster">
				<strong>У кімнаті</strong>
				<ul></ul>
			</div>
		</div>`;
	mount.append(root);

	const panel = requireElement<HTMLElement>(root, ".lobby-panel");
	const joinForm = requireElement<HTMLFormElement>(root, ".join-form");
	const nameInput = requireElement<HTMLInputElement>(root, "[name=name]");
	const roomSelect = requireElement<HTMLSelectElement>(root, "[name=room]");
	const info = requireElement<HTMLParagraphElement>(root, ".room-info");
	const status = requireElement<HTMLParagraphElement>(root, ".status");
	const startButton = requireElement<HTMLButtonElement>(root, ".start");
	const rosterList = requireElement<HTMLUListElement>(root, ".roster ul");
	const connection = lobby.connection;
	if (!connection) throw new Error("lobby connection is unavailable");
	const chat = createChatPanel({
		mount: panel,
		connection,
		title: "Чат кімнати",
		variant: "lobby-chat",
	});
	const selected = () =>
		lobby.rooms.find((room) => room.id === roomSelect.value);

	function updateInfo() {
		const room = selected();
		info.textContent = room
			? `${room.arena?.width ?? 1600}×${room.arena?.height ?? 900} · seed ${room.seed ?? 1} · астероїдів: ${room.asteroidTarget ?? 6}`
			: "";
	}

	function renderRooms(event: Event) {
		const previous = roomSelect.value;
		roomSelect.replaceChildren();
		for (const room of detailOf<RoomsChangedDetail>(event).rooms) {
			roomSelect.add(
				new Option(
					`${room.name} (${room.players ?? 0}/${room.capacity ?? 8})`,
					room.id,
				),
			);
		}
		if ([...roomSelect.options].some((option) => option.value === previous)) {
			roomSelect.value = previous;
		}
		updateInfo();
		if (roomSelect.options.length) status.textContent = "Список оновлено";
	}

	function onRefreshing() {
		status.textContent = "Оновлення списку…";
	}

	function onFailed(event: Event) {
		status.textContent = `Помилка опитування: ${errorMessage(detailOf<{ error: unknown }>(event).error)}`;
	}

	function onRoomChange() {
		updateInfo();
	}

	function onJoining(event: Event) {
		const detail = detailOf<JoinedInfo>(event);
		status.textContent = `Вхід у ${detail.room.name}…`;
		startButton.disabled = true;
	}

	function onJoined(event: Event) {
		const detail = detailOf<JoinedInfo>(event);
		status.textContent = `Ви в кімнаті ${detail.room.name} як ${detail.name}`;
		startButton.disabled = false;
	}

	function onRoster(event: Event) {
		rosterList.replaceChildren();
		for (const player of detailOf<RosterDetail>(event).players ?? []) {
			const item = document.createElement("li");
			item.textContent = player.name;
			rosterList.append(item);
		}
	}

	function onConnectionState(event: Event) {
		const { state, attempt, delay, code } =
			detailOf<ConnectionStateDetail>(event);
		const base = STATE_TEXT[state] ?? state;
		status.textContent =
			state === "reconnecting"
				? `${base} №${attempt} через ${delay} мс`
				: state === "closed"
					? `${base} (${code})`
					: base;
		if (state === "closed" || state === "error") startButton.disabled = true;
	}

	function onNotice(event: Event) {
		const { message } = detailOf<NoticeDetail>(event);
		if (message) status.textContent = message;
	}

	function onJoinSubmit(event: SubmitEvent) {
		event.preventDefault();
		lobby.join(roomSelect.value, { name: nameInput.value.trim() || "PILOT" });
	}

	function onStartClick() {
		lobby.requestStart();
	}

	lobby.addEventListener("roomsChanged", renderRooms);
	lobby.addEventListener("refreshing", onRefreshing);
	lobby.addEventListener("requestFailed", onFailed);
	lobby.addEventListener("joining", onJoining);
	lobby.addEventListener("joined", onJoined);
	lobby.addEventListener("roster", onRoster);
	lobby.addEventListener("connectionState", onConnectionState);
	lobby.addEventListener("notice", onNotice);
	roomSelect.addEventListener("change", onRoomChange);
	joinForm.addEventListener("submit", onJoinSubmit);
	startButton.addEventListener("click", onStartClick);

	return {
		destroy() {
			lobby.removeEventListener("roomsChanged", renderRooms);
			lobby.removeEventListener("refreshing", onRefreshing);
			lobby.removeEventListener("requestFailed", onFailed);
			lobby.removeEventListener("joining", onJoining);
			lobby.removeEventListener("joined", onJoined);
			lobby.removeEventListener("roster", onRoster);
			lobby.removeEventListener("connectionState", onConnectionState);
			lobby.removeEventListener("notice", onNotice);
			roomSelect.removeEventListener("change", onRoomChange);
			joinForm.removeEventListener("submit", onJoinSubmit);
			startButton.removeEventListener("click", onStartClick);
			chat.destroy();
			root.remove();
		},
	};
}
