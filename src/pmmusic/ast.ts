import { capS32, capU32, cdiv } from "./util"

export class ValidationError extends Error {}

function whole(num: number, name: string) {
	if (!Number.isInteger(num))
		throw new ValidationError(`invalid ${name} ${num}, must be an integer`)
}

export class PMMusic {
	includes: string[]
	title: string = ""
	composer: string = ""
	programmer: string = ""
	description: string = ""
	outFormat: string = ""
	varHeader: string = ""
	outHeader: string = ""
	outFile: string = ""
	masterTime: number = 260
	volLevelIsMML: boolean = true
	octaveReverse: boolean = false
	shortQuantize: boolean = false
	transcludeMacro: boolean = false

	bgm: {[key: string]: CommandSet}
	pattern: {[key: string]: CommandSet}
	sfx: {[key: string]: CommandSet}
	macro: {[key: string]: CommandSet}

	constructor () {
		this.includes = []
		this.bgm = {}
		this.pattern = {}
		this.sfx = {}
		this.macro = {}
	}
}


export abstract class Command {
	public abstract validate(): void
	public abstract toString(): string
}

export class CommandSet extends Command {
	commands: Command[]

	constructor (...cmds: Command[]) {
		super()
		this.commands = cmds
	}

	public push<T extends Command>(cmd: T): T {
		this.commands.push(cmd)
		return cmd
	}

	public validate() {}

	public toString(indent?: string): string {
		indent ??= ""
		const nindent = indent + "  "
		const pfx = this.commands.length ? "\n" + nindent : ""
		return indent + "CommandSet:" + pfx + this.commands.map(c => {
			if (c instanceof CommandSet)
				return c.toString(nindent)
			return c.toString()
		}).join("\n" + nindent)
	}
}

export class Loop extends CommandSet {
	repeats: number = 2

	public validate() {
		whole(this.repeats, "loop repeats")
		if (this.repeats < 0)
			throw new ValidationError("loop repeats must be 0 or more")
	}

	public toString(indent?: string): string {
		indent ??= ""
		const nindent = indent + "  "
		return indent + `Loop(${this.repeats}) [` + this.commands.map(c => {
			if (c instanceof CommandSet)
				return c.toString(nindent)
			return c.toString()
		}).join("\n" + nindent) + `\n${indent}]`
	}
}

export class JumpPattern extends Command {
	offset: number

	constructor (offset: number) {
		super()
		this.offset = offset
	}

	public validate() {}

	public toString(): string {
		return `JumpPattern ${this.offset}`
	}
}

export class PlayPattern extends Command {
	name: string

	constructor (name: string) {
		super()
		this.name = name
	}

	public validate(patterns?: SupportsIn) {
		if (patterns && !(this.name in patterns))
			throw new ValidationError(`pattern "${this.name}" is not defined`)
		if (!this.name)
			throw new ValidationError("nameless pattern")
	}

	public toString(): string {
		return `PlayPattern ${this.name}`
	}
}

export class PlayMacro extends Command {
	name: string

	constructor (name: string) {
		super()
		this.name = name
	}

	public validate(macros?: SupportsIn) {
		if (macros && !(this.name in macros))
			throw new ValidationError(`macro "${this.name}" is not defined`)
		if (!this.name)
			throw new ValidationError("nameless macro")
	}

	public toString(): string {
		return `MACRO ${this.name}`
	}
}

export class Row extends Command {
	note?: {note: Note, octave?: number}
	wait?: number
	volume?: number
	pulseWidth?: PulseWidth
	quant?: number
	sustain?: number
	ram?: {addr: number, data: number}
	effectTicks?: number
	effect?: {type: string, params: number[]}

	constructor(init?: Partial<Row>) {
		super()
		Object.assign(this, init)
	}

	public validate(v?: {
		minOctave: number, maxOctave: number,
		maxWait: number,
		maxWidth: number,
		maxQuant: number,
		maxSustain: number,
		minAddr?: number, maxAddr: number, dataBits: number,
		maxEffectTicks: number,
		validEffects?: SupportsIn,
	}) {
		if (this.note && (this.note.note < Note.rest || this.note.note > Note.Bs))
			throw new ValidationError(`invalid note ${this.note.note}`)
		if (this.wait !== undefined)
			new Wait(this.wait).validate(v?.maxWait)
		if (this.volume !== undefined)
			new Volume(this.volume).validate()
		if (this.pulseWidth !== undefined)
			this.pulseWidth.validate()
		if (this.quant !== undefined)
			new Quant(this.quant).validate(v?.maxQuant)
		if (this.sustain !== undefined)
			new Sustain(this.sustain).validate(v?.maxSustain)
		if (this.ram)
			new RAM(this.ram.addr, this.ram.data).validate(v)
		if (this.effectTicks !== undefined)
			new EffectTicks(this.effectTicks).validate(v?.maxEffectTicks)
		if (this.effect)
			new EffectStart(this.effect.type, this.effect.params).validate(v?.validEffects)
	}

	public toString(): string {
		const out: string[] = []
		if (this.wait !== undefined) out.push("w" + this.wait)
		if (this.volume !== undefined) out.push("v" + this.volume)
		if (this.pulseWidth !== undefined) out.push(this.pulseWidth.toString())
		if (this.quant !== undefined) out.push("q" + this.quant)
		if (this.sustain !== undefined) out.push("s" + this.sustain)
		if (this.ram)
			out.push(`!${hexify(this.ram.addr, 2)}:${hexify(this.ram.data, 2)}`)
		if (this.effectTicks !== undefined) out.push("xt" + this.effectTicks)
		if (this.effect) out.push("x" + this.effect.type + this.effect.params.join(":"))
		if (this.note) {
			let [n, o] = note2str(this.note.note, this.note.octave)
			n = n.toUpperCase().replace("+", "#")
			if (n.length == 1) n += "-"
			out.push(n + o)
		}
		return "ROW " + out.join(", ")
	}
}

export class End extends Command {
	public validate() {}

	public toString(): string {
		return "END"
	}
}

export class PlayNote extends Command {
	note: Note
	length?: number
	extend: number = 0

	constructor (note?: string) {
		super()
		this.note = note ? str2note(note.replace("#", "+").toUpperCase()) : Note.rest
	}

	public validate(maxLength?: number, maxExtend?: number) {
		if (this.note < Note.rest || this.note > Note.Bs)
			throw new ValidationError(`invalid note ${this.note}`)

		if (this.length !== undefined) {
			whole(this.length, "note length")
			if (maxLength && this.length > maxLength)
				throw new ValidationError(`invalid note length ${this.length}, must be between 1 and ${maxLength}`)
			if (this.length < 1)
				throw new ValidationError(`invalid note length ${this.length}, must be at least 1`)
		}

		whole(this.extend, "note length extension")
		if (maxExtend !== undefined && this.extend > maxExtend) {
			if (maxExtend)
				throw new ValidationError(`invalid note length extension, max is ${".".repeat(maxExtend)}`)
			throw new ValidationError("note length extension is not allowed")
		}
		if (this.extend < 0)
			throw new ValidationError(`invalid note length extension, cannot be negative`)
	}

	public toString(): string {
		let [out, _] = note2str(this.note)
		if (this.length !== undefined) out += this.length
		return out + ".".repeat(this.extend)
	}
}

export class Wait extends Command {
	ticks: number

	constructor (ticks?: number) {
		super()
		this.ticks = ticks ?? 24
	}

	public validate(maxWait?: number) {
		whole(this.ticks, "wait")
		if (maxWait && this.ticks > maxWait)
			throw new ValidationError(`invalid wait ${this.ticks}, must be between 1 and ${maxWait}`)
		if (this.ticks < 1)
			throw new ValidationError(`invalid wait ${this.ticks}, must be at least 1`)
	}

	public toString(): string {
		return "w" + this.ticks
	}
}

export class Volume extends Command {
	volume: number

	constructor (volume?: number) {
		super()
		this.volume = volume ?? 15
	}

	public validate() {
		whole(this.volume, "volume")
		if (this.volume < 0 || this.volume > 15)
			throw new ValidationError(`invalid volume ${this.volume}, must be between 1 and 15`)
	}

	public toString(): string {
		return "v" + this.volume
	}
}

export class PulseWidth extends Command {
	width: number
	percent: boolean

	constructor (width?: number, percent?: boolean) {
		super()
		this.width = width ?? 128
		this.percent = percent ?? false
	}

	public outOf(maxWidth: number) {
		if (this.percent)
			return Math.max(0, Math.min(maxWidth, Math.trunc(maxWidth * this.width / 100)))
		return this.width
	}

	public validate(maxWidth?: number) {
		whole(this.width, "pulse width")
		if (this.percent)
			if (this.width < 0 || this.width > 100)
				throw new ValidationError(`invalid pulse width ${this.width}, must be between 0% and 100%`)
		else if (maxWidth && this.width > maxWidth)
			throw new ValidationError(`invalid pulse width ${this.width}, must be between 1 and ${maxWidth}`)
		else if (this.width < 0)
			throw new ValidationError(`invalid pulse width ${this.width}, cannot be negative`)
	}

	public toString(): string {
		if (this.percent)
			return "/" + this.width
		return "%" + this.width
	}
}

export function hexify(n: number, len: number) {
	const h = n.toString(16)
	return "$" + "0".repeat(Math.max(0, len - h.length)) + h
}

export class RAM extends Command {
	addr: number
	data: number

	constructor (addr: number, data: number) {
		super()
		this.addr = addr
		this.data = data
	}

	public validate(v?: {minAddr?: number, maxAddr: number, dataBits: number}) {
		whole(this.addr, "RAM address")
		whole(this.data, "RAM data")
		if (v) {
			v.minAddr ??= 0
			if (this.addr < v.minAddr || this.addr > v.maxAddr)
				throw new ValidationError(`invalid RAM address ${hexify(this.addr, 4)}, must be between ${hexify(v.minAddr, 4)} and ${hexify(v.maxAddr, 4)}`)
			const mask = (1 << v.dataBits) - 1
			if (this.data != (this.data & mask))
				throw new ValidationError(`invalid RAM data ${hexify(this.data, Math.ceil(v.dataBits * 2 / 8))}, does not fit within ${v.dataBits} bits`)
		}
	}

	public toString(): string {
		return "!" + hexify(this.addr, 2) + ":" + hexify(this.data, 2)
	}
}

export class Length extends Command {
	length: number

	constructor (length?: number) {
		super()
		this.length = length ?? 4
	}

	public validate(maxLength?: number) {
		whole(this.length, "length")
		if (maxLength && this.length > maxLength)
			throw new ValidationError(`invalid length ${this.length}, must be between 1 and ${maxLength}`)
		if (this.length < 1)
			throw new ValidationError(`invalid length ${this.length}, must be at least 1`)
	}

	public toString(): string {
		return "l" + this.length
	}
}

export class StepOctave extends Command {
	up: boolean

	constructor (up: boolean) {
		super()
		this.up = up
	}

	public validate() {}

	public toString(): string {
		return this.up ? ">" : "<"
	}
}

export class Octave extends Command {
	octave: number

	constructor (octave?: number) {
		super()
		this.octave = octave ?? 4
	}

	public validate(minOctave?: number, maxOctave?: number) {
		whole(this.octave, "octave")
		if (minOctave !== undefined && this.octave < minOctave)
			throw new ValidationError(`invalid octave ${this.octave}, must be at least ${minOctave}`)
		if (maxOctave !== undefined && this.octave > maxOctave)
			throw new ValidationError(`invalid octave ${this.octave}, must be no more than ${maxOctave}`)
	}

	public toString(): string {
		return "o" + this.octave
	}
}

export class Quant extends Command {
	quant: number

	constructor (quant?: number) {
		super()
		this.quant = quant ?? 64
	}

	public validate(maxQuant?: number) {
		whole(this.quant, "quant")
		if (maxQuant && this.quant > maxQuant)
			throw new ValidationError(`invalid quant ${this.quant}, must be between 1 and ${maxQuant}`)
		if (this.quant < 1)
			throw new ValidationError(`invalid quant ${this.quant}, must be at least 1`)
	}

	public toString(): string {
		return "q" + this.quant
	}
}

export class Sustain extends Command {
	sustain: number

	constructor (sustain?: number) {
		super()
		this.sustain = sustain ?? 64
	}

	public validate(maxSustain?: number) {
		whole(this.sustain, "sustain")
		if (maxSustain && this.sustain > maxSustain)
			throw new ValidationError(`invalid sustain ${this.sustain}, must be between 1 and ${maxSustain}`)
		if (this.sustain < 1)
			throw new ValidationError(`invalid sustain ${this.sustain}, must be at least 1`)
	}

	public toString(): string {
		return "s" + this.sustain
	}
}

export class EffectTicks extends Command {
	ticks: number

	constructor (ticks?: number) {
		super()
		this.ticks = ticks ?? 1
	}

	public validate(maxTicks?: number) {
		whole(this.ticks, "effect ticks")
		if (maxTicks && this.ticks > maxTicks)
			throw new ValidationError(`invalid effect ticks ${this.ticks}, must be between 1 and ${maxTicks}`)
		if (this.ticks < 1)
			throw new ValidationError(`invalid effect ticks ${this.ticks}, must be at least 1`)
	}

	public toString(): string {
		return "xt" + this.ticks
	}
}

export class EffectStart extends Command {
	effect: string
	params: number[]

	constructor (effect: string, params?: number[]) {
		super()
		this.effect = effect
		this.params = params ?? []
	}

	public validate(effects?: SupportsIn) {
		if (effects && !(this.effect in effects))
			throw new ValidationError(`effect "${this.effect}" is not supported`)
		if (!this.effect)
			throw new ValidationError("nameless effect")
		for (let i = 0; i < this.params.length; ++i) {
			whole(this.params[i], `effect param ${i}`)
		}
	}

	public toString(): string {
		return "x" + this.effect + this.params.join(":")
	}
}

export enum Note {
	rest = -2,
	Cb = -1,  // prev octave's B
	C, Cs,
	D, Ds,
	E,
	F, Fs,
	G, Gs,
	A, As,
	B, Bs  // next octave's C
}

const _str2note = {
	"R": Note.rest,
	"C-": Note.Cb,
	"C": Note.C,
	"C+": Note.Cs, "D-": Note.Cs,
	"D": Note.D,
	"D+": Note.Ds, "E-": Note.Ds,
	"E": Note.E, "F-": Note.E,
	"F": Note.F, "E+": Note.F,
	"F+": Note.Fs, "G-": Note.Fs,
	"G": Note.G,
	"G+": Note.Gs, "A-": Note.Gs,
	"A": Note.A,
	"A+": Note.As, "B-": Note.As,
	"B": Note.B, "B+": Note.Bs,
}

const _note2str = {
	[Note.Cb]: "C-",
	[Note.C]:  "C",
	[Note.Cs]: "C+",
	[Note.D]:  "D",
	[Note.Ds]: "D+",
	[Note.E]:  "E",
	[Note.F]:  "F",
	[Note.Fs]: "F+",
	[Note.G]:  "G",
	[Note.Gs]: "G+",
	[Note.A]:  "A",
	[Note.As]: "A+",
	[Note.B]:  "B",
	[Note.Bs]: "B+",
}

const _note2str2 = {
	[Note.Cb]: "C-",
	[Note.C]:  "C",
	[Note.Cs]: "D-",
	[Note.D]:  "D",
	[Note.Ds]: "E-",
	[Note.E]:  "E",
	[Note.F]:  "F",
	[Note.Fs]: "G-",
	[Note.G]:  "G",
	[Note.Gs]: "A-",
	[Note.A]:  "A",
	[Note.As]: "B-",
	[Note.B]:  "B",
	[Note.Bs]: "B+",
}

export function str2note(s: string) {
	return _str2note[s as keyof typeof _str2note]
}

export function note2str(n: Note, octave?: number): [string, string] {
	if (n == Note.rest) return ["r", ""]
	if (octave !== undefined) {
		if (n == Note.Cb) return ["b", (octave-1).toString()]
		if (n == Note.Bs) return ["c", (octave+1).toString()]
	}
	return [_note2str[n], (octave ?? "").toString()]
}

export function note2flat(n: Note, octave?: number): [string, string] {
	if (n == Note.rest) return ["r", ""]
	if (octave !== undefined) {
		if (n == Note.Cb) return ["b", (octave-1).toString()]
		if (n == Note.Bs) return ["c", (octave+1).toString()]
	}
	return [_note2str2[n], (octave ?? "").toString()]
}

interface SupportsIn {
	[key: string]: any;
}
