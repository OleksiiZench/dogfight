import { createChatPanel } from "./chatView.js";

const STATE_TEXT = {
	connected: "З'єднання встановлено",
	connecting: "Підключення…",
	reconnecting: "Перепідключення…",
	closed: "З'єднання закрито",
	error: "Помилка з'єднання",
};

export function createLobbyView({ mount, lobby }) {
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

	const panel = root.querySelector(".lobby-panel");
	const joinForm = root.querySelector(".join-form");
	const nameInput = root.querySelector("[name=name]");
	const roomSelect = root.querySelector("[name=room]");
	const info = root.querySelector(".room-info");
	const status = root.querySelector(".status");
	const startButton = root.querySelector(".start");
	const rosterList = root.querySelector(".roster ul");
	const chat = createChatPanel({
		mount: panel,
		connection: lobby.connection,
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

	function renderRooms(event) {
		const previous = roomSelect.value;
		roomSelect.replaceChildren();
		for (const room of event.detail.rooms) {
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

	function onFailed(event) {
		status.textContent = `Помилка опитування: ${event.detail.error.message}`;
	}

	function onRoomChange() {
		updateInfo();
	}

	function onJoining(event) {
		status.textContent = `Вхід у ${event.detail.room.name}…`;
		startButton.disabled = true;
	}

	function onJoined(event) {
		status.textContent = `Ви в кімнаті ${event.detail.room.name} як ${event.detail.name}`;
		startButton.disabled = false;
	}

	function onRoster(event) {
		rosterList.replaceChildren();
		for (const player of event.detail.players ?? []) {
			const item = document.createElement("li");
			item.textContent = player.name;
			rosterList.append(item);
		}
	}

	function onConnectionState(event) {
		const { state, attempt, delay, code } = event.detail;
		const base = STATE_TEXT[state] ?? state;
		status.textContent =
			state === "reconnecting"
				? `${base} №${attempt} через ${delay} мс`
				: state === "closed"
					? `${base} (${code})`
					: base;
		if (state === "closed" || state === "error") startButton.disabled = true;
	}

	function onNotice(event) {
		if (event.detail.message) status.textContent = event.detail.message;
	}

	function onJoinSubmit(event) {
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
