export function createLobbyView({ mount, lobby }) {
	const root = document.createElement("div");
	root.className = "overlay";
	root.innerHTML = `
		<form class="panel">
			<h1>Dogfight — лобі</h1>
			<label>Позивний <input name="name" maxlength="16" value="PILOT" /></label>
			<label>Кімната <select name="room"></select></label>
			<p class="room-info"></p>
			<p class="status muted">Завантаження кімнат…</p>
			<button type="submit">Приєднатися</button>
		</form>`;
	mount.append(root);

	const form = root.querySelector("form");
	const nameInput = root.querySelector("[name=name]");
	const roomSelect = root.querySelector("[name=room]");
	const info = root.querySelector(".room-info");
	const status = root.querySelector(".status");
	const rooms = () => lobby.rooms;
	const selected = () => rooms().find((room) => room.id === roomSelect.value);

	function updateInfo() {
		const room = selected();
		info.textContent = room
			? `${room.arena?.width ?? 1600}×${room.arena?.height ?? 900} · seed ${room.seed ?? 1} · астероїдів: ${room.asteroidTarget ?? 6}`
			: "";
	}

	function renderRooms(event) {
		roomSelect.replaceChildren();
		for (const room of event.detail.rooms) {
			roomSelect.add(new Option(room.name, room.id));
		}
		updateInfo();
		if (roomSelect.options.length) {
			status.textContent = "Список оновлено";
		}
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

	function onSubmit(event) {
		event.preventDefault();
		lobby.join(roomSelect.value, { name: nameInput.value.trim() || "PILOT" });
	}

	lobby.addEventListener("roomsChanged", renderRooms);
	lobby.addEventListener("refreshing", onRefreshing);
	lobby.addEventListener("requestFailed", onFailed);
	roomSelect.addEventListener("change", onRoomChange);
	form.addEventListener("submit", onSubmit);

	return {
		destroy() {
			lobby.removeEventListener("roomsChanged", renderRooms);
			lobby.removeEventListener("refreshing", onRefreshing);
			lobby.removeEventListener("requestFailed", onFailed);
			roomSelect.removeEventListener("change", onRoomChange);
			form.removeEventListener("submit", onSubmit);
			root.remove();
		},
	};
}
