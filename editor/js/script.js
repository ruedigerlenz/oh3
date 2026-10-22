import {
	decodeLevelSet,
	encodeLevelSet,
	DEFAULT_PORTAL_MOMENTUM,
	getTileKey,
	LEVEL_COLUMNS,
	LEVEL_ROWS,
	TILE_TYPES,
	TILE_VARIANTS
} from "../../game/js/level-format.js";

class LevelEditor {
	// Configuration constants
	static CONFIG = {
		ROWS: LEVEL_ROWS,
		COLS: LEVEL_COLUMNS,
		CELL_SIZE: 32,
		DEFAULT_TIME: 30.00,
		HISTORY_LIMIT: 100
	};

	// Block definitions
	static BLOCKS = {
		[TILE_TYPES.EMPTY]: { name: "Empty", color: "#808080" },
		[TILE_TYPES.NORMAL]: { name: "Normal", color: "#dcdcdc" },
		[TILE_TYPES.DOOR]: { name: "Door", color: "#303030", propertyPanel: "door" },
		[TILE_TYPES.KEY]: {
			name: "Key",
			propertyPanel: "key",
			defaultVariant: TILE_VARIANTS.KEY.DEFAULT,
			variants: {
				[TILE_VARIANTS.KEY.DEFAULT]: { label: "Normal", color: "#E2E200" },
				[TILE_VARIANTS.KEY.FAKE]: { label: "Fake", color: "#E2E201" }
			}
		},
		[TILE_TYPES.PORTAL]: {
			name: "Portal",
			propertyPanel: "portal",
			defaultVariant: TILE_VARIANTS.PORTAL.FIRST,
			variants: {
				[TILE_VARIANTS.PORTAL.FIRST]: {
					label: "1",
					propertyLabel: "Portal 1 (Purple)",
					color: "#B200FF"
				},
				[TILE_VARIANTS.PORTAL.SECOND]: {
					label: "2",
					propertyLabel: "Portal 2 (Blue)",
					color: "#0094FF"
				},
				[TILE_VARIANTS.PORTAL.ANY]: {
					label: "Any",
					propertyLabel: "Portal Any (Orange)",
					color: "#FF8C00"
				}
			}
		},
		[TILE_TYPES.INVERT]: { name: "Invert gravity", color: "#57007F" },
		[TILE_TYPES.KILL]: { name: "Kill block", color: "#ff0000" },
		[TILE_TYPES.PLAYER_SPAWN]: { name: "Player", color: "#1b66e9ff" }
	};
	static PROPERTY_PANELS = {
		door: {
			title: (editor, point) => `Door (${point.x}, ${point.y})`,
			render: (editor, container, point) => editor.renderDoorProperties(container, point)
		},
		key: {
			title: (editor, point) => {
				const variant = editor.getTileVariantAt(point.x, point.y);
				const label = LevelEditor.BLOCKS[TILE_TYPES.KEY].variants[variant]?.label ?? "Normal";
				return `${label} key (${point.x}, ${point.y})`;
			},
			render: (editor, container, point) => editor.renderKeyProperties(container, point)
		},
		portal: {
			title: (editor, point) => {
				const variant = editor.getTileVariantAt(point.x, point.y);
				const label = LevelEditor.BLOCKS[TILE_TYPES.PORTAL].variants[variant]?.label ?? "1";
				return `Portal ${label} (${point.x}, ${point.y})`;
			},
			render: (editor, container, point) => editor.renderPortalProperties(container, point)
		}
	};
	static MOMENTUM_PROPERTIES = [
		{ name: "calculation", label: "Calculation", type: "select", options: [
			{ value: "fixed", label: "Fixed velocity" },
			{ value: "dynamic", label: "Dynamic multiplier" }
		] },
		{ name: "velocity", label: "Fixed velocity (px/frame)", type: "number", min: 0, step: "any", visibleWhen: settings => settings.calculation === "fixed" },
		{ name: "multiplier", label: "Dynamic multiplier", type: "number", min: 0, step: "any", visibleWhen: settings => settings.calculation === "dynamic" },
		{ name: "angle", label: "Exit angle (degrees, absolute from world)", type: "number", step: "any", direction: true },
		{ name: "bounce", label: "Momentum Bounce", type: "checkbox" },
		{ name: "bounceThreshold", label: "Bounce threshold (px/frame)", type: "number", min: 0, step: "any", bounceOnly: true },
		{ name: "bounceRetention", label: "Bounce retention (0–1)", type: "number", min: 0, max: 1, step: "any", bounceOnly: true }
	];

	constructor() {
		this.initializeElements();
		this.initializeState();
		this.setupEventListeners();
		this.createPalette();
		this.refreshLevelList();
		this.startRenderLoop();
		this.setupViewportFitting();
	}

	initializeElements() {
		this.app = document.getElementById("app");
		this.blockPropertiesPanel = document.getElementById("block-properties-panel");
		this.blockPropertiesConnector = document.getElementById("block-properties-connector");
		this.blockPropertiesConnectorLine = document.getElementById("block-properties-connector-line");
		this.blockPropertiesConnectorTarget = document.getElementById("block-properties-connector-target");
		this.blockPropertiesTitle = document.getElementById("block-properties-title");
		this.blockPropertiesContent = document.getElementById("block-properties-content");
		this.canvas = document.getElementById("grid");
		this.ctx = this.canvas?.getContext("2d");
		this.timeInput = null;
		this.levelSetNameInput = document.getElementById("level-set-name");
		this.levelNameInput = document.getElementById("level-name");
		this.paletteEl = document.getElementById("palette");
		this.levelList = document.getElementById("level-list");

		if (this.canvas) {
			this.canvas.width = LevelEditor.CONFIG.COLS * LevelEditor.CONFIG.CELL_SIZE;
			this.canvas.height = LevelEditor.CONFIG.ROWS * LevelEditor.CONFIG.CELL_SIZE;
		}
	}

	initializeState() {
		this.mouseDown = false;
		this.activeMouseButton = null;
		this.movingTile = null;

		this.grid = this.createEmptyGrid();
		this.levelsMap = new Map();
		this.levelSetName = "";
		this.currentLevel = "1";
		this.metadata = this.createEmptyMetadata();
		this.paletteVariants = new Map();
		this.currentBrush = { tile: TILE_TYPES.NORMAL, variant: null };
		this.portalEditAction = null;
		this.portalLinkMode = "unidirectional";
		this.pendingPortalSource = null;
		this.newPortalMomentumSettings = { ...DEFAULT_PORTAL_MOMENTUM };
		this.blockPropertiesCell = null;
		this.blockPropertiesPosition = null;
		this.blockPropertiesManuallyPositioned = false;
		this.blockPropertiesDrag = null;
		this.hoverCell = null;

		this.levelsMap.set(this.currentLevel, {
			name: "",
			grid: this.grid.map(row => [...row]),
			time: this.parseTimeInput(),
			metadata: this.cloneMetadata(this.metadata)
		});
		this.undoStack = [this.createHistorySnapshot()];
		this.redoStack = [];
		this.historyGroupActive = false;
	}

	createEmptyMetadata() {
		return {
			tileVariants: Object.create(null),
			doorRequiresKey: Object.create(null),
			portals: []
		};
	}

	cloneMetadata(metadata) {
		return {
			tileVariants: Object.assign(Object.create(null), metadata.tileVariants),
			doorRequiresKey: Object.assign(Object.create(null), metadata.doorRequiresKey ?? {}),
			portals: metadata.portals.map(link => ({
				source: { ...link.source },
				destination: { ...link.destination },
				mode: link.mode,
				momentum: { ...DEFAULT_PORTAL_MOMENTUM, ...link.momentum }
			}))
		};
	}

	createEmptyGrid() {
		const grid = Array(LevelEditor.CONFIG.ROWS).fill(null)
			.map(() => Array(LevelEditor.CONFIG.COLS).fill(TILE_TYPES.EMPTY));

		// Fill bottom row with ground blocks
		grid[LevelEditor.CONFIG.ROWS - 1].fill(TILE_TYPES.NORMAL);
		return grid;
	}

	parseTimeInput() {
		if (!this.timeInput) return LevelEditor.CONFIG.DEFAULT_TIME;
		const value = parseFloat(this.timeInput.value);
		return Number.isFinite(value) ? value : LevelEditor.CONFIG.DEFAULT_TIME;
	}

	createPalette() {
		if (!this.paletteEl) return;

		Object.entries(LevelEditor.BLOCKS).forEach(([id, block]) => {
			const group = document.createElement("div");
			group.className = "palette-group";
			const button = this.createPaletteButton(id);
			const label = this.createPaletteLabel(block.name);

			group.appendChild(button);
			if (block.variants) {
				group.appendChild(this.createPaletteVariantSelector(id, block));
			}
			group.appendChild(label);
			this.paletteEl.appendChild(group);
			this.updatePaletteButton(id, block);
		});

		this.selectBrush(this.currentBrush.tile, this.currentBrush.variant);
	}

	createPaletteButton(id) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "palette-item";
		button.dataset.id = id;
		button.textContent = id;

		button.addEventListener("click", () => {
			this.selectBrush(Number(id));
		});

		return button;
	}

	createPaletteVariantSelector(id, block) {
		const selector = document.createElement("select");
		selector.className = "palette-variant";
		selector.setAttribute("aria-label", `${block.name} variant`);
		for (const [variant, definition] of Object.entries(block.variants)) {
			const option = document.createElement("option");
			option.value = variant;
			option.textContent = definition.label;
			selector.appendChild(option);
		}
		selector.value = this.paletteVariants.get(id) ?? block.defaultVariant;
		selector.addEventListener("change", () => {
			this.paletteVariants.set(id, selector.value);
			this.selectBrush(Number(id), selector.value);
		});
		return selector;
	}

	createPaletteLabel(name) {
		const label = document.createElement("div");
		label.className = "palette-label";
		label.innerText = name;
		return label;
	}

	selectBrush(tile, variant = undefined) {
		const id = String(tile);
		const block = LevelEditor.BLOCKS[id];
		if (!block) return;
		if (variant === undefined) {
			variant = this.paletteVariants.get(id) ?? block.defaultVariant ?? null;
		}
		this.currentBrush = { tile, variant };
		if (block.variants) this.paletteVariants.set(id, variant);
		this.updatePaletteButton(id, block);
		document.querySelectorAll(".palette-item").forEach(element => {
			element.classList.toggle("selected", Number(element.dataset.id) === tile);
		});
	}

	updatePaletteButton(id, block) {
		const button = this.paletteEl?.querySelector(`.palette-item[data-id="${id}"]`);
		if (!button) return;
		const variant = this.paletteVariants.get(id) ?? block.defaultVariant;
		button.style.background = block.variants?.[variant]?.color || block.color;
		const selector = button.parentElement.querySelector(".palette-variant");
		if (selector && selector.value !== variant) selector.value = variant;
	}

	setupEventListeners() {
		this.setupCanvasListeners();
		this.setupControlListeners();
		this.setupInputListeners();
		this.setupBlockPropertiesListeners();
		this.setupFileListeners();
		this.setupLevelListListeners();
	}

	setupLevelListListeners() {
		if (!this.levelList) return;

		this.levelList.addEventListener("change", event => {
			const input = event.target.closest(".level-time-input");
			const item = input?.closest(".level-list-entry");
			const level = item && this.levelsMap.get(item.dataset.level);
			if (!input || !level) return;

			const value = input.valueAsNumber;
			const time = Number.isFinite(value) ? value : LevelEditor.CONFIG.DEFAULT_TIME;
			if (!Number.isFinite(value)) input.value = String(time);
			level.time = time;
			if (item.dataset.level === this.currentLevel) {
				this.timeInput = input;
				this.saveCurrentLevel();
			} else {
				this.recordHistoryState();
			}
		});

		this.levelList.addEventListener("dragstart", event => {
			if (event.target.closest(".level-time-input")) {
				event.preventDefault();
				return;
			}
			const item = event.target.closest(".level-list-entry");
			if (!item || !event.dataTransfer) return;

			this.draggedLevelKey = item.dataset.level;
			event.dataTransfer.effectAllowed = "move";
			event.dataTransfer.setData("text/plain", this.draggedLevelKey);
			item.classList.add("is-dragging");
		});

		this.levelList.addEventListener("dragover", event => {
			const item = event.target.closest(".level-list-entry");
			if (!this.draggedLevelKey || !item || item.dataset.level === this.draggedLevelKey) return;

			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
			this.levelList.querySelectorAll(".drop-before, .drop-after").forEach(target => {
				target.classList.remove("drop-before", "drop-after");
			});
			const insertAfter = event.clientY > item.getBoundingClientRect().top + item.offsetHeight / 2;
			item.classList.add(insertAfter ? "drop-after" : "drop-before");
		});

		this.levelList.addEventListener("drop", event => {
			const item = event.target.closest(".level-list-entry");
			if (!this.draggedLevelKey || !item) return;

			event.preventDefault();
			const insertAfter = event.clientY > item.getBoundingClientRect().top + item.offsetHeight / 2;
			this.reorderLevels(this.draggedLevelKey, item.dataset.level, insertAfter);
			this.clearLevelDropIndicators();
		});

		this.levelList.addEventListener("dragend", () => this.clearLevelDropIndicators());
	}

	clearLevelDropIndicators() {
		this.levelList?.querySelectorAll(".is-dragging, .drop-before, .drop-after").forEach(item => {
			item.classList.remove("is-dragging", "drop-before", "drop-after");
		});
		this.draggedLevelKey = null;
	}

	setupViewportFitting() {
		const fit = () => this.fitEditorToViewport();
		window.addEventListener("resize", fit);
		if (typeof ResizeObserver !== "undefined" && this.app) {
			this.layoutObserver = new ResizeObserver(fit);
			this.layoutObserver.observe(this.app);
		}
		fit();
	}

	fitEditorToViewport() {
		if (!this.app?.offsetWidth || !this.app.offsetHeight) return;

		const bodyStyle = getComputedStyle(document.body);
		const horizontalPadding = parseFloat(bodyStyle.paddingLeft) + parseFloat(bodyStyle.paddingRight);
		const verticalPadding = parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom);
		const availableWidth = document.documentElement.clientWidth - horizontalPadding;
		const availableHeight = document.documentElement.clientHeight - verticalPadding;
		const scale = Math.max(0, Math.min(1,
			availableWidth / this.app.offsetWidth,
			availableHeight / this.app.offsetHeight
		));
		this.app.style.transform = `scale(${scale})`;
	}

	setupCanvasListeners() {
		if (!this.canvas) return;

		this.canvas.addEventListener("mousedown", (e) => {
			this.hoverCell = this.getGridCellFromPointer(e);
			if (e.button === 2) {
				e.preventDefault();
				if (this.hoverCell) this.openBlockProperties(this.hoverCell);
				else this.closeBlockProperties();
				return;
			}

			if (e.button === 1) {
				e.preventDefault();
				this.mouseDown = true;
				this.activeMouseButton = e.button;
				this.beginTileMove(e);
				return;
			}

			if (e.button === 0) this.beginHistoryGroup();
			this.mouseDown = true;
			this.activeMouseButton = e.button;
			this.handlePointer(e);
		});

		window.addEventListener("mouseup", (e) => {
			if (e.button === 1) this.finishTileMove(e);
			if (this.activeMouseButton === e.button) {
				if (e.button === 0) this.endHistoryGroup();
				this.mouseDown = false;
				this.activeMouseButton = null;
			}
		});
		window.addEventListener("blur", () => {
			this.endHistoryGroup();
			this.mouseDown = false;
			this.activeMouseButton = null;
			this.movingTile = null;
			if (this.canvas) this.canvas.style.cursor = "";
		});
		this.canvas.addEventListener("mouseleave", () => {
			if (this.activeMouseButton !== 1) this.mouseDown = false;
			this.hoverCell = null;
		});
		this.canvas.addEventListener("contextmenu", e => e.preventDefault());

		this.canvas.addEventListener("mousemove", (e) => {
			this.hoverCell = this.getGridCellFromPointer(e);
			if (this.mouseDown) this.handlePointer(e, true);
		});
	}

	setupControlListeners() {
		const controls = [
			{ id: "new-level", handler: () => this.createNewLevel() },
			{ id: "prev-level", handler: () => this.navigateLevel(-1) },
			{ id: "next-level", handler: () => this.navigateLevel(1) },
			{ id: "export-current-level", handler: () => this.exportCurrentLevel() },
			{ id: "delete-level", handler: () => this.deleteLevel() },
			{ id: "play-levels", handler: () => this.playLevels() },
			{ id: "play-level", handler: () => this.playCurrentLevel() },
			{ id: "export-levels", handler: () => this.exportLevels() },
		];

		controls.forEach(({ id, handler }) => {
			const element = document.getElementById(id);
			if (element) {
				element.addEventListener("click", handler);
			}
		});
	}

	setupInputListeners() {
		this.levelSetNameInput?.addEventListener("input", () => {
			this.levelSetName = this.levelSetNameInput.value;
		});
		this.levelSetNameInput?.addEventListener("change", () => this.recordHistoryState());
		this.levelNameInput?.addEventListener("input", () => {
			const level = this.levelsMap.get(this.currentLevel);
			if (!level) return;
			level.name = this.levelNameInput.value;
			const button = this.levelList?.querySelector(".level-list-entry.is-current button");
			if (button) button.textContent = this.getLevelLabel(this.currentLevel, level);
		});
		this.levelNameInput?.addEventListener("change", () => this.saveCurrentLevel());

		document.addEventListener("keydown", event => {
			if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

			const key = event.key.toLowerCase();
			const isUndo = key === "z" && !event.shiftKey;
			const isRedo = key === "y" || (key === "z" && event.shiftKey);
			if (!isUndo && !isRedo) return;

			const target = event.target;
			if (target instanceof Element
				&& (target.closest("input, textarea, select, [contenteditable='true']")
					|| target.isContentEditable)) return;

			event.preventDefault();
			this.endHistoryGroup();
			if (isUndo) this.undo();
			else this.redo();
		});

	}

	setupBlockPropertiesListeners() {
		if (!this.blockPropertiesPanel || !this.blockPropertiesContent) return;

		document.getElementById("close-block-properties")?.addEventListener("click", () => this.closeBlockProperties());
		const dragHandle = this.blockPropertiesPanel.querySelector(".block-properties-header");
		if (dragHandle) {
			dragHandle.addEventListener("pointerdown", event => {
				if (!event.isPrimary || event.button !== 0 || event.target.closest("button")) return;

				const bounds = this.blockPropertiesPanel.getBoundingClientRect();
				this.blockPropertiesDrag = {
					pointerId: event.pointerId,
					offsetX: event.clientX - bounds.left,
					offsetY: event.clientY - bounds.top
				};
				dragHandle.setPointerCapture(event.pointerId);
				this.blockPropertiesPanel.classList.add("is-dragging");
				event.preventDefault();
			});
			dragHandle.addEventListener("pointermove", event => {
				if (this.blockPropertiesDrag?.pointerId !== event.pointerId) return;
				this.setBlockPropertiesPosition(
					event.clientX - this.blockPropertiesDrag.offsetX,
					event.clientY - this.blockPropertiesDrag.offsetY,
					true
				);
			});
			const finishDrag = event => {
				if (this.blockPropertiesDrag?.pointerId !== event.pointerId) return;
				this.blockPropertiesDrag = null;
				this.blockPropertiesPanel.classList.remove("is-dragging");
			};
			dragHandle.addEventListener("pointerup", finishDrag);
			dragHandle.addEventListener("pointercancel", finishDrag);
			dragHandle.addEventListener("lostpointercapture", finishDrag);
		}
		this.blockPropertiesContent.addEventListener("click", event => this.handleBlockPropertyAction(event));
		this.blockPropertiesContent.addEventListener("change", event => this.handleBlockPropertyChange(event));
		this.blockPropertiesContent.addEventListener("input", event => {
			if (event.target.matches('[data-momentum-field="angle"]')) {
				this.updateMomentumArrow(event.target.closest("[data-momentum-scope]"));
			}
		});
		document.addEventListener("pointerdown", event => {
			if (!this.blockPropertiesPanel.hidden && !this.blockPropertiesPanel.contains(event.target)) {
				this.closeBlockProperties();
			}
		});
		document.addEventListener("keydown", event => {
			if (event.key !== "Escape") return;
			if (!this.blockPropertiesPanel.hidden) this.closeBlockProperties();
			if (this.portalEditAction === "link") {
				this.portalEditAction = null;
				this.pendingPortalSource = null;
			}
		});
		window.addEventListener("resize", () => requestAnimationFrame(() => this.positionBlockProperties()));
		document.addEventListener("scroll", () => this.positionBlockProperties(), true);
		if (typeof ResizeObserver !== "undefined") {
			this.blockPropertiesResizeObserver = new ResizeObserver(() => this.positionBlockProperties());
			this.blockPropertiesResizeObserver.observe(this.blockPropertiesPanel);
		}
	}

	setupFileListeners() {
		const fileInput = document.getElementById("file-input");
		document.getElementById("import-levels")?.addEventListener("click", () => fileInput?.click());
		if (fileInput) {
			fileInput.addEventListener("change", (e) => {
				const file = e.target.files?.[0];
				if (!file) return;
				e.target.value = "";
				this.importLevelFile(file);
			});
		}

		const appendFileInput = document.getElementById("append-file-input");
		document.getElementById("append-levels")?.addEventListener("click", () => appendFileInput?.click());
		if (appendFileInput) {
			appendFileInput.addEventListener("change", (event) => {
				const file = event.target.files?.[0];
				if (!file) return;
				event.target.value = "";
				this.appendLevelFile(file);
			});
		}

		this.app?.addEventListener("dragover", (event) => {
			if (!this.isFileDrag(event)) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
		});
		this.app?.addEventListener("drop", (event) => {
			if (!this.isFileDrag(event)) return;
			event.preventDefault();
			const file = event.dataTransfer?.files?.[0];
			if (file) this.importLevelFile(file);
		});
	}

	isFileDrag(event) {
		const dataTransfer = event.dataTransfer;
		return Array.from(dataTransfer?.types ?? []).includes("Files") || (dataTransfer?.files?.length ?? 0) > 0;
	}

	importLevelFile(file) {
		this.readLevelSetFile(file, levelSet => {
			this.levelSetName = levelSet.name;
			if (this.levelSetNameInput) this.levelSetNameInput.value = this.levelSetName;
			this.updateLevelsFromDecodedSet(levelSet.levels);
			this.saveCurrentLevel();
		});
	}

	appendLevelFile(file) {
		this.readLevelSetFile(file, levelSet => this.appendLevelsFromDecodedSet(levelSet.levels));
	}

	readLevelSetFile(file, onLevelSetDecoded) {
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const levelSet = decodeLevelSet(JSON.parse(reader.result));
				onLevelSetDecoded(levelSet);
			} catch (error) {
				alert(`Unable to import levels: ${error.message}`);
			}
		};
		reader.onerror = () => alert("Unable to read the selected level file.");
		reader.readAsText(file);
	}

	appendLevelsFromDecodedSet(decodedLevels) {
		this.saveCurrentLevel();
		const entries = Object.entries(decodedLevels).sort(([a], [b]) => Number(a) - Number(b));
		const lastLevelNumber = this.getSortedLevelEntries().reduce((last, [key]) => Math.max(last, Number(key)), 0);
		let nextLevelNumber = lastLevelNumber + 1;
		const appendedLevels = entries.map(([, level]) => {
			if (!Number.isSafeInteger(nextLevelNumber) || nextLevelNumber < 1) {
				throw new Error("Unable to append levels because the level numbers exceed the supported range.");
			}
			const key = String(nextLevelNumber++);
			return [key, {
				name: level.name,
				grid: level.grid.map(row => [...row]),
				time: level.time,
				metadata: this.cloneMetadata(level.metadata)
			}];
		});

		for (const [key, level] of appendedLevels) this.levelsMap.set(key, level);
		this.refreshLevelList();
		this.recordHistoryState();
	}

	handlePointer(event, isDrag = false) {
		const cell = this.getGridCellFromPointer(event);
		if (!cell) return;
		const { x, y } = cell;
		if (this.activeMouseButton === 1) {
			if (this.movingTile) this.movingTile.target = cell;
			return;
		}

		if (this.portalEditAction) {
			if (!isDrag) this.handlePortalEditorClick(x, y);
			return;
		}

		this.setTileAt(x, y, this.currentBrush.tile, this.currentBrush.variant);

		this.saveCurrentLevel();
	}

	beginTileMove(event) {
		const source = this.getGridCellFromPointer(event);
		if (!source || this.grid[source.y][source.x] === TILE_TYPES.EMPTY) {
			return;
		}

		this.movingTile = {
			source,
			target: source,
			tile: this.grid[source.y][source.x],
			variant: this.getTileVariantAt(source.x, source.y),
			level: this.currentLevel
		};
		this.canvas.style.cursor = "grabbing";
	}

	finishTileMove(event) {
		if (!this.movingTile) return;

		const move = this.movingTile;
		this.movingTile = null;
		this.canvas.style.cursor = "";
		if (move.level !== this.currentLevel) return;

		const destination = this.getGridCellFromPointer(event);
		if (!destination
			|| (move.source.x === destination.x && move.source.y === destination.y)) return;

		const sourceKey = getTileKey(move.source.x, move.source.y);
		const destinationKey = getTileKey(destination.x, destination.y);
		const sourceTile = this.grid[move.source.y][move.source.x];
		const destinationTile = this.grid[destination.y][destination.x];
		const sourceVariant = this.metadata.tileVariants[sourceKey];
		const destinationVariant = this.metadata.tileVariants[destinationKey];
		const sourceDoorRequiresKey = this.metadata.doorRequiresKey[sourceKey];
		const destinationDoorRequiresKey = this.metadata.doorRequiresKey[destinationKey];
		this.grid[move.source.y][move.source.x] = destinationTile;
		this.grid[destination.y][destination.x] = sourceTile;
		if (destinationVariant === undefined) delete this.metadata.tileVariants[sourceKey];
		else this.metadata.tileVariants[sourceKey] = destinationVariant;
		if (sourceVariant === undefined) delete this.metadata.tileVariants[destinationKey];
		else this.metadata.tileVariants[destinationKey] = sourceVariant;
		if (destinationDoorRequiresKey === undefined) delete this.metadata.doorRequiresKey[sourceKey];
		else this.metadata.doorRequiresKey[sourceKey] = destinationDoorRequiresKey;
		if (sourceDoorRequiresKey === undefined) delete this.metadata.doorRequiresKey[destinationKey];
		else this.metadata.doorRequiresKey[destinationKey] = sourceDoorRequiresKey;

		const moveEndpoint = point => {
			if (point.x === move.source.x && point.y === move.source.y) {
				return { x: destination.x, y: destination.y };
			}
			if (point.x === destination.x && point.y === destination.y) {
				return { x: move.source.x, y: move.source.y };
			}
			return point;
		};
		for (const link of this.metadata.portals) {
			link.source = moveEndpoint(link.source);
			link.destination = moveEndpoint(link.destination);
		}
		if (this.pendingPortalSource) this.pendingPortalSource = moveEndpoint(this.pendingPortalSource);

		this.refreshBlockProperties();
		this.saveCurrentLevel();
	}

	getGridCellFromPointer(event) {
		const rect = this.canvas.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return null;
		const x = Math.floor((event.clientX - rect.left) * this.canvas.width / rect.width / LevelEditor.CONFIG.CELL_SIZE);
		const y = Math.floor((event.clientY - rect.top) * this.canvas.height / rect.height / LevelEditor.CONFIG.CELL_SIZE);
		if (x < 0 || x >= LevelEditor.CONFIG.COLS || y < 0 || y >= LevelEditor.CONFIG.ROWS) return null;
		return { x, y };
	}

	setTileAt(x, y, tile, variant = null) {
		const key = getTileKey(x, y);
		this.grid[y][x] = tile;

		if (tile === TILE_TYPES.KEY && variant === TILE_VARIANTS.KEY.FAKE) {
			this.metadata.tileVariants[key] = variant;
		} else if (tile === TILE_TYPES.PORTAL
			&& (variant === TILE_VARIANTS.PORTAL.SECOND || variant === TILE_VARIANTS.PORTAL.ANY)) {
			this.metadata.tileVariants[key] = variant;
		} else {
			delete this.metadata.tileVariants[key];
		}
		if (tile !== TILE_TYPES.DOOR) delete this.metadata.doorRequiresKey[key];

		if (tile !== TILE_TYPES.PORTAL) {
			this.metadata.portals = this.metadata.portals.filter(link =>
				getTileKey(link.source.x, link.source.y) !== key
				&& getTileKey(link.destination.x, link.destination.y) !== key
			);
		} else {
			this.metadata.portals = this.metadata.portals.filter(link => this.isPortalLinkVariantPairValid(link));
		}
		this.refreshBlockProperties();
	}

	getTileVariantAt(x, y) {
		const tile = this.grid[y][x];
		const variant = this.metadata.tileVariants[getTileKey(x, y)];
		if (tile === TILE_TYPES.PORTAL) return variant ?? TILE_VARIANTS.PORTAL.FIRST;
		if (tile === TILE_TYPES.KEY) return variant ?? TILE_VARIANTS.KEY.DEFAULT;
		return null;
	}

	getDoorRequiresKeyAt(point) {
		return this.metadata.doorRequiresKey[getTileKey(point.x, point.y)] ?? true;
	}

	setDoorRequiresKeyAt(point, requiresKey) {
		const key = getTileKey(point.x, point.y);
		if (requiresKey) delete this.metadata.doorRequiresKey[key];
		else this.metadata.doorRequiresKey[key] = false;
		this.saveCurrentLevel();
	}

	isPortalLinkVariantPairValid(link) {
		const sourceVariant = this.getTileVariantAt(link.source.x, link.source.y);
		const destinationVariant = this.getTileVariantAt(link.destination.x, link.destination.y);
		return sourceVariant === TILE_VARIANTS.PORTAL.ANY
			|| destinationVariant === TILE_VARIANTS.PORTAL.ANY
			|| (sourceVariant === TILE_VARIANTS.PORTAL.FIRST
				&& destinationVariant === TILE_VARIANTS.PORTAL.SECOND);
	}

	openBlockProperties(point) {
		const tile = this.grid[point.y]?.[point.x];
		const block = LevelEditor.BLOCKS[tile];
		const propertyPanel = block?.propertyPanel && LevelEditor.PROPERTY_PANELS[block.propertyPanel];
		if (!propertyPanel || !this.blockPropertiesPanel || !this.blockPropertiesContent) {
			this.closeBlockProperties();
			return;
		}

		const sameCell = this.blockPropertiesCell?.x === point.x && this.blockPropertiesCell?.y === point.y;
		if (!sameCell) {
			this.blockPropertiesManuallyPositioned = false;
			this.blockPropertiesPosition = null;
		}
		this.blockPropertiesCell = { ...point };
		this.blockPropertiesTitle.textContent = propertyPanel.title(this, point);
		this.blockPropertiesContent.replaceChildren();
		propertyPanel.render(this, this.blockPropertiesContent, point);
		this.blockPropertiesPanel.hidden = false;
		this.positionBlockProperties();
	}

	closeBlockProperties() {
		if (this.blockPropertiesDrag) {
			const dragHandle = this.blockPropertiesPanel?.querySelector(".block-properties-header");
			if (dragHandle?.hasPointerCapture(this.blockPropertiesDrag.pointerId)) {
				dragHandle.releasePointerCapture(this.blockPropertiesDrag.pointerId);
			}
			this.blockPropertiesDrag = null;
			this.blockPropertiesPanel?.classList.remove("is-dragging");
		}
		if (this.blockPropertiesPanel) this.blockPropertiesPanel.hidden = true;
		this.blockPropertiesConnector?.setAttribute("hidden", "");
		this.blockPropertiesCell = null;
		this.blockPropertiesPosition = null;
		this.blockPropertiesManuallyPositioned = false;
	}

	refreshBlockProperties() {
		if (this.blockPropertiesPanel?.hidden || !this.blockPropertiesCell) return;
		this.openBlockProperties(this.blockPropertiesCell);
	}

	positionBlockProperties() {
		if (this.blockPropertiesPanel?.hidden || !this.blockPropertiesCell || !this.canvas) return;
		if (this.blockPropertiesManuallyPositioned && this.blockPropertiesPosition) {
			this.setBlockPropertiesPosition(
				this.blockPropertiesPosition.left,
				this.blockPropertiesPosition.top,
				true
			);
			return;
		}

		const canvasRect = this.canvas.getBoundingClientRect();
		if (canvasRect.width <= 0 || canvasRect.height <= 0) {
			this.blockPropertiesConnector?.setAttribute("hidden", "");
			return;
		}
		const cellWidth = canvasRect.width / LevelEditor.CONFIG.COLS;
		const cellHeight = canvasRect.height / LevelEditor.CONFIG.ROWS;
		const point = this.blockPropertiesCell;
		const cellRect = {
			left: canvasRect.left + point.x * cellWidth,
			right: canvasRect.left + (point.x + 1) * cellWidth,
			top: canvasRect.top + point.y * cellHeight,
			bottom: canvasRect.top + (point.y + 1) * cellHeight
		};
		const margin = 12;
		const gap = 8;
		const bounds = this.blockPropertiesPanel.getBoundingClientRect();
		const left = cellRect.right + gap + bounds.width <= window.innerWidth - margin
			? cellRect.right + gap
			: Math.max(margin, Math.min(cellRect.left - bounds.width - gap, window.innerWidth - bounds.width - margin));
		const top = Math.max(margin, Math.min(cellRect.top, window.innerHeight - bounds.height - margin));
		this.setBlockPropertiesPosition(left, top);
	}

	setBlockPropertiesPosition(left, top, manual = false) {
		const bounds = this.blockPropertiesPanel.getBoundingClientRect();
		const margin = 12;
		const maxLeft = Math.max(margin, window.innerWidth - bounds.width - margin);
		const maxTop = Math.max(margin, window.innerHeight - bounds.height - margin);
		const clampPosition = (candidateLeft, candidateTop) => ({
			left: Math.max(margin, Math.min(candidateLeft, maxLeft)),
			top: Math.max(margin, Math.min(candidateTop, maxTop))
		});
		let position = clampPosition(left, top);

		if (this.blockPropertiesCell && this.canvas) {
			const canvasRect = this.canvas.getBoundingClientRect();
			const cellWidth = canvasRect.width / LevelEditor.CONFIG.COLS;
			const cellHeight = canvasRect.height / LevelEditor.CONFIG.ROWS;
			const point = this.blockPropertiesCell;
			const cellRect = {
				left: canvasRect.left + point.x * cellWidth,
				right: canvasRect.left + (point.x + 1) * cellWidth,
				top: canvasRect.top + point.y * cellHeight,
				bottom: canvasRect.top + (point.y + 1) * cellHeight
			};
			const gap = 8;
			const overlapsSelectedCell = candidate =>
				candidate.left < cellRect.right + gap
				&& candidate.left + bounds.width > cellRect.left - gap
				&& candidate.top < cellRect.bottom + gap
				&& candidate.top + bounds.height > cellRect.top - gap;

			// The connector sits behind the panel, so keep the selected tile clear of it.
			if (overlapsSelectedCell(position)) {
				const alternatives = [
					clampPosition(cellRect.left - bounds.width - gap, position.top),
					clampPosition(cellRect.right + gap, position.top),
					clampPosition(position.left, cellRect.top - bounds.height - gap),
					clampPosition(position.left, cellRect.bottom + gap)
				];
				const nonOverlapping = alternatives.filter(candidate => !overlapsSelectedCell(candidate));
				const candidates = nonOverlapping.length > 0 ? nonOverlapping : alternatives;
				const best = candidates.reduce((nearest, candidate) => {
					const overlapWidth = Math.max(0,
						Math.min(candidate.left + bounds.width, cellRect.right + gap)
						- Math.max(candidate.left, cellRect.left - gap)
					);
					const overlapHeight = Math.max(0,
						Math.min(candidate.top + bounds.height, cellRect.bottom + gap)
						- Math.max(candidate.top, cellRect.top - gap)
					);
					const overlapArea = overlapWidth * overlapHeight;
					const distance = Math.hypot(candidate.left - position.left, candidate.top - position.top);
					const isBetter = nonOverlapping.length > 0
						? distance < nearest.distance
						: overlapArea < nearest.overlapArea
							|| (overlapArea === nearest.overlapArea && distance < nearest.distance);
					return isBetter ? { ...candidate, distance, overlapArea } : nearest;
				}, { ...candidates[0], distance: Infinity, overlapArea: Infinity });
				position = { left: best.left, top: best.top };
			}
		}

		this.blockPropertiesPanel.style.left = `${position.left}px`;
		this.blockPropertiesPanel.style.top = `${position.top}px`;
		this.updateBlockPropertiesConnector();
		if (manual) {
			this.blockPropertiesPosition = position;
			this.blockPropertiesManuallyPositioned = true;
		}
	}

	updateBlockPropertiesConnector() {
		if (!this.blockPropertiesConnector || !this.blockPropertiesConnectorLine
			|| !this.blockPropertiesConnectorTarget || this.blockPropertiesPanel?.hidden
			|| !this.blockPropertiesCell || !this.canvas) return;

		const canvasRect = this.canvas.getBoundingClientRect();
		if (canvasRect.width <= 0 || canvasRect.height <= 0) {
			this.blockPropertiesConnector.setAttribute("hidden", "");
			return;
		}
		const cellWidth = canvasRect.width / LevelEditor.CONFIG.COLS;
		const cellHeight = canvasRect.height / LevelEditor.CONFIG.ROWS;
		const point = this.blockPropertiesCell;
		const blockX = canvasRect.left + (point.x + 0.5) * cellWidth;
		const blockY = canvasRect.top + (point.y + 0.5) * cellHeight;
		const panelRect = this.blockPropertiesPanel.getBoundingClientRect();
		const diagonalOffset = 14;
		const offsetAlongEdge = (origin, start, end) => {
			const inset = Math.min(4, (end - start) / 2);
			const min = start + inset;
			const max = end - inset;
			const candidates = [origin - diagonalOffset, origin + diagonalOffset, min, max]
				.map(value => Math.max(min, Math.min(value, max)))
				.filter(value => Math.abs(value - origin) > 1);
			if (candidates.length === 0) return (min + max) / 2;
			const sufficientlyDiagonal = candidates.filter(value => Math.abs(value - origin) >= diagonalOffset);
			if (sufficientlyDiagonal.length > 0) {
				return sufficientlyDiagonal.reduce((closest, value) =>
					Math.abs(value - origin) < Math.abs(closest - origin) ? value : closest,
					sufficientlyDiagonal[0]
				);
			}
			return candidates.reduce((farthest, value) =>
				Math.abs(value - origin) > Math.abs(farthest - origin) ? value : farthest,
				candidates[0]
			);
		};
		const edgePoints = [
			{ x: panelRect.left, y: offsetAlongEdge(blockY, panelRect.top, panelRect.bottom) },
			{ x: panelRect.right, y: offsetAlongEdge(blockY, panelRect.top, panelRect.bottom) },
			{ x: offsetAlongEdge(blockX, panelRect.left, panelRect.right), y: panelRect.top },
			{ x: offsetAlongEdge(blockX, panelRect.left, panelRect.right), y: panelRect.bottom }
		].filter(candidate => Math.abs(candidate.x - blockX) > 1 && Math.abs(candidate.y - blockY) > 1);
		const connectorPoint = edgePoints.reduce((nearest, candidate) => {
			const distance = Math.hypot(candidate.x - blockX, candidate.y - blockY);
			return distance < nearest.distance ? { ...candidate, distance } : nearest;
		}, { x: panelRect.left, y: panelRect.top, distance: Infinity });
		const panelX = connectorPoint.x;
		const panelY = connectorPoint.y;

		this.blockPropertiesConnectorLine.setAttribute("x1", String(blockX));
		this.blockPropertiesConnectorLine.setAttribute("y1", String(blockY));
		this.blockPropertiesConnectorLine.setAttribute("x2", String(panelX));
		this.blockPropertiesConnectorLine.setAttribute("y2", String(panelY));
		this.blockPropertiesConnectorTarget.setAttribute("cx", String(blockX));
		this.blockPropertiesConnectorTarget.setAttribute("cy", String(blockY));
		this.blockPropertiesConnector.removeAttribute("hidden");
	}

	createPropertyField(definition, value, settings) {
		const row = document.createElement("label");
		row.className = "property-row";
		if (definition.visibleWhen) row.hidden = !definition.visibleWhen(settings);
		if (definition.bounceOnly) row.hidden = !settings.bounce;
		const label = document.createElement("span");
		label.textContent = definition.label;
		const input = definition.type === "select"
			? document.createElement("select")
			: document.createElement("input");
		input.dataset.momentumField = definition.name;
		if (definition.type === "checkbox") {
			input.type = "checkbox";
			input.checked = Boolean(value);
			row.append(label, input);
		} else if (definition.type === "select") {
			for (const optionDefinition of definition.options) {
				const option = document.createElement("option");
				option.value = optionDefinition.value;
				option.textContent = optionDefinition.label;
				input.appendChild(option);
			}
			input.value = String(value);
			row.append(label, input);
		} else {
			input.type = definition.type;
			if (definition.min !== undefined) input.min = String(definition.min);
			if (definition.max !== undefined) input.max = String(definition.max);
			if (definition.step !== undefined) input.step = String(definition.step);
			input.value = String(value);
			if (definition.direction) {
				const control = document.createElement("span");
				control.className = "portal-vector-angle-control";
				const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
				arrow.setAttribute("class", "portal-vector-arrow");
				arrow.setAttribute("viewBox", "0 0 40 40");
				arrow.setAttribute("role", "img");
				const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
				circle.setAttribute("cx", "20");
				circle.setAttribute("cy", "20");
				circle.setAttribute("r", "17");
				const vector = document.createElementNS("http://www.w3.org/2000/svg", "g");
				vector.dataset.momentumArrowVector = "";
				const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
				path.setAttribute("d", "M9 20h20m0 0-7-7m7 7-7 7");
				vector.appendChild(path);
				arrow.append(circle, vector);
				control.append(input, arrow);
				row.append(label, control);
			} else {
				row.append(label, input);
			}
		}
		return row;
	}

	createMomentumControls(settings, linkId = "") {
		const root = document.createElement("div");
		root.dataset.momentumScope = "";
		root.dataset.momentumLinkId = linkId;
		const enabled = document.createElement("label");
		enabled.className = "property-row";
		const enabledLabel = document.createElement("span");
		enabledLabel.textContent = "Momentum";
		const enabledInput = document.createElement("input");
		enabledInput.type = "checkbox";
		enabledInput.dataset.momentumEnabled = "";
		enabledInput.checked = settings.enabled;
		enabled.append(enabledLabel, enabledInput);
		root.appendChild(enabled);

		const options = document.createElement("fieldset");
		options.className = "momentum-options";
		options.disabled = !settings.enabled;
		const legend = document.createElement("legend");
		legend.textContent = "Momentum settings";
		options.appendChild(legend);
		for (const definition of LevelEditor.MOMENTUM_PROPERTIES) {
			if (definition.bounceOnly) continue;
			if (definition.name === "bounce") {
				const bounce = this.createPropertyField(definition, settings[definition.name], settings);
				options.appendChild(bounce);
				continue;
			}
			options.appendChild(this.createPropertyField(definition, settings[definition.name], settings));
		}
		const bounceOptions = document.createElement("fieldset");
		bounceOptions.className = "momentum-bounce-options";
		bounceOptions.disabled = !settings.bounce;
		const bounceLegend = document.createElement("legend");
		bounceLegend.textContent = "Bounce settings";
		bounceOptions.appendChild(bounceLegend);
		for (const definition of LevelEditor.MOMENTUM_PROPERTIES.filter(item => item.bounceOnly)) {
			bounceOptions.appendChild(this.createPropertyField(definition, settings[definition.name], settings));
		}
		options.appendChild(bounceOptions);
		root.appendChild(options);
		this.syncMomentumControls(root, settings);
		return root;
	}

	syncMomentumControls(root, settings) {
		const enabled = root.querySelector("[data-momentum-enabled]");
		if (enabled) enabled.checked = settings.enabled;
		for (const definition of LevelEditor.MOMENTUM_PROPERTIES) {
			const input = root.querySelector(`[data-momentum-field="${definition.name}"]`);
			if (!input) continue;
			if (definition.type === "checkbox") input.checked = settings[definition.name];
			else input.value = String(settings[definition.name]);
		}
		const options = root.querySelector(".momentum-options");
		if (options) options.disabled = !settings.enabled;
		const bounceOptions = root.querySelector(".momentum-bounce-options");
		if (bounceOptions) bounceOptions.disabled = !settings.bounce;
		for (const definition of LevelEditor.MOMENTUM_PROPERTIES) {
			const input = root.querySelector(`[data-momentum-field="${definition.name}"]`);
			const row = input?.closest(".property-row");
			if (!row) continue;
			if (definition.visibleWhen) row.hidden = !definition.visibleWhen(settings);
			if (definition.bounceOnly) row.hidden = !settings.bounce;
		}
		this.updateMomentumArrow(root);
	}

	updateMomentumArrow(root) {
		const input = root?.querySelector('[data-momentum-field="angle"]');
		const vector = root?.querySelector("[data-momentum-arrow-vector]");
		const arrow = vector?.closest("svg");
		const angle = input?.valueAsNumber;
		if (!Number.isFinite(angle)) {
			arrow?.setAttribute("hidden", "");
			return;
		}

		const normalizedAngle = ((angle % 360) + 360) % 360;
		const displayedAngle = Number(normalizedAngle.toFixed(1));
		if (arrow) {
			arrow.removeAttribute("hidden");
			arrow.setAttribute("aria-label", `Momentum direction: ${displayedAngle} degrees`);
		}
		vector?.setAttribute("transform", `rotate(${-normalizedAngle} 20 20)`);
	}

	readMomentumSettings(root) {
		const settings = { enabled: root.querySelector("[data-momentum-enabled]")?.checked ?? false };
		for (const definition of LevelEditor.MOMENTUM_PROPERTIES) {
			const input = root.querySelector(`[data-momentum-field="${definition.name}"]`);
			settings[definition.name] = definition.type === "checkbox"
				? input?.checked ?? false
				: definition.type === "number" ? input?.valueAsNumber : input?.value;
		}
		return settings;
	}

	isValidPortalMomentum(settings) {
		return (settings.calculation === "fixed" || settings.calculation === "dynamic")
			&& Number.isFinite(settings.velocity) && settings.velocity >= 0
			&& Number.isFinite(settings.multiplier) && settings.multiplier >= 0
			&& Number.isFinite(settings.angle)
			&& Number.isFinite(settings.bounceThreshold) && settings.bounceThreshold >= 0
			&& Number.isFinite(settings.bounceRetention)
			&& settings.bounceRetention >= 0 && settings.bounceRetention <= 1;
	}

	handleMomentumControlsChange(event) {
		const root = event.target.closest("[data-momentum-scope]");
		if (!root) return;
		const settings = this.readMomentumSettings(root);
		const linkId = root.dataset.momentumLinkId;
		const link = linkId && this.metadata.portals.find(candidate => this.getPortalLinkId(candidate) === linkId);
		const currentSettings = { ...DEFAULT_PORTAL_MOMENTUM, ...(link?.momentum ?? this.newPortalMomentumSettings) };
		if (!this.isValidPortalMomentum(settings)) {
			this.syncMomentumControls(root, currentSettings);
			return;
		}

		if (link) link.momentum = settings;
		else this.newPortalMomentumSettings = settings;
		this.syncMomentumControls(root, settings);
		if (link) {
			this.saveCurrentLevel();
			const summary = root.closest(".property-connection")?.querySelector("summary");
			if (summary) summary.textContent = this.getPortalConnectionLabel(link);
		}
	}

	handleBlockPropertyChange(event) {
		if (event.target.matches('[data-property="door-requires-key"]')) {
			if (!this.blockPropertiesCell) return;
			this.setDoorRequiresKeyAt(this.blockPropertiesCell, event.target.checked);
			return;
		}
		if (event.target.matches('[data-property="tile-variant"]')) {
			if (this.updateTileVariant(this.blockPropertiesCell, event.target.value)) {
				this.refreshBlockProperties();
			} else if (this.blockPropertiesCell) {
				event.target.value = this.getTileVariantAt(this.blockPropertiesCell.x, this.blockPropertiesCell.y);
			}
			return;
		}
		if (event.target.matches('[data-property="portal-link-mode"]')) {
			this.portalLinkMode = event.target.value === "bidirectional" ? "bidirectional" : "unidirectional";
			return;
		}
		if (event.target.matches("[data-momentum-enabled], [data-momentum-field]")) {
			this.handleMomentumControlsChange(event);
		}
	}

	updateTileVariant(point, variant) {
		if (!point) return false;
		const tile = this.grid[point.y]?.[point.x];
		const block = LevelEditor.BLOCKS[tile];
		if (!block?.variants || !Object.prototype.hasOwnProperty.call(block.variants, variant)) return false;

		const key = getTileKey(point.x, point.y);
		const previousVariant = this.metadata.tileVariants[key];
		const currentVariant = previousVariant ?? block.defaultVariant;
		if (currentVariant === variant) return false;

		if (variant === block.defaultVariant) delete this.metadata.tileVariants[key];
		else this.metadata.tileVariants[key] = variant;
		if (tile === TILE_TYPES.PORTAL
			&& this.metadata.portals.some(link => !this.isPortalLinkVariantPairValid(link))) {
			if (previousVariant === undefined) delete this.metadata.tileVariants[key];
			else this.metadata.tileVariants[key] = previousVariant;
			return false;
		}

		this.saveCurrentLevel();
		return true;
	}

	handleBlockPropertyAction(event) {
		const button = event.target.closest("button[data-property-action]");
		if (!button) return;
		const point = this.blockPropertiesCell;
		if (!point) return;

		if (button.dataset.propertyAction === "start-portal-link") {
			this.portalLinkMode = this.blockPropertiesContent.querySelector('[data-property="portal-link-mode"]')?.value === "bidirectional"
				? "bidirectional"
				: "unidirectional";
			this.portalEditAction = "link";
			this.pendingPortalSource = { ...point };
			this.closeBlockProperties();
			return;
		}

		if (button.dataset.propertyAction === "unlink-portal") {
			const key = getTileKey(point.x, point.y);
			this.metadata.portals = this.metadata.portals.filter(link =>
				getTileKey(link.source.x, link.source.y) !== key
				&& getTileKey(link.destination.x, link.destination.y) !== key
			);
			this.portalEditAction = null;
			this.pendingPortalSource = null;
			this.saveCurrentLevel();
			this.refreshBlockProperties();
			return;
		}

		if (button.dataset.propertyAction === "unlink-portal-connection") {
			const linkId = button.dataset.portalLinkId;
			const oldCount = this.metadata.portals.length;
			this.metadata.portals = this.metadata.portals.filter(link => this.getPortalLinkId(link) !== linkId);
			if (oldCount !== this.metadata.portals.length) this.saveCurrentLevel();
			this.refreshBlockProperties();
		}
	}

	createPropertyInput(definition, value, propertyName) {
		const row = document.createElement("label");
		row.className = "property-row";
		const label = document.createElement("span");
		label.textContent = definition.label;
		let input;
		if (definition.type === "select") {
			input = document.createElement("select");
			for (const optionDefinition of definition.options) {
				const option = document.createElement("option");
				option.value = optionDefinition.value;
				option.textContent = optionDefinition.label;
				input.appendChild(option);
			}
			input.value = String(value);
		} else if (definition.type === "checkbox") {
			input = document.createElement("input");
			input.type = "checkbox";
			input.checked = Boolean(value);
		} else {
			input = document.createElement("input");
			input.type = definition.type;
			input.value = String(value);
		}
		input.dataset.property = propertyName;
		row.append(label, input);
		return { row, input };
	}

	renderTileVariantProperty(container, point, title) {
		const tile = this.grid[point.y][point.x];
		const block = LevelEditor.BLOCKS[tile];
		const blockProperties = document.createElement("fieldset");
		blockProperties.className = "property-group";
		const legend = document.createElement("legend");
		legend.textContent = title;
		blockProperties.appendChild(legend);
		const variant = this.createPropertyInput({
			label: "Variant",
			type: "select",
			options: Object.entries(block.variants).map(([value, definition]) => ({
				value,
				label: definition.propertyLabel ?? definition.label
			}))
		}, this.getTileVariantAt(point.x, point.y), "tile-variant");
		blockProperties.appendChild(variant.row);
		container.appendChild(blockProperties);
	}

	renderKeyProperties(container, point) {
		this.renderTileVariantProperty(container, point, "Key block");
	}

	renderDoorProperties(container, point) {
		const property = this.createPropertyInput({
			label: "Require key",
			type: "checkbox"
		}, this.getDoorRequiresKeyAt(point), "door-requires-key");
		container.appendChild(property.row);
	}

	renderPortalProperties(container, point) {
		const key = getTileKey(point.x, point.y);
		this.renderTileVariantProperty(container, point, "Portal block");

		const newConnection = document.createElement("details");
		newConnection.className = "property-connection property-create-connection";
		const newSummary = document.createElement("summary");
		newSummary.textContent = "Add portal connection";
		newConnection.appendChild(newSummary);

		const newConnectionSettings = document.createElement("fieldset");
		newConnectionSettings.className = "property-group";
		const newLegend = document.createElement("legend");
		newLegend.textContent = "New connection";
		newConnectionSettings.appendChild(newLegend);

		const linkMode = this.createPropertyInput({
			label: "Connection",
			type: "select",
			options: [
				{ value: "unidirectional", label: "Unidirectional (one way)" },
				{ value: "bidirectional", label: "Bidirectional (two way)" }
			]
		}, this.portalLinkMode, "portal-link-mode");
		newConnectionSettings.appendChild(linkMode.row);
		newConnectionSettings.appendChild(this.createMomentumControls(this.newPortalMomentumSettings));
		const linkButton = document.createElement("button");
		linkButton.type = "button";
		linkButton.className = "property-action";
		linkButton.dataset.propertyAction = "start-portal-link";
		linkButton.textContent = "Start portal link";
		newConnectionSettings.appendChild(linkButton);
		newConnection.appendChild(newConnectionSettings);

		const connections = this.metadata.portals.filter(link =>
			getTileKey(link.source.x, link.source.y) === key
			|| getTileKey(link.destination.x, link.destination.y) === key
		);
		const connectionHeading = document.createElement("h3");
		connectionHeading.className = "property-section-heading";
		connectionHeading.textContent = "Linked portals";
		container.appendChild(connectionHeading);
		if (connections.length === 0) {
			const empty = document.createElement("p");
			empty.className = "property-empty";
			empty.textContent = "No linked portals.";
			container.appendChild(empty);
			container.appendChild(newConnection);
			return;
		}

		for (const link of connections) {
			const linkId = this.getPortalLinkId(link);
			const connection = document.createElement("details");
			connection.className = "property-connection";
			connection.open = connections.length === 1;
			const summary = document.createElement("summary");
			summary.textContent = this.getPortalConnectionLabel(link);
			connection.appendChild(summary);

			const actions = document.createElement("div");
			actions.className = "property-actions";
			const unlinkButton = document.createElement("button");
			unlinkButton.type = "button";
			unlinkButton.dataset.propertyAction = "unlink-portal-connection";
			unlinkButton.dataset.portalLinkId = linkId;
			unlinkButton.textContent = "Remove connection";
			actions.appendChild(unlinkButton);
			connection.append(actions, this.createMomentumControls(
				{ ...DEFAULT_PORTAL_MOMENTUM, ...link.momentum }, linkId
			));
			container.appendChild(connection);
		}

		const unlinkPortal = document.createElement("button");
		unlinkPortal.type = "button";
		unlinkPortal.className = "property-action";
		unlinkPortal.dataset.propertyAction = "unlink-portal";
		unlinkPortal.textContent = "Remove all connections";
		container.appendChild(unlinkPortal);
		container.appendChild(newConnection);
	}

	getPortalLinkId(link) {
		return `${getTileKey(link.source.x, link.source.y)}>${getTileKey(link.destination.x, link.destination.y)}`;
	}

	getPortalConnectionLabel(link) {
		const modeLabel = link.mode === "unidirectional" ? "One way" : "Two way";
		return `${modeLabel} · (${link.source.x}, ${link.source.y}) → (${link.destination.x}, ${link.destination.y}) · Momentum ${link.momentum?.enabled ? "on" : "off"}`;
	}

	handlePortalEditorClick(x, y) {
		if (this.grid[y][x] !== TILE_TYPES.PORTAL) {
			return;
		}

		const point = { x, y };
		if (!this.pendingPortalSource) {
			this.pendingPortalSource = point;
			return;
		}

		const firstPoint = this.pendingPortalSource;
		if (firstPoint.x === point.x && firstPoint.y === point.y) {
			return;
		}

		let source;
		let destination;
		const firstVariant = this.getTileVariantAt(firstPoint.x, firstPoint.y);
		const secondVariant = this.getTileVariantAt(point.x, point.y);
		if (this.portalLinkMode === "unidirectional") {
			const hasPortalAny = firstVariant === TILE_VARIANTS.PORTAL.ANY
				|| secondVariant === TILE_VARIANTS.PORTAL.ANY;
			if (!hasPortalAny && (firstVariant !== TILE_VARIANTS.PORTAL.FIRST
				|| secondVariant !== TILE_VARIANTS.PORTAL.SECOND)) {
				return;
			}
			if (hasPortalAny) {
				source = firstPoint;
				destination = point;
			} else {
				source = firstVariant === TILE_VARIANTS.PORTAL.FIRST ? firstPoint : point;
				destination = firstVariant === TILE_VARIANTS.PORTAL.SECOND ? firstPoint : point;
			}
		} else {
			const hasPortalAny = firstVariant === TILE_VARIANTS.PORTAL.ANY
				|| secondVariant === TILE_VARIANTS.PORTAL.ANY;
			if (!hasPortalAny && firstVariant === secondVariant) {
				return;
			}
			if (hasPortalAny) {
				source = firstPoint;
				destination = point;
			} else {
				source = firstVariant === TILE_VARIANTS.PORTAL.FIRST ? firstPoint : point;
				destination = firstVariant === TILE_VARIANTS.PORTAL.SECOND ? firstPoint : point;
			}
		}

		const sourceKey = getTileKey(source.x, source.y);
		const destinationKey = getTileKey(destination.x, destination.y);
		const endpointKeys = new Set([sourceKey, destinationKey]);
		this.metadata.portals = this.metadata.portals.filter(link => {
			const oldSourceKey = getTileKey(link.source.x, link.source.y);
			const oldDestinationKey = getTileKey(link.destination.x, link.destination.y);
			if (oldSourceKey === sourceKey) return false;
			return link.mode !== "bidirectional"
				|| (!endpointKeys.has(oldSourceKey) && !endpointKeys.has(oldDestinationKey));
		});

		if (this.portalLinkMode === "bidirectional") {
			this.metadata.portals = this.metadata.portals.filter(link =>
				!endpointKeys.has(getTileKey(link.source.x, link.source.y))
				&& !endpointKeys.has(getTileKey(link.destination.x, link.destination.y))
			);
		}

		this.metadata.portals.push({
			source,
			destination,
			mode: this.portalLinkMode,
			momentum: { ...this.newPortalMomentumSettings }
		});
		this.portalEditAction = null;
		this.pendingPortalSource = null;
		this.saveCurrentLevel();
	}

	draw(timestamp = 0) {
		if (!this.ctx) return;

		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

		for (let row = 0; row < LevelEditor.CONFIG.ROWS; row++) {
			for (let col = 0; col < LevelEditor.CONFIG.COLS; col++) {
				this.drawCell(row, col);
			}
		}
		this.drawMovingTile();
		this.drawPortalConnections(timestamp);
	}

	drawMovingTile() {
		const move = this.movingTile;
		if (!move || !move.target) return;

		const size = LevelEditor.CONFIG.CELL_SIZE;
		const sourceX = move.source.x * size;
		const sourceY = move.source.y * size;
		const targetX = move.target.x * size;
		const targetY = move.target.y * size;
		const block = LevelEditor.BLOCKS[move.tile];
		const color = block?.variants?.[move.variant]?.color || block?.color || "#000";

		this.ctx.save();
		this.ctx.strokeStyle = "#315bff";
		this.ctx.lineWidth = 2;
		this.ctx.setLineDash([4, 3]);
		this.ctx.strokeRect(sourceX + 2, sourceY + 2, size - 4, size - 4);
		if (move.target.x !== move.source.x || move.target.y !== move.source.y) {
			this.ctx.globalAlpha = 0.65;
			this.ctx.fillStyle = color;
			this.ctx.fillRect(targetX, targetY, size, size);
			this.ctx.globalAlpha = 1;
			this.ctx.strokeRect(targetX + 2, targetY + 2, size - 4, size - 4);
		}
		this.ctx.restore();
	}

	drawPortalConnections(timestamp) {
		const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const animationTime = reducedMotion ? 0 : timestamp;
		for (const link of this.metadata.portals) {
			this.drawPortalChain(link.source, link.destination, animationTime, false);
		}

		if (this.portalEditAction === "link" && this.pendingPortalSource && this.hoverCell
			&& (this.pendingPortalSource.x !== this.hoverCell.x || this.pendingPortalSource.y !== this.hoverCell.y)) {
			this.drawPortalChain(this.pendingPortalSource, this.hoverCell, animationTime, true);
		}
	}

	drawPortalChain(source, destination, timestamp, isPending) {
		const size = LevelEditor.CONFIG.CELL_SIZE;
		const startX = (source.x + 0.5) * size;
		const startY = (source.y + 0.5) * size;
		const endX = (destination.x + 0.5) * size;
		const endY = (destination.y + 0.5) * size;
		const deltaX = endX - startX;
		const deltaY = endY - startY;
		const distance = Math.hypot(deltaX, deltaY);
		if (distance <= 20) return;

		const directionX = deltaX / distance;
		const directionY = deltaY / distance;
		const angle = Math.atan2(deltaY, deltaX);
		const padding = Math.min(10, distance * 0.2);
		const chainLength = distance - padding * 2;
		const spacing = 9;
		const phase = (timestamp * 0.018) % spacing;
		const ctx = this.ctx;

		ctx.save();
		ctx.lineCap = "round";
		ctx.globalAlpha = isPending ? 0.95 : 0.75;
		ctx.beginPath();
		ctx.moveTo(startX + directionX * padding, startY + directionY * padding);
		ctx.lineTo(endX - directionX * padding, endY - directionY * padding);
		ctx.strokeStyle = "rgba(14, 10, 24, 0.8)";
		ctx.lineWidth = 6;
		ctx.stroke();

		ctx.beginPath();
		ctx.moveTo(startX + directionX * padding, startY + directionY * padding);
		ctx.lineTo(endX - directionX * padding, endY - directionY * padding);
		ctx.setLineDash([3, 7]);
		ctx.lineDashOffset = -timestamp * 0.025;
		ctx.strokeStyle = isPending ? "#ffffff" : "#d8b5ff";
		ctx.lineWidth = 2;
		ctx.stroke();
		ctx.setLineDash([]);

		ctx.beginPath();
		for (let offset = phase, index = 0; offset < chainLength; offset += spacing, index++) {
			const distanceAlong = padding + offset;
			const x = startX + directionX * distanceAlong;
			const y = startY + directionY * distanceAlong;
			const linkAngle = angle + (index % 2 === 0 ? -0.42 : 0.42);
			ctx.ellipse(x, y, 5.2, 3.1, linkAngle, 0, Math.PI * 2);
		}
		ctx.strokeStyle = "rgba(10, 7, 18, 0.95)";
		ctx.lineWidth = 4.2;
		ctx.stroke();
		const chainGradient = ctx.createLinearGradient(startX, startY, endX, endY);
		chainGradient.addColorStop(0, isPending ? "#f2d9ff" : "#d7aaff");
		chainGradient.addColorStop(1, isPending ? "#b8f2ff" : "#84dcff");
		ctx.strokeStyle = chainGradient;
		ctx.lineWidth = 2;
		ctx.stroke();
		ctx.restore();
	}

	drawCell(row, col) {
		const value = this.grid[row][col];
		const block = LevelEditor.BLOCKS[value];
		const x = col * LevelEditor.CONFIG.CELL_SIZE;
		const y = row * LevelEditor.CONFIG.CELL_SIZE;
		const size = LevelEditor.CONFIG.CELL_SIZE;
		const key = getTileKey(col, row);
		const variant = this.metadata.tileVariants[key] ?? block?.defaultVariant;
		const color = block?.variants?.[variant]?.color || block?.color || "#000";

		// Fill cell
		this.ctx.fillStyle = color;
		this.ctx.fillRect(x, y, size, size);

		// Draw grid lines
		this.ctx.strokeStyle = "rgba(0,0,0,0.08)";
		this.ctx.strokeRect(x, y, size, size);
		if (this.blockPropertiesCell?.x === col && this.blockPropertiesCell?.y === row) {
			this.ctx.strokeStyle = "#315bff";
			this.ctx.lineWidth = 2;
			this.ctx.setLineDash([3, 2]);
			this.ctx.strokeRect(x + 2, y + 2, size - 4, size - 4);
			this.ctx.setLineDash([]);
			this.ctx.lineWidth = 1;
		}
		if (this.pendingPortalSource?.x === col && this.pendingPortalSource?.y === row) {
			this.ctx.strokeStyle = "#315bff";
			this.ctx.lineWidth = 3;
			this.ctx.strokeRect(x + 2, y + 2, size - 4, size - 4);
			this.ctx.lineWidth = 1;
		}
	}

	startRenderLoop() {
		const render = (timestamp) => {
			this.draw(timestamp);
			requestAnimationFrame(render);
		};
		render();
	}

	// Level Management
	saveCurrentLevel() {
		const time = this.parseTimeInput();
		this.levelsMap.set(this.currentLevel, {
			name: this.levelNameInput?.value ?? this.levelsMap.get(this.currentLevel)?.name ?? "",
			grid: this.grid.map(row => [...row]),
			time,
			metadata: this.cloneMetadata(this.metadata)
		});
		this.recordHistoryState();
	}

	cloneLevel(level) {
		return {
			name: level.name,
			grid: level.grid.map(row => [...row]),
			time: level.time,
			metadata: this.cloneMetadata(level.metadata)
		};
	}

	createHistorySnapshot(previous = null) {
		const levels = new Map();
		for (const [key, level] of this.levelsMap) {
			const previousLevel = previous?.levels.get(key);
			const unchanged = previousLevel
				&& JSON.stringify(previousLevel) === JSON.stringify(level);
			levels.set(key, unchanged ? previousLevel : this.cloneLevel(level));
		}

		return {
			currentLevel: this.currentLevel,
			levelSetName: this.levelSetNameInput?.value ?? this.levelSetName,
			levels
		};
	}

	historySnapshotsMatch(first, second) {
		if (first.levelSetName !== second.levelSetName || first.levels.size !== second.levels.size) return false;
		for (const [key, level] of second.levels) {
			if (first.levels.get(key) !== level) return false;
		}
		return true;
	}

	recordHistoryState() {
		if (this.historyGroupActive) return;

		const previous = this.undoStack[this.undoStack.length - 1];
		const snapshot = this.createHistorySnapshot(previous);
		if (this.historySnapshotsMatch(previous, snapshot)) {
			previous.currentLevel = snapshot.currentLevel;
			return;
		}

		this.undoStack.push(snapshot);
		if (this.undoStack.length > LevelEditor.CONFIG.HISTORY_LIMIT) this.undoStack.shift();
		this.redoStack = [];
	}

	beginHistoryGroup() {
		this.historyGroupActive = true;
	}

	endHistoryGroup() {
		if (!this.historyGroupActive) return;
		this.historyGroupActive = false;
		this.recordHistoryState();
	}

	undo() {
		if (this.undoStack.length < 2) return;
		this.redoStack.push(this.undoStack.pop());
		this.applyHistorySnapshot(this.undoStack[this.undoStack.length - 1]);
	}

	redo() {
		if (this.redoStack.length === 0) return;
		const snapshot = this.redoStack.pop();
		this.undoStack.push(snapshot);
		this.applyHistorySnapshot(snapshot);
	}

	applyHistorySnapshot(snapshot) {
		this.levelsMap = new Map(
			Array.from(snapshot.levels, ([key, level]) => [key, this.cloneLevel(level)])
		);
		this.currentLevel = this.levelsMap.has(snapshot.currentLevel)
			? snapshot.currentLevel
			: this.getSortedLevelEntries()[0]?.[0] ?? "1";
		this.levelSetName = snapshot.levelSetName;
		const level = this.levelsMap.get(this.currentLevel);
		this.grid = level.grid.map(row => [...row]);
		this.metadata = this.cloneMetadata(level.metadata);
		this.pendingPortalSource = null;
		this.portalEditAction = null;
		this.movingTile = null;
		this.mouseDown = false;
		this.activeMouseButton = null;
		this.closeBlockProperties();
		this.refreshLevelList();
	}

	switchLevel(newLevel) {
		this.saveCurrentLevel();
		this.closeBlockProperties();
		const levelNumber = Number(newLevel);
		const levelKey = String(Number.isSafeInteger(levelNumber) && levelNumber > 0 ? levelNumber : 1);
		this.currentLevel = levelKey;
		this.pendingPortalSource = null;
		this.portalEditAction = null;

		if (this.levelsMap.has(levelKey)) {
			const level = this.levelsMap.get(levelKey);
			this.grid = level.grid.map(row => [...row]);
			this.metadata = this.cloneMetadata(level.metadata);
		} else {
			this.grid = this.createEmptyGrid();
			this.metadata = this.createEmptyMetadata();
			this.levelsMap.set(levelKey, {
				name: "",
				grid: this.grid.map(row => [...row]),
				time: LevelEditor.CONFIG.DEFAULT_TIME,
				metadata: this.cloneMetadata(this.metadata)
			});
		}

		this.refreshLevelList();
		this.saveCurrentLevel();
	}

	createNewLevel() {
		this.closeBlockProperties();
		this.grid = this.createEmptyGrid();
		this.metadata = this.createEmptyMetadata();
		this.pendingPortalSource = null;
		this.portalEditAction = null;
		this.levelsMap.set(this.currentLevel, {
			name: "",
			grid: this.grid.map(row => [...row]),
			time: this.parseTimeInput(),
			metadata: this.cloneMetadata(this.metadata)
		});
		this.refreshLevelList();
		this.saveCurrentLevel();
	}

	navigateLevel(direction) {
		const current = Number(this.currentLevel);
		const newLevel = Math.max(1, current + direction);
		this.switchLevel(newLevel);
	}

	exportCurrentLevel() {
		this.saveCurrentLevel();
		this.downloadLevelSet(new Map([[this.currentLevel, this.levelsMap.get(this.currentLevel)]]), `oh3-level-${this.currentLevel}.json`);
	}

	exportLevels() {
		this.saveCurrentLevel();
		this.downloadLevelSet(this.levelsMap, "oh3-levels.json");
	}

	downloadLevelSet(levels, filename) {
		const levelSetName = this.levelSetNameInput?.value ?? this.levelSetName;
		const content = JSON.stringify(encodeLevelSet(levels, levelSetName), null, 2);
		const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = filename;
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	playLevels() {
		this.saveCurrentLevel();
		const levels = new Map(
			this.getSortedLevelEntries().map(([, level], index) => [
				String(index + 1), level
			])
		);
		this.launchCustomLevels(levels);
	}

	playCurrentLevel() {
		this.saveCurrentLevel();
		this.launchCustomLevels(new Map([[
			"1",
			this.levelsMap.get(this.currentLevel)
		]]));
	}

	launchCustomLevels(levels) {
		try {
			const levelSetName = this.levelSetNameInput?.value ?? this.levelSetName;
			sessionStorage.setItem("oh3.customLevels", JSON.stringify(encodeLevelSet(levels, levelSetName)));
		} catch (error) {
			alert("Unable to start custom levels. Please allow session storage and try again.");
			return;
		}

		window.location.href = "../game/index.html?levels=custom";
	}

	deleteLevel() {
		if (!this.levelsMap.has(this.currentLevel)) return;

		this.closeBlockProperties();
		this.levelsMap.delete(this.currentLevel);

		const sorted = this.getSortedLevelEntries();

		if (sorted.length === 0) {
			this.currentLevel = "1";
			this.grid = this.createEmptyGrid();
			this.metadata = this.createEmptyMetadata();
			this.pendingPortalSource = null;
			this.portalEditAction = null;
			this.levelsMap.set(this.currentLevel, {
				name: "",
				grid: this.grid.map(row => [...row]),
				time: LevelEditor.CONFIG.DEFAULT_TIME,
				metadata: this.cloneMetadata(this.metadata)
			});
		} else {
			const currentNum = Number(this.currentLevel);
			let target = sorted.findLast(([k]) => Number(k) < currentNum);
			if (!target) target = sorted[0];

			this.currentLevel = target[0];
			this.grid = target[1].grid.map(row => [...row]);
			this.metadata = this.cloneMetadata(target[1].metadata);
			this.pendingPortalSource = null;
			this.portalEditAction = null;
		}

		this.refreshLevelList();
		this.saveCurrentLevel();
	}

	getSortedLevelEntries() {
		return Array.from(this.levelsMap.entries()).sort(([a], [b]) => {
			const numA = Number(a);
			const numB = Number(b);
			if (!isNaN(numA) && !isNaN(numB)) {
				return numA - numB;
			}
			return a.localeCompare(b);
		});
	}

	reorderLevels(sourceKey, targetKey, insertAfter) {
		if (!sourceKey || !targetKey || sourceKey === targetKey) return;

		this.saveCurrentLevel();
		const entries = this.getSortedLevelEntries();
		const sourceIndex = entries.findIndex(([key]) => key === sourceKey);
		if (sourceIndex < 0) return;

		const [movedEntry] = entries.splice(sourceIndex, 1);
		const targetIndex = entries.findIndex(([key]) => key === targetKey);
		if (targetIndex < 0) return;
		entries.splice(targetIndex + (insertAfter ? 1 : 0), 0, movedEntry);

		const currentIndex = entries.findIndex(([key]) => key === this.currentLevel);
		if (currentIndex < 0) return;

		this.levelsMap = new Map(entries.map(([, level], index) => [String(index + 1), level]));
		this.currentLevel = String(currentIndex + 1);

		this.refreshLevelList();
		this.saveCurrentLevel();
	}

	refreshLevelList() {
		if (!this.levelList) return;

		this.levelList.replaceChildren();
		this.timeInput = null;
		if (this.levelSetNameInput) this.levelSetNameInput.value = this.levelSetName;
		const currentLevel = this.levelsMap.get(this.currentLevel);
		if (this.levelNameInput) this.levelNameInput.value = currentLevel?.name ?? "";
		for (const [key, level] of this.getSortedLevelEntries()) {
			const item = document.createElement("li");
			item.className = "level-list-entry";
			if (key === this.currentLevel) item.classList.add("is-current");
			item.dataset.level = key;
			item.draggable = true;

			const button = document.createElement("button");
			button.type = "button";
			button.textContent = this.getLevelLabel(key, level);
			if (key === this.currentLevel) button.setAttribute("aria-current", "true");
			button.addEventListener("click", () => this.switchLevel(key));
			item.appendChild(button);

			const timeLabel = document.createElement("label");
			timeLabel.className = "level-time-control";
			timeLabel.append("Time: ");
			const timeInput = document.createElement("input");
			timeInput.className = "level-time-input";
			timeInput.type = "number";
			timeInput.min = "5";
			timeInput.step = "any";
			timeInput.value = String(Number.isFinite(level.time) ? level.time : LevelEditor.CONFIG.DEFAULT_TIME);
			timeLabel.appendChild(timeInput);
			item.appendChild(timeLabel);
			if (key === this.currentLevel) this.timeInput = timeInput;

			this.levelList.appendChild(item);
		}
	}

	getLevelLabel(key, level) {
		return level.name ? `Level ${key}: ${level.name}` : `Level ${key}`;
	}

	updateLevelsFromDecodedSet(decodedLevels) {
		this.closeBlockProperties();
		const entries = Object.entries(decodedLevels).sort(([a], [b]) => Number(a) - Number(b));
		this.levelsMap.clear();
		for (const [key, level] of entries) {
			this.levelsMap.set(key, {
				name: level.name,
				grid: level.grid.map(row => [...row]),
				time: level.time,
				metadata: this.cloneMetadata(level.metadata)
			});
		}

		if (!this.levelsMap.has(this.currentLevel)) {
			this.currentLevel = entries[0][0];
		}

		const currentLevel = this.levelsMap.get(this.currentLevel);
		this.grid = currentLevel.grid.map(row => [...row]);
		this.metadata = this.cloneMetadata(currentLevel.metadata);
		this.pendingPortalSource = null;
		this.portalEditAction = null;
		this.refreshLevelList();
	}
}

// Initialize the level editor when DOM is ready
(function () {
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', () => new LevelEditor());
	} else {
		new LevelEditor();
	}
})();
