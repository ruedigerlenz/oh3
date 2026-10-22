export class Platform {
	constructor(x, y, width, height, type = 'normal') {
		this.x = x;
		this.y = y;
		this.width = width;
		this.height = height;
		this.type = type; // 'normal', 'door', 'key'
	}

	draw(ctx) {
		switch (this.type) {
			case 'door':
				ctx.fillStyle = '#303030'; // Door color
				break;
			case 'key':
				ctx.fillStyle = '#E2E200';
				break;
			case 'fake_key':
				ctx.fillStyle = '#E2E201';
				break;
			case 'portal_1':
				ctx.fillStyle = '#B200FF';
				break;
			case 'portal_2':
				ctx.fillStyle = '#0094FF';
				break;
			case 'portal_any':
				ctx.fillStyle = '#FF8C00';
				break;
			case 'invert':
				ctx.fillStyle = '#57007F';
				break;
			case 'kill':
				ctx.fillStyle = '#ff0000';
				break;
			default:
				ctx.fillStyle = '#dcdcdc';
		}
		ctx.fillRect(this.x, this.y, this.width, this.height);
	}
}

export function isColliding(player, platform) {
	return player.x < platform.x + platform.width &&
		player.x + player.width > platform.x &&
		player.y < platform.y + platform.height &&
		player.y + player.height > platform.y;
}

// Pseudo-namespace export
export const platform = {
	Platform,
	isColliding,
};
