export function capU32(n: number) {
	const add = n & 0x80000000 ? 0x80000000 : 0
	return (n & 0x7fffffff) + add
}

export class EmptyError extends Error {

}

export function undefinedThrowsEmpty(f: ()=>(number|undefined)) {
	return () => {
		const res = f()
		if (typeof res === "undefined")
			throw new EmptyError()
		return res
	}
}
