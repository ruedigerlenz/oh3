export const sounds = {
	jump: new Audio('assets/jump.wav'),
	shake: new Audio('assets/shake.wav'),
	door: new Audio('assets/door.wav'),
	key: new Audio('assets/key.wav')
};

export function play(soundName) {
	const s = sounds[soundName];
	if (!s) return;

	try {
		if (s.paused) {
			s.play();
		}
	} catch (e) { }
}


// Pseudo-namespace export
export const audio = {
	sounds,
	play,
};
