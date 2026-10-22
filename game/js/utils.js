export function deepClone(obj) {
	return JSON.parse(JSON.stringify(obj));
}

// Pseudo-namespace export
export const utils = {
	deepClone,
};
