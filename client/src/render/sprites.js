const FRAME = 128;

function frame(image, index) {
	return { image, sx: index * FRAME, sy: 0, sw: FRAME, sh: FRAME };
}

export function createSprites(sheet) {
	if (!sheet) return null;
	return {
		ship: frame(sheet, 0),
		bullet: frame(sheet, 1),
		asteroid: frame(sheet, 2),
		pickup: frame(sheet, 3),
	};
}

export function drawSprite(ctx, sprite, size, angle = 0) {
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
