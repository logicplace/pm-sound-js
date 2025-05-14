export function capU32(n: number) {
	const add = Math.trunc(n) & 0x80000000 ? 0x80000000 : 0
	return (n & 0x7fffffff) + add
}

export function capS32(n: number) {
	return Math.trunc(n) | 0
}

export function cdiv(x: number, y: number) {
	return (
		(x < 0) != (y < 0)
		? Math.ceil(x / y)
		: Math.floor(x / y)
	)
}
