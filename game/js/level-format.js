export const LEVEL_ROWS = 15;
export const LEVEL_COLUMNS = 20;

export const TILE_TYPES = Object.freeze({
	EMPTY: 0,
	NORMAL: 1,
	DOOR: 2,
	KEY: 3,
	PORTAL: 4,
	INVERT: 5,
	KILL: 6,
	PLAYER_SPAWN: 7
});

export const TILE_VARIANTS = Object.freeze({
	KEY: Object.freeze({ DEFAULT: 'normal', FAKE: 'fake' }),
	PORTAL: Object.freeze({ FIRST: '1', SECOND: '2', ANY: 'any' })
});

export const DEFAULT_PORTAL_MOMENTUM = Object.freeze({
	enabled: false,
	calculation: 'dynamic',
	velocity: 0,
	multiplier: 1.0,
	angle: 0,
	bounce: false,
	bounceThreshold: 2.0,
	bounceRetention: 0.5
});

// Base64URL packs three 4-bit tile codes into each pair of characters.
const TILE_VALUES = [0, 1, 2, 3, 4, 5, 6, 7];
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const CODE_BY_CHARACTER = new Int8Array(128).fill(-1);

for (let code = 0; code < ALPHABET.length; code++) {
	CODE_BY_CHARACTER[ALPHABET.charCodeAt(code)] = code;
}

function getTileCode(tile) {
	if (Number.isInteger(tile) && tile >= TILE_TYPES.EMPTY && tile <= TILE_TYPES.PLAYER_SPAWN) return tile;
	throw new Error(`Invalid level tile value: ${tile}`);
}

export function getTileKey(x, y) {
	return `${x},${y}`;
}

function validateCoordinate(point, description) {
	if (!point || typeof point !== 'object' || Array.isArray(point)
		|| !Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y)
		|| point.x < 0 || point.x >= LEVEL_COLUMNS
		|| point.y < 0 || point.y >= LEVEL_ROWS) {
		throw new Error(`${description} must be a tile coordinate within the level`);
	}

	return { x: point.x, y: point.y };
}

function validatePortalMomentum(momentum, description) {
	if (momentum === undefined) return { ...DEFAULT_PORTAL_MOMENTUM };
	if (!momentum || typeof momentum !== 'object' || Array.isArray(momentum)) {
		throw new Error(`${description} must be an object`);
	}

	const enabled = momentum.enabled ?? DEFAULT_PORTAL_MOMENTUM.enabled;
	const calculation = momentum.calculation ?? DEFAULT_PORTAL_MOMENTUM.calculation;
	const velocity = momentum.velocity ?? DEFAULT_PORTAL_MOMENTUM.velocity;
	const multiplier = momentum.multiplier ?? DEFAULT_PORTAL_MOMENTUM.multiplier;
	const angle = momentum.angle ?? DEFAULT_PORTAL_MOMENTUM.angle;
	const bounce = momentum.bounce ?? DEFAULT_PORTAL_MOMENTUM.bounce;
	const bounceThreshold = momentum.bounceThreshold ?? DEFAULT_PORTAL_MOMENTUM.bounceThreshold;
	const bounceRetention = momentum.bounceRetention ?? DEFAULT_PORTAL_MOMENTUM.bounceRetention;

	if (typeof enabled !== 'boolean') {
		throw new Error(`${description} enabled must be a boolean`);
	}
	if (calculation !== 'fixed' && calculation !== 'dynamic') {
		throw new Error(`${description} calculation must be fixed or dynamic`);
	}
	if (typeof velocity !== 'number' || !Number.isFinite(velocity) || velocity < 0) {
		throw new Error(`${description} velocity must be a finite non-negative number`);
	}
	if (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier < 0) {
		throw new Error(`${description} multiplier must be a finite non-negative number`);
	}
	if (typeof angle !== 'number' || !Number.isFinite(angle)) {
		throw new Error(`${description} angle must be a finite number`);
	}
	if (typeof bounce !== 'boolean') {
		throw new Error(`${description} bounce must be a boolean`);
	}
	if (typeof bounceThreshold !== 'number' || !Number.isFinite(bounceThreshold) || bounceThreshold < 0) {
		throw new Error(`${description} bounce threshold must be a finite non-negative number`);
	}
	if (typeof bounceRetention !== 'number' || !Number.isFinite(bounceRetention)
		|| bounceRetention < 0 || bounceRetention > 1) {
		throw new Error(`${description} bounce retention must be a number between 0 and 1`);
	}

	return { enabled, calculation, velocity, multiplier, angle, bounce, bounceThreshold, bounceRetention };
}

function validateMetadata(metadata, grid) {
	// tileVariants and doorRequiresKey store per-tile overrides by "x,y"; portals stores links and momentum.
	if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
		|| !metadata.tileVariants || typeof metadata.tileVariants !== 'object' || Array.isArray(metadata.tileVariants)
		|| !Array.isArray(metadata.portals)) {
		throw new Error('Level metadata must contain tileVariants and portals');
	}

	const tileVariants = Object.create(null);
	for (const [key, variant] of Object.entries(metadata.tileVariants)) {
		const match = /^(0|[1-9]\d*),(0|[1-9]\d*)$/.exec(key);
		if (!match) {
			throw new Error(`Invalid tile variant coordinate: ${key}`);
		}

		const x = Number(match[1]);
		const y = Number(match[2]);
		if (x >= LEVEL_COLUMNS || y >= LEVEL_ROWS) {
			throw new Error(`Tile variant coordinate is outside the level: ${key}`);
		}

		const tile = grid[y][x];
		const isFakeKey = tile === TILE_TYPES.KEY && variant === TILE_VARIANTS.KEY.FAKE;
		const isPortalVariant = tile === TILE_TYPES.PORTAL
			&& (variant === TILE_VARIANTS.PORTAL.SECOND || variant === TILE_VARIANTS.PORTAL.ANY);
		if (!isFakeKey && !isPortalVariant) {
			throw new Error(`Invalid variant "${variant}" for tile at ${key}`);
		}
		tileVariants[key] = variant;
	}

	const rawDoorRequiresKey = metadata.doorRequiresKey === undefined ? {} : metadata.doorRequiresKey;
	if (!rawDoorRequiresKey || typeof rawDoorRequiresKey !== 'object' || Array.isArray(rawDoorRequiresKey)) {
		throw new Error('Door require-key metadata must be an object');
	}
	const doorRequiresKey = Object.create(null);
	for (const [key, requiresKey] of Object.entries(rawDoorRequiresKey)) {
		const match = /^(0|[1-9]\d*),(0|[1-9]\d*)$/.exec(key);
		if (!match) {
			throw new Error(`Invalid door setting coordinate: ${key}`);
		}

		const x = Number(match[1]);
		const y = Number(match[2]);
		if (x >= LEVEL_COLUMNS || y >= LEVEL_ROWS) {
			throw new Error(`Door setting coordinate is outside the level: ${key}`);
		}
		if (grid[y][x] !== TILE_TYPES.DOOR) {
			throw new Error(`Door setting at ${key} does not refer to a door tile`);
		}
		if (typeof requiresKey !== 'boolean') {
			throw new Error(`Door setting at ${key} must be a boolean`);
		}
		doorRequiresKey[key] = requiresKey;
	}

	const portals = [];
	const usedAsSource = new Set();
	const endpointUseCount = new Map();
	for (const [index, link] of metadata.portals.entries()) {
		if (!link || typeof link !== 'object' || Array.isArray(link)
			|| (link.mode !== 'unidirectional' && link.mode !== 'bidirectional')) {
			throw new Error(`Portal link ${index + 1} must have a unidirectional or bidirectional mode`);
		}

		const source = validateCoordinate(link.source, `Portal link ${index + 1} source`);
		const destination = validateCoordinate(link.destination, `Portal link ${index + 1} destination`);
		const sourceKey = getTileKey(source.x, source.y);
		const destinationKey = getTileKey(destination.x, destination.y);
		if (sourceKey === destinationKey) {
			throw new Error(`Portal link ${index + 1} cannot point to itself`);
		}
		if (grid[source.y][source.x] !== TILE_TYPES.PORTAL || grid[destination.y][destination.x] !== TILE_TYPES.PORTAL) {
			throw new Error(`Portal link ${index + 1} must connect two portal tiles`);
		}
		const sourceVariant = tileVariants[sourceKey] ?? TILE_VARIANTS.PORTAL.FIRST;
		const destinationVariant = tileVariants[destinationKey] ?? TILE_VARIANTS.PORTAL.FIRST;
		const hasPortalAny = sourceVariant === TILE_VARIANTS.PORTAL.ANY
			|| destinationVariant === TILE_VARIANTS.PORTAL.ANY;
		if (!hasPortalAny && (sourceVariant !== TILE_VARIANTS.PORTAL.FIRST
			|| destinationVariant !== TILE_VARIANTS.PORTAL.SECOND)) {
			throw new Error(`Portal link ${index + 1} must connect Portal 1 to Portal 2 unless an endpoint is Portal Any`);
		}
		if (usedAsSource.has(sourceKey)) {
			throw new Error(`Portal ${sourceKey} has more than one destination`);
		}
		usedAsSource.add(sourceKey);

		endpointUseCount.set(sourceKey, (endpointUseCount.get(sourceKey) || 0) + 1);
		endpointUseCount.set(destinationKey, (endpointUseCount.get(destinationKey) || 0) + 1);
		if (link.mode === 'bidirectional') {
			if (usedAsSource.has(destinationKey)) {
				throw new Error(`Portal ${destinationKey} has conflicting links`);
			}
			usedAsSource.add(destinationKey);
		}

		portals.push({
			source,
			destination,
			mode: link.mode,
			momentum: validatePortalMomentum(link.momentum, `Portal link ${index + 1} momentum`)
		});
	}

	for (const link of portals) {
		if (link.mode === 'bidirectional'
			&& (endpointUseCount.get(getTileKey(link.source.x, link.source.y)) !== 1
				|| endpointUseCount.get(getTileKey(link.destination.x, link.destination.y)) !== 1)) {
			throw new Error('A bidirectional portal must be linked only to its paired portal');
		}
	}

	return { tileVariants, doorRequiresKey, portals };
}

function validateLevelName(name, description) {
	if (name === undefined) return '';
	if (typeof name !== 'string') {
		throw new Error(`${description} must be a string`);
	}
	return name;
}

export function encodeGrid(grid) {
	if (!Array.isArray(grid) || grid.length !== LEVEL_ROWS) {
		throw new Error(`Level grid must have exactly ${LEVEL_ROWS} rows`);
	}

	const codes = new Uint8Array(LEVEL_ROWS * LEVEL_COLUMNS);
	let index = 0;
	for (const row of grid) {
		if (!Array.isArray(row) || row.length !== LEVEL_COLUMNS) {
			throw new Error(`Each level row must have exactly ${LEVEL_COLUMNS} tiles`);
		}

		for (const tile of row) {
			codes[index++] = getTileCode(tile);
		}
	}

	let packed = '';
	for (index = 0; index < codes.length; index += 3) {
		const first = codes[index];
		const second = codes[index + 1];
		const third = codes[index + 2];
		packed += ALPHABET[(first << 2) | (second >> 2)];
		packed += ALPHABET[((second & 3) << 4) | third];
	}

	return packed;
}

export function decodeGrid(packed) {
	const tileCount = LEVEL_ROWS * LEVEL_COLUMNS;
	if (typeof packed !== 'string' || packed.length !== tileCount * 2 / 3) {
		throw new Error(`Packed level map must contain exactly ${tileCount * 2 / 3} characters`);
	}

	const tiles = new Array(tileCount);
	let tileIndex = 0;
	for (let index = 0; index < packed.length; index += 2) {
		const firstCharacter = packed.charCodeAt(index);
		const secondCharacter = packed.charCodeAt(index + 1);
		const first = firstCharacter < CODE_BY_CHARACTER.length ? CODE_BY_CHARACTER[firstCharacter] : -1;
		const second = secondCharacter < CODE_BY_CHARACTER.length ? CODE_BY_CHARACTER[secondCharacter] : -1;
		if (first < 0 || second < 0) {
			throw new Error('Packed level map contains a character outside the Base64URL alphabet');
		}

		const codes = [first >> 2, ((first & 3) << 2) | (second >> 4), second & 15];
		for (const code of codes) {
			if (code >= TILE_VALUES.length) {
				throw new Error(`Packed level map contains an unknown tile code: ${code}`);
			}
			tiles[tileIndex++] = TILE_VALUES[code];
		}
	}

	const grid = [];
	for (let row = 0; row < LEVEL_ROWS; row++) {
		grid.push(tiles.slice(row * LEVEL_COLUMNS, (row + 1) * LEVEL_COLUMNS));
	}
	return grid;
}

export function decodeLevel(level) {
	if (!level || typeof level !== 'object' || Array.isArray(level)) {
		throw new Error('Level must be an object with time, map, and metadata fields');
	}
	if (typeof level.time !== 'number' || !Number.isFinite(level.time)) {
		throw new Error('Level time must be a finite number');
	}

	const grid = decodeGrid(level.map);
	return {
		name: validateLevelName(level.name, 'Level name'),
		grid,
		time: level.time,
		metadata: validateMetadata(level.metadata, grid)
	};
}

export function decodeLevelSet(levelSet) {
	if (!levelSet || typeof levelSet !== 'object' || Array.isArray(levelSet)
		|| !levelSet.levels || typeof levelSet.levels !== 'object' || Array.isArray(levelSet.levels)) {
		throw new Error('Invalid level set; expected an object with a levels property');
	}

	const decodedLevels = Object.create(null);
	const entries = Object.entries(levelSet.levels);
	if (entries.length === 0) {
		throw new Error('Level set must contain at least one level');
	}

	for (const [key, level] of entries) {
		if (!/^[1-9]\d*$/.test(key) || !Number.isSafeInteger(Number(key))) {
			throw new Error(`Invalid level number: ${key}`);
		}
		decodedLevels[key] = decodeLevel(level);
	}

	return {
		name: validateLevelName(levelSet.name, 'Level set name'),
		levels: decodedLevels
	};
}

export function encodeLevelSet(levelEntries, levelSetName = '') {
	const entries = levelEntries instanceof Map
		? Array.from(levelEntries.entries())
		: Object.entries(levelEntries);
	const encodedLevels = Object.create(null);
	if (entries.length === 0) {
		throw new Error('Level set must contain at least one level');
	}

	for (const [rawKey, level] of entries) {
		const key = String(rawKey);
		if (!/^[1-9]\d*$/.test(key) || !Number.isSafeInteger(Number(key))) {
			throw new Error(`Invalid level number: ${key}`);
		}
		if (Object.prototype.hasOwnProperty.call(encodedLevels, key)) {
			throw new Error(`Duplicate level number: ${key}`);
		}
		if (!level || typeof level !== 'object' || !Number.isFinite(level.time)) {
			throw new Error(`Level ${key} must have a finite time, a grid, and metadata`);
		}

		const grid = level.grid;
		encodedLevels[key] = {
			name: validateLevelName(level.name, `Level ${key} name`),
			time: level.time,
			map: encodeGrid(grid),
			metadata: validateMetadata(level.metadata, grid)
		};
	}

	return {
		name: validateLevelName(levelSetName, 'Level set name'),
		levels: encodedLevels
	};
}
