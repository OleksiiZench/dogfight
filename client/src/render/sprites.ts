const FRAME = 128;
const SAMPLE_SIZE = 32;

export interface SpriteFrame {
	image: HTMLImageElement;
	sx: number;
	sy: number;
	sw: number;
	sh: number;
}

export interface Sprites {
	ship: SpriteFrame | null;
	bullet: SpriteFrame | null;
	asteroid: SpriteFrame | null;
	pickup: SpriteFrame | null;
}

function frame(image: HTMLImageElement, index: number): SpriteFrame {
	return { image, sx: index * FRAME, sy: 0, sw: FRAME, sh: FRAME };
}

function isFrameVisible(image: HTMLImageElement, sprite: SpriteFrame): boolean {
	if (typeof document === "undefined") return true;
	try {
		const canvas = document.createElement("canvas");
		canvas.width = SAMPLE_SIZE;
		canvas.height = SAMPLE_SIZE;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) return true;
		ctx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
		ctx.drawImage(
			image,
			sprite.sx,
			sprite.sy,
			sprite.sw,
			sprite.sh,
			0,
			0,
			SAMPLE_SIZE,
			SAMPLE_SIZE,
		);
		const pixels = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
		for (let i = 3; i < pixels.length; i += 4) {
			if ((pixels[i] ?? 0) > 8) return true;
		}
		return false;
	} catch {
		return true;
	}
}

export function createSprites(sheet: unknown): Sprites | null {
	if (!(sheet instanceof HTMLImageElement)) return null;
	const ship = frame(sheet, 0);
	const bullet = frame(sheet, 1);
	const asteroid = frame(sheet, 2);
	const pickup = frame(sheet, 3);
	return {
		ship: isFrameVisible(sheet, ship) ? ship : null,
		bullet: isFrameVisible(sheet, bullet) ? bullet : null,
		asteroid: isFrameVisible(sheet, asteroid) ? asteroid : null,
		pickup: isFrameVisible(sheet, pickup) ? pickup : null,
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
