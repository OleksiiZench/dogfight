const FRAME = 128;

export interface SpriteFrame {
	image: HTMLImageElement;
	sx: number;
	sy: number;
	sw: number;
	sh: number;
}

export interface Sprites {
	ship: SpriteFrame;
	bullet: SpriteFrame;
	asteroid: SpriteFrame;
	pickup: SpriteFrame;
}

function frame(image: HTMLImageElement, index: number): SpriteFrame {
	return { image, sx: index * FRAME, sy: 0, sw: FRAME, sh: FRAME };
}

export function createSprites(sheet: unknown): Sprites | null {
	if (!(sheet instanceof HTMLImageElement)) return null;
	return {
		ship: frame(sheet, 0),
		bullet: frame(sheet, 1),
		asteroid: frame(sheet, 2),
		pickup: frame(sheet, 3),
	};
}

export function drawSprite(
	ctx: CanvasRenderingContext2D,
	sprite: SpriteFrame | null | undefined,
	size: number,
	angle = 0,
): boolean {
	if (!sprite?.image) return false;
	ctx.save();
	ctx.rotate(angle);
	ctx.drawImage(
		sprite.image,
		sprite.sx,
		sprite.sy,
		sprite.sw,
		sprite.sh,
		-size / 2,
		-size / 2,
		size,
		size,
	);
	ctx.restore();
	return true;
}
