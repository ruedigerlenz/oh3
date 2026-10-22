function selectGamemode() {
	window.location.hash = "gamemodes";
}

function syncGamemodeMenu() {
	const isSelectingGamemode = window.location.hash === "#gamemodes";

	document.getElementById("gamemode").hidden = isSelectingGamemode;
	document.getElementById("editor").hidden = isSelectingGamemode;
	document.getElementById("gamemodes").hidden = !isSelectingGamemode;
	document.getElementById("gamemode").setAttribute("aria-expanded", String(isSelectingGamemode));
}

async function loadGamemodes() {
	const gamemodes = document.getElementById("gamemodes");

	try {
		const catalogResponse = await fetch("/game/levelsets/catalog.json");
		if (!catalogResponse.ok) {
			throw new Error(`Failed to load levelset catalog (${catalogResponse.status})`);
		}

		const catalog = await catalogResponse.json();
		if (!Array.isArray(catalog.levelsets)) {
			throw new Error("Invalid levelset catalog");
		}

		let loadedLevelsetCount = 0;
		for (const levelsetId of catalog.levelsets) {
			try {
				if (typeof levelsetId !== "string" || !/^[a-z0-9_-]+$/i.test(levelsetId)) {
					throw new Error("Invalid levelset name in catalog");
				}

				const response = await fetch(`/game/levelsets/${encodeURIComponent(levelsetId)}.json`);
				if (!response.ok) {
					throw new Error(`Failed to load levelset ${levelsetId} (${response.status})`);
				}

				const levelset = await response.json();
				if (typeof levelset.name !== "string" || !levelset.name.trim()) {
					throw new Error(`Levelset ${levelsetId} has no name`);
				}

				const button = document.createElement("button");
				button.type = "button";
				button.textContent = levelset.name;
				button.title = `Play ${levelset.name}`;
				button.addEventListener("click", () => {
					window.location.href = `/game/?levelset=${encodeURIComponent(levelsetId)}`;
				});
				gamemodes.append(button);
				loadedLevelsetCount += 1;
			} catch (error) {
				console.error(`Failed to load levelset ${levelsetId}:`, error);
			}
		}

		if (loadedLevelsetCount === 0) {
			gamemodes.textContent = catalog.levelsets.length === 0
				? "No gamemodes are available."
				: "Unable to load gamemodes.";
		}
	} catch (error) {
		console.error("Failed to load gamemodes:", error);
		gamemodes.textContent = "Unable to load gamemodes.";
	}
}

function customLevels() {
	window.location.href = "/editor/";
}

window.addEventListener("hashchange", syncGamemodeMenu);
syncGamemodeMenu();
loadGamemodes();
