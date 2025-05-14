// Compiler for the PMMusic sound engine
import * as ast from "./ast"
import { capS32, capU32, cdiv } from "./util"
import { LIB_VERSION } from "../version"

export class CompilerError extends Error {}

export const FLAG_VOL      = 0b00000001
export const FLAG_WRITERAM = 0b00000010
export const FLAG_PRESET   = 0b00000100
export const FLAG_PIVOT    = 0b00001000
export const FLAG_END      = 0b00010000
export const FLAG_PATTERN  = 0b00100000
export const FLAG_MARK     = 0b01000000
export const FLAG_LOOP     = 0b10000000

const EFFECT_DISABLED = "d".charCodeAt(0)
const EFFECT_ARPEGGIO = "a".charCodeAt(0)
const EFFECT_PORTAMENTO = "p".charCodeAt(0)
const EFFECT_RANDOM = "r".charCodeAt(0)

export class PMMusicCommand {
	flags: number = 0    // Flags
	wait: number = 0     // Wait (0 = immediate)
	volume: number = 0   // Volume (0 to 3)
	ramAddr: number = 0  // RAM address (0 to 255)
	ramData: number = 0  // RAM data (0 to 255)
	preset: number = 0   // Preset
	pivot: number = 0    // Pivot
	pattern: number = 0  // Pattern offset
	loopID: number = 0   // Loop ID (0 to 3)
	loopNum: number = 0  // Number of loops (0 to 255)

	constructor(init?: Partial<PMMusicCommand>) {
		Object.assign(this, init)
	}

	public toU16Array() {
		let idx = 1
		const data = new Uint16Array(8)
		data[0] = this.wait & 0xff
		if (this.flags & FLAG_VOL)
			data[0] |= 0x0400 + ((this.volume & 3) << 8)
		else
			data[0] |= 0x0300

		if (this.flags & FLAG_WRITERAM) {
			data[0] |= 0x0800
			data[idx++] = (this.ramAddr << 8) | this.ramData
		}

		if (this.flags & FLAG_PRESET) {
			data[0] |= 0x1000
			data[idx++] = this.preset
		}

		if (this.flags & FLAG_PIVOT) {
			data[0] |= 0x2000
			data[idx++] = this.pivot
		}

		if (this.flags & FLAG_END) {
			data[0] &= 0xFC00
			data[0] |= 0x4401
			data[idx++] = 0x0000
		}
		else if (this.flags & FLAG_PATTERN) {
			data[0] |= 0x4000
			data[idx++] = this.pattern * 4
		}

		if (this.flags & FLAG_MARK) {
			data[0] |= 0x8000
			data[idx++] = this.loopID << 10
		}
		else if ((this.flags & FLAG_LOOP) && this.loopNum) {
			data[0] |= 0x8000
			data[idx++] = (this.loopID << 10) | (this.loopNum & 255)
		}

		return data.slice(0, idx)
	}
}

interface CompileOptions {
	bgm?: string|string[],
	pattern?: string|string[],
	sfx?: string|string[],
}

export function compile(base: ast.PMMusic, opts?: CompileOptions) {
	opts ??= {}

	opts.bgm = normStringOpt(opts.bgm)
	opts.pattern = normStringOpt(opts.pattern)
	opts.sfx = normStringOpt(opts.sfx)

	const compiler = new Compiler(base)
	const out = new CompileReturn(base)

	for (let b of opts.bgm) {
		if (!(b in base.bgm))
			throw new CompilerError(`no BGM ${b}`)
		const bgm = base.bgm[b]
		if (compiler.compile(bgm).length)
			throw new CompilerError("weird BGM")
		out.bgm[b] = bgm.commands.map((p) => (p as ast.PlayPattern).name)
	}

	// Add patterns used by requested BGMs
	opts.pattern.push(...Object.keys(compiler.pats))

	for (let p of opts.pattern) {
		if (!(p in base.pattern))
			throw new CompilerError(`no pattern ${p}`)
		if (!(p in compiler.pats))
			compiler.pats[p] = compiler.compile(base.pattern[p])
		out.pattern[p] = compiler.pats[p]
	}

	for (let s of opts.sfx) {
		if (!(s in base.sfx))
			throw new CompilerError(`no sfx ${s}`)
		out.sfx[s] = compiler.compile(base.sfx[s])
	}

	return out
}

export class CompileReturn {
	base: ast.PMMusic
	bgm: {[key: string]: string[]}
	pattern: {[key: string]: PMMusicCommand[]}
	sfx: {[key: string]: PMMusicCommand[]}

	constructor (base: ast.PMMusic) {
		this.base = base
		this.bgm = {}
		this.pattern = {}
		this.sfx = {}
	}

	public bgmCommands(bgm: string) {
		return (this.bgm[bgm] ?? []).map(p => this.pattern[p] ?? [])
	}

	public toPMAS() {
		let out = (
			`; Music exported with PMSound-JS v${LIB_VERSION}\n`
			+"; Data file\n"
			+";\n"
		)
		if (this.base.title)
			out += `; Title: ${this.base.title}\n`
		if (this.base.composer)
			out += `; Composer: ${this.base.composer}\n`
		if (this.base.programmer)
			out += `; Programmer: ${this.base.programmer}\n`
		if (this.base.description)
			out += `; Description: ${this.base.description}\n`
		out += `; Master time: ${ast.hexify(this.base.masterTime, 4)}, (${this.base.masterTime})`
		out += "\n\n\t.align 2\n\n"

		function pad(n: number) {
			const sn = n.toString()
			return " ".repeat(Math.max(0, 3 - sn.length)) + sn
		}

		function writeArray(cmds: PMMusicCommand[]) {
			let n = 0, ret = ""
			for (const cmd of cmds) {
				for (const c of cmd.toU16Array()) {
					if ((n++ % 8) == 0)
						ret += "\n\t.dw " + ast.hexify(c, 4)
					else
					ret += "," + ast.hexify(c, 4)
				}
			}
			return ret
		}

		const numPat = Object.keys(this.pattern).length
		const numSFX = Object.keys(this.sfx).length
		const numBGM = Object.keys(this.bgm).length

		out += `;\n; ${pad(numPat)} Pattern(s)\n;\n`
		for (const name of Object.keys(this.pattern)) {
			const pat = this.pattern[name]
			out += `\n${name}:${writeArray(pat)}\n`
		}

		out += `;\n; ${pad(numSFX)} SFX\n;\n`
		for (const name of Object.keys(this.sfx)) {
			const sfx = this.sfx[name]
			out += `\n${name}:${writeArray(sfx)}\n`
		}

		out += `;\n; ${pad(numBGM)} BGM\n;\n`
		for (const name of Object.keys(this.bgm)) {
			const bgm = this.bgm[name]
			out += `\n${name}:`
			for (const patName of bgm) {
				out += `\n\t.dd ${patName}`
			}
			out += "\n"
		}

		return out
	}
}

interface CompilerContext {
	wait: number,
	note: number,
	note2: number,
	note3: number,
	ramaddr: number,
	ramdata: number,
	length: number,
	octave: number,
	volume: number,
	pulse: number,
	quantize: number,
	arpptr: number,
	efftype: number,
	efftick: number,
	sustain: number,
}

const defaultCompilerContext: CompilerContext = {
	wait: 24,
	note: -1,
	note2: -1,
	note3: -1,
	ramaddr: -1,
	ramdata: -1,
	length: 4,
	octave: 4,
	volume: 3,
	pulse: 128,
	quantize: 64,
	arpptr: 0,
	efftype: 0,
	efftick: 1,
	sustain: 64,
}

class Compiler {
	base: ast.PMMusic
	pats: {[key: string]: PMMusicCommand[]}
	macros: {[key: string]: PMMusicCommand[]}

	constructor (base: ast.PMMusic) {
		this.base = base
		this.pats = {}
		this.macros = {}
	}

	public compile(cmdset: ast.CommandSet, loopID?: number, ctx?: CompilerContext) {
		loopID ??= -1
		if (loopID == 3)
			throw new CompilerError("number of loops exceeded")
		ctx ??= {...defaultCompilerContext}

		const cmds: PMMusicCommand[] = []
		if (cmdset instanceof ast.Loop) {
			if (loopID < 0) loopID = 0;
			if (cmdset.repeats == 0)
				return cmds
			if (cmdset.repeats > 1)
				cmds.push(new PMMusicCommand({
					wait: 0,
					flags: FLAG_MARK,
					loopID: loopID
				}))
		}

		for (let cmd of cmdset.commands) {
			if (cmd instanceof ast.Loop) {
				cmd.validate()
				cmds.push(...this.compile(cmd, loopID + 1, ctx))
			}
			else if (cmd instanceof ast.Row) {
				cmd.validate({
					minOctave: 1, maxOctave: 9,
					maxWait: 255,
					maxWidth: 255,
					maxQuant: 64,
					maxSustain: 64,
					maxAddr: 255,
					dataBits: 8,
					maxEffectTicks: 128,
				})
				let note: ast.Note = ast.Note.rest
				if (cmd.note) {
					note = cmd.note.note
					if (cmd.note.octave)
						ctx.octave = cmd.note.octave
				}
				if (cmd.wait !== undefined)
					ctx.wait = cmd.wait
				if (cmd.volume !== undefined)
					ctx.volume = this._mapVolume(cmd.volume)
				if (cmd.pulseWidth !== undefined)
					ctx.pulse = cmd.pulseWidth.outOf(255)
				if (cmd.quant !== undefined)
					ctx.quantize = cmd.quant
				if (cmd.sustain !== undefined)
					ctx.sustain = cmd.sustain
				if (cmd.ram !== undefined) {
					ctx.ramaddr = cmd.ram.addr
					ctx.ramdata = cmd.ram.data
				}
				if (cmd.effectTicks !== undefined)
					ctx.efftick = cmd.effectTicks
				if (cmd.effect !== undefined) {
					this._effect(cmd.effect.type, cmd.effect.params, ctx)
				}

				if (note === ast.Note.rest)
					this._quant_sustain(cmds, ctx.wait, -1, -1, -1, ctx)
				else {
					let note1 = this._getnotefreq(note, ctx.octave)
					let note2 = this._getnotefreq(note + ctx.note2, ctx.octave)
					let note3 = this._getnotefreq(note + ctx.note3, ctx.octave)
					this._quant_sustain(cmds, ctx.wait, note1, note2, note3, ctx)
				}
			}
			else if (cmd instanceof ast.PlayNote) {
				cmd.validate(64, 4)
				const length = this._getLength(cmd, ctx.length)
				if (length > 0) {
					if (cmd.note === ast.Note.rest) {
						cmds.push(new PMMusicCommand({
							wait: Math.trunc(ctx.wait / length) || 1,
							flags: FLAG_VOL,
							volume: 0,
						}))
						continue
					}
					let note = this._getnotefreq(cmd.note, ctx.octave)
					let note2 = this._getnotefreq(cmd.note + ctx.note2, ctx.octave)
					let note3 = this._getnotefreq(cmd.note + ctx.note3, ctx.octave)
					this._quant_sustain(cmds, Math.trunc(ctx.wait / length), note, note2, note3, ctx)
				}
			}
			else if (cmd instanceof ast.Wait) {
				cmd.validate(255)
				ctx.wait = cmd.ticks
			}
			else if (cmd instanceof ast.Volume) {
				cmd.validate()
				ctx.volume = this._mapVolume(cmd.volume)
			}
			else if (cmd instanceof ast.PulseWidth) {
				cmd.validate(255)
				ctx.pulse = cmd.outOf(255)
			}
			else if (cmd instanceof ast.RAM) {
				cmd.validate({maxAddr: 255, dataBits: 8})
				ctx.ramaddr = cmd.addr
				ctx.ramdata = cmd.data
			}
			else if (cmd instanceof ast.Length) {
				cmd.validate(64)
				ctx.length = cmd.length
			}
			else if (cmd instanceof ast.StepOctave) {
				cmd.validate()
				if (cmd.up)
					ctx.octave = Math.min(9, ctx.octave + 1)
				else
					ctx.octave = Math.max(1, ctx.octave - 1)
			}
			else if (cmd instanceof ast.Octave) {
				cmd.validate(1, 9)
				ctx.octave = cmd.octave
			}
			else if (cmd instanceof ast.Quant) {
				cmd.validate(64)
				ctx.quantize = cmd.quant
			}
			else if (cmd instanceof ast.Sustain) {
				cmd.validate(64)
				ctx.sustain = cmd.sustain
			}
			else if (cmd instanceof ast.EffectTicks) {
				cmd.validate(128)
				ctx.efftick = cmd.ticks
			}
			else if (cmd instanceof ast.EffectStart) {
				cmd.validate()
				this._effect(cmd.effect, cmd.params, ctx)
			}
			else if (cmd instanceof ast.PlayMacro) {
				cmd.validate(this.base.macro)
				if (!this.base.transcludeMacro && cmd.name in this.macros) {
					cmds.push(...this.macros[cmd.name])
					continue
				}
				const macro = this.base.macro[cmd.name]
				const c = this.base.transcludeMacro ? ctx : undefined
				const res = this.compile(macro, loopID, c)
				cmds.push(...res)
				if (!this.base.transcludeMacro) {
					this.macros[cmd.name] = res
				}
			}
			else if (cmd instanceof ast.PlayPattern) {
				if (cmds.length)
					throw new CompilerError("unexpected PlayPattern")
				cmd.validate(this.base.pattern)
				if (!(cmd.name in this.pats)) {
					const pat = this.base.pattern[cmd.name]
					const finalCommand = pat.commands[pat.commands.length-1]
					if (!(finalCommand instanceof ast.End || finalCommand instanceof ast.JumpPattern)) {
						// Play next pattern (we assume this is part of a BGM)
						pat.push(new ast.JumpPattern(1))
					}
					this.pats[cmd.name] = this.compile(pat, loopID, {...defaultCompilerContext})
				}
			}
			else if (cmd instanceof ast.JumpPattern) {
				// BGM infinite loop or "next pattern"
				cmds.push(new PMMusicCommand({
					wait: 0,
					flags: FLAG_PATTERN,
					pattern: cmd.offset,
				}))
			}
			else if (cmd instanceof ast.End) {
				cmds.push(new PMMusicCommand({
					wait: 1,
					flags: FLAG_VOL | FLAG_END,
					volume: 0,
				}))
			}
			else if (cmd instanceof ast.CommandSet) {
				throw new CompilerError("unexpected CommandSet")
			}
		}

		if (cmdset instanceof ast.Loop && cmdset.repeats > 1) {
			cmds.push(new PMMusicCommand({
				wait: 0,
				flags: FLAG_LOOP,
				loopID: loopID,
				loopNum: cmdset.repeats - 1
			}))
		}

		return cmds
	}

	private _effect(effect: string, params: number[], ctx: CompilerContext) {
		switch (effect) {
			case "d": // Disable
				if (params.length)
					throw new ast.ValidationError("xd expects no arguments")
				break
			case "A": // Set arpptr
				if (params.length > 1)
					throw new ast.ValidationError("xA expects 1 argument")
				ctx.arpptr = (params[0] ?? 0) % 3
				if (ctx.arpptr < 0) ctx.arpptr += 3
				break
			case "a": // Arpeggio
				if (params.length > 2)
					throw new ast.ValidationError("xa expects 2 arguments")
				ctx.note2 = params[0] ?? 0
				ctx.note3 = params[1] ?? 0
				break
			case "p": // Portamento
				if (params.length > 1)
					throw new ast.ValidationError("xp expects 1 argument")
				ctx.note2 = params[0] ?? 0
				break
			case "r": // Random between
				if (params.length > 1)
					throw new ast.ValidationError("xr expects 1 argument")
				ctx.note2 = params[0] ?? 0
				break
			case "s": // Random seed
				if (params.length > 1)
					throw new ast.ValidationError("xs expects 1 argument")
				this.srand(params[0] ?? 1)
				return  // don't set efftype
			default:
				throw new ast.ValidationError(`effect "${effect}" is not supported`)
		}
		ctx.efftype = effect.charCodeAt(0)
	}

	private _getnotefreq(note: number, octave: number) {
		const num = (octave - 1) * 12 + (note - 12)
		if (num < 0 || num > 7 * 12) return 0xffff
		return [
			0xEEE3, 0xE17A, 0xD4D2, 0xC8E0, 0xBD9A, 0xB2F6, 0xA8EA, 0x9F6F, 0x967C, 0x8E0A, 0x8611, 0x7E8B,
			0x7771, 0x70BC, 0x6A68, 0x646F, 0x5ECC, 0x597A, 0x5474, 0x4FB7, 0x4B3D, 0x4704, 0x4308, 0x3F45,
			0x3BB8, 0x385D, 0x3533, 0x3237, 0x2F65, 0x2CBC, 0x2A39, 0x27DB, 0x259E, 0x2381, 0x2183, 0x1FA2,
			0x1DDB, 0x1C2E, 0x1A99, 0x191B, 0x17B2, 0x165D, 0x151C, 0x13ED, 0x12CE, 0x11C0, 0x10C1, 0x0FD0,
			0x0EED, 0x0E16, 0x0D4C, 0x0C8D, 0x0BD8, 0x0B2E, 0x0A8D, 0x09F6, 0x0966, 0x08DF, 0x0860, 0x07E7,
			0x0776, 0x070A, 0x06A5, 0x0646, 0x05EB, 0x0596, 0x0546, 0x04FA, 0x04B2, 0x046F, 0x042F, 0x03F3,
			0x03BA, 0x0384, 0x0352, 0x0322, 0x02F5, 0x02CA, 0x02A2, 0x027C, 0x0258, 0x0237, 0x0217, 0x01F9
		][num]
	}

	private _quant_sustain(cmds: PMMusicCommand[], wait: number, note: number, note2: number, note3: number, ctx: CompilerContext) {
		if (wait <= 0) wait = 1
		let waiton = Math.trunc((wait * ctx.quantize) / 64)
		let waitoff = wait - waiton
		if (waiton) {
			let waitsus = Math.trunc((waiton * ctx.sustain) / 64)
			let waitrel = waiton - waitsus
			if (waitsus)
				this._make_note(cmds, waitsus, 0, waiton, note, note2, note3, ctx.volume, ctx)
			if (waitrel)
				this._make_note(cmds, waitrel, waitsus, waiton, note, note2, note3, ctx.volume - 1, ctx)
		}
		if (waitoff)
			this._make_note(cmds, waitoff, 0, waitoff, note, note2, note3, 0, ctx)
	}

	private _make_note(cmds: PMMusicCommand[], wait: number, portoff: number, porttot: number, preset: number, preset2: number, preset3: number, volume: number, ctx: CompilerContext) {
		if (wait <= 0) wait = 1
		while (wait > 0) {
			const cmd = new PMMusicCommand()

			// Wait (changed to efftick if effect is valid)
			cmd.wait = wait > 0xff ? 0xff : wait

			// Flags
			cmd.flags = FLAG_VOL
			if (preset >= 0)
				cmd.flags |= FLAG_PRESET | FLAG_PIVOT
			if (ctx.ramaddr >= 0)
				cmd.flags |= FLAG_WRITERAM

			// Effects
			switch (ctx.efftype) {
				case EFFECT_ARPEGGIO:
					cmd.preset = [preset, preset2, preset3][ctx.arpptr]
					if (volume) cmd.wait = ctx.efftick
					break
				case EFFECT_PORTAMENTO:
					const posfx = capS32(cdiv(capS32(portoff * 0x8000), porttot))
					cmd.preset = capS32((0x8000-posfx) * preset + posfx * preset2) >> 15
					if (volume) cmd.wait = ctx.efftick
					break
				case EFFECT_RANDOM:
					const posfxr = this.rand()
					cmd.preset = capS32((0x8000-posfxr) * preset + posfxr * preset2) >> 15
					if (volume) cmd.wait = ctx.efftick
					break
				default:
					cmd.preset = preset
					break
			}

			// Setup and send command
			cmd.pivot = cdiv(capS32(cmd.preset * ctx.pulse), 0x100) & 0xffff
			cmd.volume = Math.max(0, Math.min(3, volume))
			cmd.ramAddr = ctx.ramaddr
			cmd.ramData = ctx.ramdata
			cmds.push(cmd)
			wait -= cmd.wait
			portoff += cmd.wait
			ctx.ramaddr = ctx.ramdata = -1
			ctx.arpptr = (ctx.arpptr + 1) % 3
		}
	}

	private _mapVolume(volume: number) {
		if (volume > 8) return  3
		else if (volume > 4) return 2
		else if (volume > 2) return  1
		return 0
	}

	private _getLength(note: ast.PlayNote, l: number) {
		if (note.length !== undefined) l = note.length
		if (!note.extend) return l
		return l / [1.0, 1.5, 1.75, 1.875, 1.9375][note.extend]
	}

	// MSVC style Linear Congruential Generator
	// https://web.archive.org/web/20150328225106/http://research.microsoft.com/en-us/um/redmond/projects/invisible/src/crt/rand.c.htm
	private nextrand: number = 1

	public srand(seed: number) {
		this.nextrand = capU32(seed)
	}

	public rand() {
		this.nextrand = capU32(this.nextrand * 1103515245 + 12345)
		return (this.nextrand >> 16) & 0x7fff
	}
}

function normStringOpt(s?: string|string[]) {
	if (s === undefined) return []
	if (typeof s === "string") return [s]
	return s
}
