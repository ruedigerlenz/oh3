// game.js - Main game controller
import { Player } from './player.js';
import { Platform } from './platform.js';
import {
	decodeLevelSet,
	getTileKey,
	TILE_TYPES,
	TILE_VARIANTS
} from './level-format.js';
import { play } from './audio.js';
import logger from './log.js';

// Constants
const TILE_SIZE = 40;
const TARGET_FPS = 60;
const FIXED_DT = 1 / TARGET_FPS;
const DEFAULT_TIME = 30.0;
const MAX_FRAME_TIME = 0.25; // Prevent spiral of death
const MAX_PORTAL_TRANSITION_DURATION = 0.18;
const CUSTOM_LEVELS_STORAGE_KEY = 'oh3.customLevels';
const DEFAULT_LEVEL_SET = 'oh3';

function getSegmentRectangleEntry(startX, startY, endX, endY, left, top, right, bottom) {
	let entry = 0;
	let exit = 1;

	for (const [origin, delta, minimum, maximum] of [
		[startX, endX - startX, left, right],
		[startY, endY - startY, top, bottom]
	]) {
		if (delta === 0) {
			if (origin < minimum || origin > maximum) return null;
			continue;
		}

		const first = (minimum - origin) / delta;
		const second = (maximum - origin) / delta;
		entry = Math.max(entry, Math.min(first, second));
		exit = Math.min(exit, Math.max(first, second));
		if (entry > exit) return null;
	}

	return exit < 0 || entry > 1 ? null : Math.max(0, entry);
}

function getPortalPlaneCrossing(startX, startY, endX, endY, left, top, right, bottom) {
	const deltaX = endX - startX;
	const deltaY = endY - startY;
	if (startX >= left && startX <= right && startY >= top && startY <= bottom) return 0;
	if (deltaX === 0 && deltaY === 0) {
		return null;
	}

	if (Math.abs(deltaX) >= Math.abs(deltaY) && deltaX !== 0) {
		const planeX = deltaX > 0 ? left : right;
		const crossing = (planeX - startX) / deltaX;
		const crossingY = startY + deltaY * crossing;
		return crossing >= 0 && crossing <= 1 && crossingY >= top && crossingY <= bottom
			? crossing
			: null;
	}

	if (deltaY !== 0) {
		const planeY = deltaY > 0 ? top : bottom;
		const crossing = (planeY - startY) / deltaY;
		const crossingX = startX + deltaX * crossing;
		return crossing >= 0 && crossing <= 1 && crossingX >= left && crossingX <= right
			? crossing
			: null;
	}

	return null;
}

function getPortalPlane(bounds, direction, centerX, centerY) {
	if (Math.abs(direction.x) >= Math.abs(direction.y)) {
		return {
			x: direction.x >= 0 ? bounds.left : bounds.right,
			y: Math.max(bounds.top, Math.min(bounds.bottom, centerY))
		};
	}

	return {
		x: Math.max(bounds.left, Math.min(bounds.right, centerX)),
		y: direction.y >= 0 ? bounds.top : bounds.bottom
	};
}

function getProjectionRadius(width, height, direction) {
	return (Math.abs(direction.x) * width + Math.abs(direction.y) * height) / 2;
}

function clipRectangleToHalfPlane(x, y, width, height, plane, direction, threshold, keepLessThan) {
	const vertices = [
		{ x, y },
		{ x: x + width, y },
		{ x: x + width, y: y + height },
		{ x, y: y + height }
	];
	const project = point => (point.x - plane.x) * direction.x + (point.y - plane.y) * direction.y;
	const isInside = point => keepLessThan ? project(point) <= threshold : project(point) >= threshold;
	const clipped = [];
	let previous = vertices[vertices.length - 1];
	let previousInside = isInside(previous);

	for (const current of vertices) {
		const currentInside = isInside(current);
		if (currentInside !== previousInside) {
			const previousProjection = project(previous);
			const currentProjection = project(current);
			const amount = (threshold - previousProjection) / (currentProjection - previousProjection);
			clipped.push({
				x: previous.x + (current.x - previous.x) * amount,
				y: previous.y + (current.y - previous.y) * amount
			});
		}
		if (currentInside) clipped.push(current);
		previous = current;
		previousInside = currentInside;
	}

	return clipped;
}

function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
	const length = Math.hypot(x, y);
	if (Number.isFinite(length) && length > 0) return { x: x / length, y: y / length };

	const fallbackLength = Math.hypot(fallbackX, fallbackY);
	if (!Number.isFinite(fallbackLength) || fallbackLength === 0) return { x: 1, y: 0 };
	return { x: fallbackX / fallbackLength, y: fallbackY / fallbackLength };
}

class GameState {
	constructor() {
		this.currentLevel = 1;
		this.isPaused = false;
		this.isLoadingLevel = false;
		this.isGameOver = false;
		this.time = DEFAULT_TIME;
		this.initialTime = DEFAULT_TIME;
		this.winTime = 0.0;
		this.timePassed = false;

		// Level data
		this.levelData = [];
		this.levelMetadata = {
			tileVariants: Object.create(null),
			doorRequiresKey: Object.create(null),
			portals: []
		};
		this.portalDestinations = new Map();
		this.platforms = [];

		// Input
		this.keys = {};

		// Animation loop
		this.lastTimestamp = null;
		this.rafId = null;
		this.accumulator = 0;

		// Interaction state
		this.lastShakeTile = null;
		this.lastInvertTile = null;
		this.lastPortalTile = null;
		this.portalTransition = null;
		this.shakeTimeout = null;
	}

	reset() {
		this.isPaused = false;
		this.isLoadingLevel = false;
		this.isGameOver = false;
		this.time = this.initialTime;
		this.timePassed = false;
		this.keys = {};
		this.lastShakeTile = null;
		this.lastInvertTile = null;
		this.lastPortalTile = null;
		this.portalTransition = null;

		if (this.shakeTimeout) {
			clearTimeout(this.shakeTimeout);
			this.shakeTimeout = null;
		}
	}
}

class GameRenderer {
	constructor(canvasId) {
		this.canvas = document.getElementById(canvasId);
		if (!this.canvas) {
			logger.error('canvas', `Canvas not found with id "${canvasId}".`);
		}
		this.ctx = this.canvas?.getContext('2d') || null;
	}

	render(platforms, player, portalTransition) {
		if (!this.ctx) return;

		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		this.drawPlatforms(platforms);
		this.drawPlayer(player, portalTransition);
	}

	drawPlatforms(platforms) {
		if (!this.ctx) return;
		platforms.forEach(platform => platform.draw(this.ctx));
	}

	drawPlayer(player, portalTransition) {
		if (!this.ctx) return;
		if (!portalTransition) {
			player.draw(this.ctx);
			return;
		}

		const progress = Math.min(portalTransition.elapsed / portalTransition.duration, 1);
		const sourceProjectionRadius = getProjectionRadius(player.width, player.height, portalTransition.sourceDirection);
		const sourcePosition = {
			x: portalTransition.source.x + portalTransition.sourceDirection.x * (sourceProjectionRadius + 1) * progress,
			y: portalTransition.source.y + portalTransition.sourceDirection.y * (sourceProjectionRadius + 1) * progress
		};
		const destinationPosition = {
			x: portalTransition.destination.x
				+ (player.x - portalTransition.destination.x) * progress,
			y: portalTransition.destination.y
				+ (player.y - portalTransition.destination.y) * progress
		};

		this.drawPlayerPart(
			player,
			sourcePosition,
			portalTransition.sourcePlane,
			portalTransition.sourceDirection,
			0,
			true
		);
		this.drawPlayerPart(
			player,
			destinationPosition,
			portalTransition.destinationPlane,
			portalTransition.destinationDirection,
			0,
			false
		);
	}

	drawPlayerPart(player, position, plane, direction, threshold, keepLessThan) {
		const clipped = clipRectangleToHalfPlane(
			position.x,
			position.y,
			player.width,
			player.height,
			plane,
			direction,
			threshold,
			keepLessThan
		);
		if (clipped.length < 3) return;

		this.ctx.save();
		this.ctx.beginPath();
		this.ctx.moveTo(clipped[0].x, clipped[0].y);
		for (let index = 1; index < clipped.length; index++) {
			this.ctx.lineTo(clipped[index].x, clipped[index].y);
		}
		this.ctx.closePath();
		this.ctx.clip();
		player.draw(this.ctx, position.x, position.y);
		this.ctx.restore();
	}
}

class LevelManager {
	static findPlayerSpawnPosition(level, player) {
		for (let row = 0; row < level.length; row++) {
			for (let col = 0; col < level[row].length; col++) {
				if (level[row][col] === TILE_TYPES.PLAYER_SPAWN) {
					return {
						x: col * TILE_SIZE + (TILE_SIZE - player.width) / 2,
						y: row * TILE_SIZE + (TILE_SIZE - player.height) / 2
					};
				}
			}
		}

		// Fallback position
		return { x: 50, y: 520 };
	}

	static createPlatformsFromLevel(level, metadata) {
		const platforms = [];

		for (let row = 0; row < level.length; row++) {
			for (let col = 0; col < level[row].length; col++) {
				const tile = level[row][col];

				// Skip empty tiles and player spawn
				if (tile === TILE_TYPES.EMPTY || tile === TILE_TYPES.PLAYER_SPAWN) {
					continue;
				}

				const variant = metadata.tileVariants[getTileKey(col, row)];
				let type = 'normal';
				if (tile === TILE_TYPES.DOOR) type = 'door';
				if (tile === TILE_TYPES.KEY) {
					type = variant === TILE_VARIANTS.KEY.FAKE ? 'fake_key' : 'key';
				}
				if (tile === TILE_TYPES.PORTAL) {
					if (variant === TILE_VARIANTS.PORTAL.SECOND) type = 'portal_2';
					else if (variant === TILE_VARIANTS.PORTAL.ANY) type = 'portal_any';
					else type = 'portal_1';
				}
				if (tile === TILE_TYPES.INVERT) type = 'invert';
				if (tile === TILE_TYPES.KILL) type = 'kill';
				platforms.push(new Platform(
					col * TILE_SIZE,
					row * TILE_SIZE,
					TILE_SIZE,
					TILE_SIZE,
					type
				));
			}
		}

		return platforms;
	}

	static createPortalDestinations(metadata) {
		const destinations = new Map();
		for (const link of metadata.portals) {
			const sourceKey = getTileKey(link.source.x, link.source.y);
			const destinationKey = getTileKey(link.destination.x, link.destination.y);
			destinations.set(sourceKey, {
				source: link.source,
				destination: link.destination,
				momentum: link.momentum
			});
			if (link.mode === 'bidirectional') {
				destinations.set(destinationKey, {
					source: link.destination,
					destination: link.source,
					momentum: link.momentum
				});
			}
		}
		return destinations;
	}
}

class UIManager {
	static updateLevelDisplay(levelName, levelNumber) {
		const levelNameEl = document.getElementById('level-name');
		if (levelNameEl) {
			levelNameEl.textContent = levelName ? `Level ${levelNumber}: ${levelName}` : `Level ${levelNumber}`;
		}
	}

	static updateTimeDisplay(time) {
		const timeEl = document.getElementById('time');
		if (timeEl) {
			timeEl.innerText = Math.max(0, time).toFixed(3);
		}
	}

	static showPauseOverlay(show) {
		const pausedElement = document.getElementById('paused');
		if (pausedElement) {
			pausedElement.style.display = show ? 'block' : 'none';
		}
	}

	static shakeGameContainer(playSound = true) {
		const gameContainer = document.querySelector('.game-container');
		if (!gameContainer) return null;

		gameContainer.classList.remove('shake');
		void gameContainer.offsetWidth; // Force reflow
		gameContainer.classList.add('shake');

		if (playSound) play('shake');

		return setTimeout(() => {
			gameContainer.classList.remove('shake');
		}, 500);
	}
}

class InteractionHandler {
	constructor(gameState, player) {
		this.gameState = gameState;
		this.player = player;
	}

	handleTileInteractions() {
		const playerCenterX = this.player.x + this.player.width / 2;
		const playerCenterY = this.player.y + this.player.height / 2;
		const playerTileX = Math.floor(playerCenterX / TILE_SIZE);
		const playerTileY = Math.floor(playerCenterY / TILE_SIZE);
		const tile = this.gameState.levelData[playerTileY]?.[playerTileX] ?? null;
		if (this.handlePortalInteraction(tile, playerTileX, playerTileY)) return null;

		// Check each interaction type and return early if an action is needed
		let result = this.handleDoorInteraction(tile, playerTileX, playerTileY);
		if (result) return result;

		this.handleKeyInteraction(tile, playerTileX, playerTileY);
		this.handleInvertInteraction(tile, playerTileX, playerTileY);

		result = this.handleKillInteraction(tile);
		if (result) return result;

		return null;
	}

	handleDoorInteraction(tile, playerTileX, playerTileY) {
		if (tile !== TILE_TYPES.DOOR) {
			this.gameState.lastShakeTile = null;
			return null;
		}

		const doorKey = getTileKey(playerTileX, playerTileY);
		const requiresKey = this.gameState.levelMetadata.doorRequiresKey[doorKey] ?? true;
		if (requiresKey && !this.player.hasKey) {
			logger.debug('door', 'Player tried to open door without key.');
			const tileId = `${playerTileX},${playerTileY}`;

			if (this.gameState.lastShakeTile !== tileId) {
				this.gameState.shakeTimeout = UIManager.shakeGameContainer(true);
				this.gameState.lastShakeTile = tileId;
			}
			return null;
		} else {
			logger.debug('door', 'Player opened door.');
			this.gameState.lastShakeTile = null;
			play('door');
			this.gameState.currentLevel++;
			return 'LOAD_NEXT_LEVEL';
		}
	}

	handleKeyInteraction(tile, playerTileX, playerTileY) {
		if (tile !== TILE_TYPES.KEY) return;

		const tileKey = getTileKey(playerTileX, playerTileY);
		const isFakeKey = this.gameState.levelMetadata.tileVariants[tileKey] === TILE_VARIANTS.KEY.FAKE;
		if (isFakeKey) {
			this.gameState.shakeTimeout = UIManager.shakeGameContainer(false);
			logger.debug('key', 'Player got the fake key.');
			play('key');
		} else {
			if (this.player.hasKey || this.gameState.time <= 0) return;

			this.gameState.shakeTimeout = UIManager.shakeGameContainer(false);
			logger.debug('key', 'Player got the key.');
			play('key');
			this.player.hasKey = true;
		}

		this.gameState.levelData[playerTileY][playerTileX] = TILE_TYPES.EMPTY;
		this.gameState.platforms = LevelManager.createPlatformsFromLevel(
			this.gameState.levelData,
			this.gameState.levelMetadata
		);
	}

	handlePortalInteraction(tile, playerTileX, playerTileY) {
		const currentTileKey = tile === TILE_TYPES.PORTAL ? getTileKey(playerTileX, playerTileY) : null;
		const startX = (this.player.previousX ?? this.player.x) + this.player.width / 2;
		const startY = (this.player.previousY ?? this.player.y) + this.player.height / 2;
		const endX = this.player.x + this.player.width / 2;
		const endY = this.player.y + this.player.height / 2;
		const previousPortal = this.gameState.portalDestinations.get(this.gameState.lastPortalTile);
		const previousPortalEntry = previousPortal && getSegmentRectangleEntry(
			startX,
			startY,
			endX,
			endY,
			previousPortal.source.x * TILE_SIZE,
			previousPortal.source.y * TILE_SIZE,
			(previousPortal.source.x + 1) * TILE_SIZE,
			(previousPortal.source.y + 1) * TILE_SIZE
		);
		if (currentTileKey !== this.gameState.lastPortalTile
			&& (!previousPortal || previousPortalEntry === null)) {
			this.gameState.lastPortalTile = null;
		}

		let portal = null;
		let earliestEntry = Infinity;
		for (const [candidateKey, candidate] of this.gameState.portalDestinations) {
			if (candidateKey === this.gameState.lastPortalTile) continue;
			const entry = getPortalPlaneCrossing(
				startX,
				startY,
				endX,
				endY,
				candidate.source.x * TILE_SIZE,
				candidate.source.y * TILE_SIZE,
				(candidate.source.x + 1) * TILE_SIZE,
				(candidate.source.y + 1) * TILE_SIZE
			);
			if (entry !== null && entry < earliestEntry) {
				portal = candidate;
				earliestEntry = entry;
			}
		}
		if (!portal) return false;

		const incomingVelocityX = this.player.previousVelocityX ?? this.player.velocityX;
		const incomingVelocityY = this.player.previousVelocityY ?? this.player.velocityY;
		const sourceDirection = normalizeDirection(
			endX - startX,
			endY - startY,
			incomingVelocityX,
			incomingVelocityY
		);
		const momentumAngle = ((portal.momentum?.angle ?? 0) % 360) * Math.PI / 180;
		const destinationDirection = portal.momentum?.enabled
			? normalizeDirection(
				Math.cos(momentumAngle),
				-Math.sin(momentumAngle),
				sourceDirection.x,
				sourceDirection.y
			)
			: sourceDirection;
		const sourceBounds = {
			left: portal.source.x * TILE_SIZE,
			top: portal.source.y * TILE_SIZE,
			right: (portal.source.x + 1) * TILE_SIZE,
			bottom: (portal.source.y + 1) * TILE_SIZE
		};
		const crossingX = startX + (endX - startX) * earliestEntry;
		const crossingY = startY + (endY - startY) * earliestEntry;
		const sourcePlane = getPortalPlane(sourceBounds, sourceDirection, crossingX, crossingY);
		const sourcePosition = {
			x: sourcePlane.x - this.player.width / 2,
			y: sourcePlane.y - this.player.height / 2
		};
		const destinationBounds = {
			left: portal.destination.x * TILE_SIZE,
			top: portal.destination.y * TILE_SIZE,
			right: (portal.destination.x + 1) * TILE_SIZE,
			bottom: (portal.destination.y + 1) * TILE_SIZE
		};
		const destinationPlane = getPortalPlane(
			destinationBounds,
			destinationDirection,
			(portal.destination.x + 0.5) * TILE_SIZE,
			(portal.destination.y + 0.5) * TILE_SIZE
		);
		const destinationPlanePosition = {
			x: destinationPlane.x - this.player.width / 2,
			y: destinationPlane.y - this.player.height / 2
		};
		this.player.applyPortalMomentum(
			portal.momentum,
			incomingVelocityX,
			incomingVelocityY
		);
		const destinationProjectionRadius = getProjectionRadius(
			this.player.width,
			this.player.height,
			destinationDirection
		);
		this.player.x = destinationPlanePosition.x + destinationDirection.x * destinationProjectionRadius;
		this.player.y = destinationPlanePosition.y + destinationDirection.y * destinationProjectionRadius;
		this.player.previousX = this.player.x;
		this.player.previousY = this.player.y;
		const sourceSpeed = Math.hypot(incomingVelocityX, incomingVelocityY);
		const destinationSpeed = Math.hypot(this.player.velocityX, this.player.velocityY);
		const visualSpeed = Math.max(sourceSpeed, destinationSpeed, 0.1);
		const visualDistance = Math.max(
			getProjectionRadius(this.player.width, this.player.height, sourceDirection) + 1,
			destinationProjectionRadius
		);
		const duration = Math.min(
			MAX_PORTAL_TRANSITION_DURATION,
			Math.max(FIXED_DT, visualDistance / (visualSpeed / FIXED_DT))
		);
		this.gameState.portalTransition = {
			source: sourcePosition,
			sourcePlane,
			destination: destinationPlanePosition,
			destinationPlane,
			sourceDirection,
			destinationDirection,
			duration,
			elapsed: 0
		};
		this.gameState.lastPortalTile = getTileKey(portal.destination.x, portal.destination.y);
		return true;
	}

	handleInvertInteraction(tile, playerTileX, playerTileY) {
		if (tile === TILE_TYPES.INVERT) {
			const tileId = `${playerTileX},${playerTileY}`;

			if (this.gameState.lastInvertTile !== tileId) {
				this.player.inverted = !this.player.inverted;
				this.player.gravity = -this.player.gravity;
				logger.debug('invert', 'Player got inverted.');
				play('invert');
				this.gameState.lastInvertTile = tileId;
			}
		} else if (this.gameState.lastInvertTile) {
			this.gameState.lastInvertTile = null;
		}
	}

	handleKillInteraction(tile) {
		if (tile === TILE_TYPES.KILL) {
			return 'RESET_GAME';
		}
		return null;
	}
}

class Game {
	constructor(canvasId = 'gameCanvas') {
		this.usesCustomLevels = new URLSearchParams(window.location.search).get('levels') === 'custom';
		const customLevelSet = this.usesCustomLevels ? this.loadCustomLevels() : null;
		this.levels = customLevelSet?.levels ?? null;
		this.levelSetName = customLevelSet?.name ?? '';
		this.state = new GameState();
		this.renderer = new GameRenderer(canvasId);
		this.player = this.createPlayer();
		this.interactionHandler = new InteractionHandler(this.state, this.player);

		this.setupEventListeners();
	}

	loadCustomLevels() {
		try {
			return decodeLevelSet(JSON.parse(sessionStorage.getItem(CUSTOM_LEVELS_STORAGE_KEY)));
		} catch (error) {
			logger.error('loadCustomLevels', 'Failed to read custom levels: ', error);
		}

		return { name: '', levels: Object.create(null) };
	}

	async loadBuiltInLevels() {
		const levelSetId = new URLSearchParams(window.location.search).get('levelset') || DEFAULT_LEVEL_SET;
		if (!/^[a-z0-9_-]+$/i.test(levelSetId)) {
			throw new Error('Invalid levelset name');
		}

		const response = await fetch(new URL(`../levelsets/${encodeURIComponent(levelSetId)}.json`, import.meta.url));
		if (!response.ok) {
			throw new Error(`Failed to load levelset ${levelSetId} (${response.status})`);
		}
		return decodeLevelSet(await response.json());
	}

	createPlayer() {
		const params = new URLSearchParams(window.location.search);
		return new Player(50, 520, 22, 40, params.get('color') || 'black');
	}

	setupEventListeners() {
		window.addEventListener('keydown', (e) => this.handleKeyDown(e));
		window.addEventListener('keyup', (e) => this.handleKeyUp(e));
	}

	handleKeyDown(e) {
		if (e.key === 'p') {
			this.togglePause();
			return;
		}

		if (e.key === 'q') {
			try { window.close(); } catch (e) { }
			return;
		}

		if (!this.state.isLoadingLevel && this.player.canMove) {
			this.state.keys[e.key] = true;

			if (['ArrowUp', 'w', 'W'].includes(e.key)) {
				this.handleJump();
			}
		}
	}

	handleKeyUp(e) {
		if (this.state.isLoadingLevel) return;
		this.state.keys[e.key] = false;
	}

	handleJump() {
		const didJump = this.player.jump();
		if (didJump) {
			logger.debug('jump', 'Player jumped.');
			if (!this.state.isPaused) {
				play('jump');
			}
		}
	}

	togglePause() {
		logger.debug('pause', 'Game paused/unpaused.');
		this.state.isPaused = !this.state.isPaused;
		UIManager.showPauseOverlay(this.state.isPaused);
	}

	loadLevel(levelIndex) {
		if (this.state.isLoadingLevel) return;

		const idx = Number(levelIndex);

		if (!(idx in this.levels)) {
			if (!this.player.alerted) {
				alert(this.usesCustomLevels
					? 'Congratulations! You have finished your custom levels!'
					: `Congratulations! You have finished ${this.levelSetName || 'Oh3'}!`);
				this.player.alerted = true;
				window.location.href = "/";
			}
			return;
		}

		this.state.isLoadingLevel = true;
		this.state.currentLevel = idx;
		this.player.reset();
		this.state.keys = {};
		this.state.portalTransition = null;

		try { window.blur(); } catch (e) { }

		const level = this.levels[this.state.currentLevel];
		const normalized = {
			name: level.name,
			grid: level.grid.map(row => [...row]),
			time: level.time,
			metadata: level.metadata
		};

		this.state.levelData = normalized.grid;
		this.state.levelMetadata = normalized.metadata;
		this.state.portalDestinations = LevelManager.createPortalDestinations(normalized.metadata);
		this.state.lastPortalTile = null;
		this.state.platforms = LevelManager.createPlatformsFromLevel(this.state.levelData, normalized.metadata);

		const spawnPos = LevelManager.findPlayerSpawnPosition(this.state.levelData, this.player);
		this.player.x = spawnPos.x;
		this.player.y = spawnPos.y;

		this.state.initialTime = normalized.time || DEFAULT_TIME;
		this.state.time = this.state.initialTime;

		UIManager.updateLevelDisplay(normalized.name, idx);
		UIManager.updateTimeDisplay(this.state.time);

		setTimeout(() => {
			this.player.canMove = true;
			this.state.isLoadingLevel = false;
		}, 100);
	}

	resetGame() {
		logger.debug('reset', 'Game reset.');
		this.player.reset();
		this.state.reset();
		this.loadLevel(1);
	}

	update(dt) {
		if (this.state.isPaused) return;

		if (this.state.portalTransition) {
			this.state.portalTransition.elapsed += dt;
			if (this.state.portalTransition.elapsed >= this.state.portalTransition.duration) {
				this.state.portalTransition = null;
			}
		}

		this.player.update(this.state.keys, this.state.platforms, this.renderer.canvas);

		const interactionResult = this.interactionHandler.handleTileInteractions();

		if (interactionResult === 'LOAD_NEXT_LEVEL') {
			// Level was already incremented in handleDoorInteraction
			this.loadLevel(this.state.currentLevel);
			return;
		}

		if (interactionResult === 'RESET_GAME') {
			this.resetGame();
			return;
		}

		this.updateTimer(dt);
	}

	updateTimer(dt) {
		if (this.state.isGameOver) {
			this.player.hasKey = false;
			this.state.timePassed = true;
		}

		if (!this.player.alerted) {
			if (this.state.time > 0) {
				this.state.time -= dt;
				UIManager.updateTimeDisplay(this.state.time);
			} else {
				this.resetGame();
			}
		} else {
			this.state.time = this.state.winTime;
			UIManager.updateTimeDisplay(Math.abs(this.state.time));
		}
	}

	render() {
		this.renderer.render(this.state.platforms, this.player, this.state.portalTransition);
	}

	gameLoop(timestamp) {
		if (!this.state.lastTimestamp) {
			this.state.lastTimestamp = timestamp;
			this.state.accumulator = 0;
			this.state.rafId = requestAnimationFrame((t) => this.gameLoop(t));
			return;
		}

		// Convert ms to seconds and clamp large dt
		const frameTime = Math.min((timestamp - this.state.lastTimestamp) / 1000, MAX_FRAME_TIME);
		this.state.lastTimestamp = timestamp;
		this.state.accumulator += frameTime;

		if (this.state.isPaused) {
			this.state.accumulator = 0;
			this.render();
			this.state.rafId = requestAnimationFrame((t) => this.gameLoop(t));
			return;
		}

		// Fixed timestep updates
		while (this.state.accumulator >= FIXED_DT) {
			this.update(FIXED_DT);
			this.state.accumulator -= FIXED_DT;
		}

		this.render();
		this.state.rafId = requestAnimationFrame((t) => this.gameLoop(t));
	}

	startLoop() {
		if (this.state.rafId) return;

		this.state.lastTimestamp = null;
		this.state.accumulator = 0;
		this.state.rafId = requestAnimationFrame((t) => this.gameLoop(t));
	}

	stopLoop() {
		if (!this.state.rafId) return;

		cancelAnimationFrame(this.state.rafId);
		this.state.rafId = null;
	}

	async init() {
		if (!this.usesCustomLevels) {
			try {
				const levelSet = await this.loadBuiltInLevels();
				this.levels = levelSet.levels;
				this.levelSetName = levelSet.name;
			} catch (error) {
				logger.error('loadBuiltInLevels', 'Failed to load built-in levels: ', error);
				alert('Unable to load the selected levelset. Make sure the game is being served from a web server and reload.');
				return;
			}
		}

		if (this.usesCustomLevels && !Object.prototype.hasOwnProperty.call(this.levels, '1')) {
			alert('No custom levels were found. Return to the level editor and use Play Level or Play All.');
			window.location.href = '../../editor/index.html';
			return;
		}

		// Initialize with safe defaults
		try {
			const normalized = this.levels[this.state.currentLevel];
			this.state.levelData = normalized.grid.map(row => [...row]);
			this.state.levelMetadata = normalized.metadata;
			this.state.portalDestinations = LevelManager.createPortalDestinations(normalized.metadata);
			this.state.initialTime = normalized.time;
			this.state.time = this.state.initialTime;
			this.state.platforms = LevelManager.createPlatformsFromLevel(this.state.levelData, normalized.metadata);

			const spawnPos = LevelManager.findPlayerSpawnPosition(this.state.levelData, this.player);
			this.player.x = spawnPos.x;
			this.player.y = spawnPos.y;
		} catch (err) {
			// Fallback to minimal safe values
			this.state.levelData = [];
			this.state.levelMetadata = {
				tileVariants: Object.create(null),
				doorRequiresKey: Object.create(null),
				portals: []
			};
			this.state.portalDestinations = new Map();
			this.state.initialTime = DEFAULT_TIME;
			this.state.time = this.state.initialTime;
			this.state.platforms = [];
		}

		this.loadLevel(this.state.currentLevel);
		this.startLoop();
	}
}

// Create and initialize the game instance
const gameInstance = new Game();
gameInstance.init();

// Export the game instance and utilities
export { gameInstance as game };
export const tileSize = TILE_SIZE;
export const getCurrentLevel = () => gameInstance.state.currentLevel;
// For backwards compatibility, also export as currentLevel (though it will be static)
export let currentLevel = gameInstance.state.currentLevel;
