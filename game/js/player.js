import { isColliding } from './platform.js';

export class Player {
	constructor(x, y, width, height, color) {
		this.initialX = x;
		this.initialY = y;
		this.x = x;
		this.y = y;
		this.width = width;
		this.height = height;
		this.speed = 5.5;
		this.color = color || 'black';
		this.velocityX = 0;
		this.velocityY = 0;
		this.previousX = x;
		this.previousY = y;
		this.previousVelocityX = 0;
		this.previousVelocityY = 0;
		this.isJumping = false;
		this.gravity = 0.5;
		this.initialGravity = this.gravity;
		this.friction = 0.7;
		this.jumpStrength = -10;
		this.grounded = false;
		this.hasKey = false;
		this.alerted = false;
		this.canMove = true;
		this.inverted = false;
		this.portalMomentumSettings = null;
		this.portalMomentumCoasting = false;
	}

	reset() {
		this.x = this.initialX;
		this.y = this.initialY;
		this.velocityX = 0;
		this.velocityY = 0;
		this.grounded = false;
		this.gravity = this.initialGravity;
		this.hasKey = false;
		this.alerted = false;
		this.isJumping = false;
		this.timePassed = false;
		this.inverted = false;
		this.portalMomentumSettings = null;
		this.portalMomentumCoasting = false;
	}

	applyPortalMomentum(settings, incomingVelocityX = this.velocityX, incomingVelocityY = this.velocityY) {
		const incomingSpeed = Math.hypot(incomingVelocityX, incomingVelocityY);
		this.velocityX = 0;
		this.velocityY = 0;
		this.portalMomentumSettings = null;
		this.portalMomentumCoasting = false;
		if (!settings?.enabled) return;

		const speed = settings.calculation === 'fixed'
			? settings.velocity
			: incomingSpeed * settings.multiplier;
		if (!Number.isFinite(speed) || speed < 0) return;

		const angleDegrees = settings.angle % 360;
		const angleRadians = angleDegrees * Math.PI / 180;
		const velocityX = speed * Math.cos(angleRadians);
		const velocityY = -speed * Math.sin(angleRadians);
		if (!Number.isFinite(velocityX) || !Number.isFinite(velocityY)) return;

		this.velocityX = velocityX;
		this.velocityY = velocityY;
		this.portalMomentumSettings = {
			bounce: settings.bounce,
			bounceThreshold: settings.bounceThreshold,
			bounceRetention: settings.bounceRetention
		};
		this.portalMomentumCoasting = true;
		this.grounded = false;
		this.isJumping = false;
		this.isUnderground = false;
	}

	tryPortalMomentumBounce(impactVelocityY) {
		const settings = this.portalMomentumSettings;
		if (!settings) return false;

		if (!settings.bounce || impactVelocityY * this.gravity <= 0
			|| Math.abs(impactVelocityY) <= settings.bounceThreshold
			|| settings.bounceRetention <= 0) {
			this.portalMomentumSettings = null;
			this.portalMomentumCoasting = false;
			return false;
		}

		const reboundSpeed = Math.abs(impactVelocityY) * settings.bounceRetention;
		if (!Number.isFinite(reboundSpeed) || reboundSpeed === 0) {
			this.portalMomentumSettings = null;
			this.portalMomentumCoasting = false;
			return false;
		}

		this.velocityY = -Math.sign(impactVelocityY) * reboundSpeed;
		this.grounded = false;
		this.isJumping = true;
		this.isUnderground = false;
		return true;
	}

	draw(ctx, x = this.x, y = this.y) {
		ctx.fillStyle = this.color;
		ctx.fillRect(x, y, this.width, this.height);
	}

	update(keys, platforms, canvas) {
		this.previousX = this.x;
		this.previousY = this.y;

		if (this.canMove) {
			// Define moving right and left
			const movingRight = keys['ArrowRight'] || keys['d'] || keys['D'];
			const movingLeft = keys['ArrowLeft'] || keys['a'] || keys['A'];

			// Preserve portal launch momentum until the player steers, then restore normal air friction.
			if (movingRight) {
				this.portalMomentumCoasting = false;
				this.velocityX = this.speed;
			} else if (movingLeft) {
				this.portalMomentumCoasting = false;
				this.velocityX = -this.speed;
			} else if (!this.portalMomentumCoasting || this.grounded) {
				this.velocityX *= this.friction;
				if (Math.abs(this.velocityX) < 0.1) this.velocityX = 0;
			}
		}

		// Apply gravity
		this.velocityY += this.gravity;
		this.previousVelocityX = this.velocityX;
		this.previousVelocityY = this.velocityY;

		// Move horizontally
		this.x += this.velocityX;
		this.handleHorizontalCollisions(platforms, canvas, this.previousX);

		// Move vertically
		this.y += this.velocityY;
		this.handleVerticalCollisions(platforms, canvas, this.previousY);

		// Clamp the player INSIDE the CANVAS
		if (this.x < 0) {
			this.x = 0
			this.velocityX = 0
		}
		if (this.x + this.width > canvas.width) {
			this.x = canvas.width - this.width
			this.velocityX = 0
		}

		if (this.y < 0) {
			this.y = 0
			this.velocityY = 0
		}
		if (this.y + this.height > canvas.height) {
			this.y = canvas.height - this.height
			this.velocityY = 0
		}
	}

	handleHorizontalCollisions(platforms, canvas, previousX = this.x) {
		platforms.forEach(platform => {
			const overlapsVertically = this.y < platform.y + platform.height
				&& this.y + this.height > platform.y;
			const crossedRightEdge = this.velocityX > 0
				&& previousX + this.width <= platform.x
				&& this.x + this.width >= platform.x;
			const crossedLeftEdge = this.velocityX < 0
				&& previousX >= platform.x + platform.width
				&& this.x <= platform.x + platform.width;
			if ((platform.type === 'normal' || platform.type === 'disappear')
				&& (isColliding(this, platform) || (overlapsVertically && (crossedRightEdge || crossedLeftEdge)))) {
				if (this.velocityX > 0) {
					this.x = platform.x - this.width;
				} else if (this.velocityX < 0) {
					this.x = platform.x + platform.width;
				}
				this.velocityX = 0;
			}
		});

		// Prevent player from leaving the canvas horizontally
		if (this.x <= 0) {
			this.x = 0;
			this.velocityX = 0;
		}
		if (this.x + this.width >= canvas.width) {
			this.x = canvas.width - this.width;
			this.velocityX = 0;
		}
	}

	handleVerticalCollisions(platforms, canvas, previousY = this.y) {
		this.grounded = false;

		for (const platform of platforms) {
			const overlapsHorizontally = this.x < platform.x + platform.width
				&& this.x + this.width > platform.x;
			const crossedTopEdge = this.velocityY > 0
				&& previousY + this.height <= platform.y
				&& this.y + this.height >= platform.y;
			const crossedBottomEdge = this.velocityY < 0
				&& previousY >= platform.y + platform.height
				&& this.y <= platform.y + platform.height;
			if ((platform.type === 'normal')
				&& (isColliding(this, platform)
					|| (overlapsHorizontally && (crossedTopEdge || crossedBottomEdge)))) {
				if (this.gravity > 0) { // Normal gravity
					if (this.velocityY > 0) { // Falling down
						this.y = platform.y - this.height;
						if (this.tryPortalMomentumBounce(this.velocityY)) return;
						this.velocityY = 0;
						this.grounded = true;
						this.isJumping = false;
						this.isUnderground = false;
					} else if (this.velocityY < 0) { // Jumping up
						this.y = platform.y + platform.height;
						this.velocityY = 0;
						this.portalMomentumSettings = null;
						this.portalMomentumCoasting = false;
						this.isUnderground = true;
					}
				} else { // Inverted gravity
					if (this.velocityY < 0) { // Moving up towards new ground
						this.y = platform.y + platform.height;
						if (this.tryPortalMomentumBounce(this.velocityY)) return;
						this.velocityY = 0;
						this.grounded = true;
						this.isJumping = false;
						this.isUnderground = false;
					} else if (this.velocityY > 0) { // Moving down towards ceiling
						this.y = platform.y - this.height;
						this.velocityY = 0;
						this.portalMomentumSettings = null;
						this.portalMomentumCoasting = false;
						this.isUnderground = true;
					}
				}
			}
		}

		// Prevent player from falling below or above the canvas based on gravity
		if (this.gravity > 0) { // Normal gravity
			if (this.y + this.height >= canvas.height) {
				this.y = canvas.height - this.height;
				if (this.tryPortalMomentumBounce(this.velocityY)) return;
				this.velocityY = 0;
				this.grounded = true;
				this.isJumping = false;
			}
		} else { // Inverted gravity
			if (this.y <= 0) {
				this.y = 0;
				if (this.tryPortalMomentumBounce(this.velocityY)) return;
				this.velocityY = 0;
				this.grounded = true;
				this.isJumping = false;
			}
		}
	}

	jump() {
		// Attempt to jump. Return true if jump was performed.
		if (!this.isJumping && this.grounded) {
			// Jump in the opposite direction of gravity
			if (this.gravity > 0) {
				// Normal gravity: jump up (negative velocity)
				this.velocityY = -Math.abs(this.jumpStrength);
			} else {
				// Inverted gravity: jump down (positive velocity)  
				this.velocityY = Math.abs(this.jumpStrength);
			}
			this.isJumping = true;
			this.grounded = false; // leave the ground immediately
			return true;
		}
		return false;
	}
}

export function isBlockedAbove(playerObj, platformsArr, padding = 4) {
	if (!playerObj) return false;
	function rectsOverlap(a, b) {
		return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
	}

	const check = { x: playerObj.x, y: playerObj.y - padding, width: playerObj.width, height: padding };
	return platformsArr.some(p => (p.type === 'normal' || p.type === 'disappear') && rectsOverlap(check, p));
}

export function isBlockedBelow(player, platforms) {
	const playerBottom = player.y + player.height;
	const checkY = playerBottom + 1; // Check just below the player

	// Check multiple points across the player's width
	for (let x = player.x + 2; x < player.x + player.width - 2; x += 4) {
		for (const platform of platforms) {
			if (x >= platform.x &&
				x <= platform.x + platform.width &&
				checkY >= platform.y &&
				checkY <= platform.y + platform.height) {
				return true;
			}
		}
	}
	return false;
}

// Pseudo-namespace export for convenience: player.Player and player.isBlockedAbove
export const player = {
	Player,
	isBlockedAbove,
	isBlockedBelow,
};
