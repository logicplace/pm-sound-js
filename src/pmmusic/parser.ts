import * as ast from "./ast";
import { capS32, cdiv } from "./util";

const CNAME = "[_a-zA-Z]\\w*"
const SYN_CNAME = new RegExp(CNAME)
const COMMENT = "//.*|/\\*[\\s\\S]*?\\*/"
const _NUM = "(?:(?:0x|\\$)(-?[\\da-fA-F]+)|(-?\\d+))"
const SYN_NUM = new RegExp(_NUM)
const SYN_NUM1 = /(?:(-?)[#$]([\da-fA-F]+)|(-?\d+))/
const NUM = "[ \\t]*" + _NUM
const STRING = "(?:[^/{}\\n]+|/(?![/*]))+"

const SYN_MAIN = new RegExp(
	// Ignore comments
	COMMENT
	// Directive, 1: name, 2: args
	+`|(${CNAME})(?:[ \\t]+(${STRING}))?`
	// Body, 3: start, 4: end
	+`|({)|(})`
	// Ignore extra spaces
	+"|\\s+"
, "y")

const SYN_PATTERN_LIST = new RegExp(
	// Ignore comments
	COMMENT
	// Pattern name, 1: name
	+`|(${CNAME})(?=[ \\t;}]|$|//|/\*)`
	// Loop mark, 2: mark
	+"|(\\|)"
	// Ignore separators
	+`|[\\s;]+`
, "y")

const SYN_TRACK = new RegExp(
	// Ignore comments
	COMMENT
	// 1: command, 2: args
	+`|(${CNAME})(?:[ \\t]+(${STRING}))?`
	// Ignore separators
	+"|[\\s,;]+"
, "y")

const SYN_MML = new RegExp(
	// Ignore comments
	COMMENT
	// Loop, 1: start, 2: end, 3~4: repeats
	+`|(\\[)|(\\])${NUM}?`
	// Play note, 5: note, 6~7: length, 8: length extension
	+`|([a-g][-+#]?)${NUM}?(\\.{0,4})`
	// Rest, 9: note, 10~11: length, 12: length extension
	+`|(r)${NUM}?(\\.{0,4})`
	// Single number cmds, 13: command, 14~15: arg
	+`|([%\\\\/vwloqs])${NUM}`
	// Double number cmds, 16: commands, 17~18: arg1, 19~20: arg2
	+`|(!)${NUM}:${NUM}`
	// No arg cmds, 21: cmd
	+"|([<>A-Z;])"
	// Effects, 22: cmd, 23: args
	+`|x(\\w)(${NUM}(?::${NUM})*)?`
	// Ignore separators
	+"|\\s+"
, "y")

const SPLIT_PAT_SUB = /,|;/
const SYN_PAT_SUB_NOTE = new RegExp(`^([A-G])(?:[-_ ]|([+#]))?(${NUM})`, "i")
const SYN_UNTIL_END = /([^}]*)}/y

export class ParseError extends Error {}
function expected(type: string, ctx: ErrContext) {
	return new ParseError(`expected ${type} at ${lineChar(ctx)}`)
}

function unexpected(ctx: ErrContext) {
	return new ParseError(`unexpected character "${ctx.text[ctx.position]}" at ${lineChar(ctx)}`)
}

class ErrContext {
	text: string
	position: number

	constructor (text: string, position: number) {
		this.text = text
		this.position = position
	}

	public add(n: number) {
		return new ErrContext(this.text, this.position + n)
	}
}

enum Open {
	None = 0,
	BGM,
	PATTERN,
	SFX,
	MACRO,
	DESCRIPTION
}

export function parse(text: string, textFetcher?: (fn:string)=>string, _out?: ast.PMMusic) {
	text += "\n"
	const out = _out ?? new ast.PMMusic()
	let open = Open.None, name = "", body = ""
	let opener: undefined|((s:string, n:number, e:RegExp, o:ast.PMMusic)=>[ast.CommandSet, number])

	// copy for thread safety
	const syn_main = new RegExp(SYN_MAIN)
	while (syn_main.lastIndex < text.length) {
		const last = syn_main.lastIndex
		const res = syn_main.exec(text)
		const errCtx = new ErrContext(text, last)
		if (!res)
			throw unexpected(errCtx)
		const [_, dirName, _dirArgs, bodyStart, bodyEnd] = res;
		const dirArgs = _dirArgs ?? ""
		if (dirName) {
			const errArgCtx = errCtx.add(dirName.length + 1)
			switch (dirName.toUpperCase()) {
				case "INCLUDE":
					if (!textFetcher)
						throw new ParseError("INCLUDE not supported")
					const filename = dirArgs.trim()
					if (out.includes.includes(filename))
						throw new ParseError(`recurse INCLUDE "${filename}" at ${lineChar(errCtx)}`)
					parse(textFetcher(filename), textFetcher, out)
					break
				case "TITLE":
					out.title = dirArgs.trim()
					break
				case "COMPOSER":
					out.composer = dirArgs.trim()
					break
				case "PROGRAMMER":
					out.programmer = dirArgs.trim()
					break
				case "DESCRIPTION":
					open = Open.DESCRIPTION
					out.description = dirArgs.trim()
					break
				case "OUTFORMAT":
					out.outFormat = dirArgs.trim()
					break
				case "VARHEADER":
					out.varHeader = dirArgs.trim()
					break
				case "OUTHEADER":
					out.outHeader = dirArgs.trim()
					break
				case "OUTFILE":
					out.outFile = dirArgs.trim()
					break
				case "MASTERTIME": case "MTIME":
					out.masterTime = parseNum1(dirArgs.trim())
					if (isNaN(out.masterTime)) throw expected("number", errArgCtx)
					break
				case "MASTERBPM": case "MBPM":
					const args = dirArgs.split(",")
					if (args.length != 2)
						throw new ParseError("MASTERBPM expects two arguments")
					const bpm = parseFloat(args[0].trim())
					if (isNaN(bpm)) throw expected("float", errArgCtx)
					const wait = parseNum1(args[1].trim())
					if (isNaN(wait)) throw expected("number", errArgCtx.add(args[0].length + 1))
					if (bpm <= 0.0)
						throw new ParseError("invalid BPM value to MASTERBPM, must be > 0")
					if (wait < 0 || wait > 255)
						throw new ParseError("invalid wait value to MASTERBPM, must be between 0 and 255")
					out.masterTime = capS32(cdiv(3905.25, bpm / 960.0 * wait)) - 1
					break
				case "VOLLEVEL": case "VOLLVL":
					switch (dirArgs.trim().toLowerCase()) {
						case "mml": case "16":
							out.volLevelIsMML = true
							break
						case "system": case "4":
							out.volLevelIsMML = false
							break
						default:
							throw new ParseError(`invalid VOLLEVEL, must be mml or system, got "${dirArgs.trim()}"`)
					}
					break
				case "OCTAVEREV": case "OCTREV":
					const rev = parseBool(dirArgs)
					if (rev === undefined) throw expected("boolean", errArgCtx)
					out.octaveReverse = rev
					break
				case "SHORTQUANTIZE": case "SHORTQ":
					const sq = parseBool(dirArgs)
					if (sq === undefined) throw expected("boolean", errArgCtx)
					out.shortQuantize = sq
					break
				case "TRANSCLUDEMACRO": case "TMACRO":
					const tm = parseBool(dirArgs)
					if (tm === undefined) throw expected("boolean", errArgCtx)
					out.transcludeMacro = tm
					break
				case "BGM":
					open = Open.BGM
					opener = parseBGM
					;[name, body] = getNameMaybeBody(dirArgs)
					break
				case "PATTERN_TRACK": case "PATTERN_T":
				case "PAT_TRACK": case "PAT_T":
					open = Open.PATTERN
					opener = parseTrack
					;[name, body] = getNameMaybeBody(dirArgs)
					break
				case "SFX_TRACK": case "SFX_T":
					open = Open.SFX
					opener = parseTrack
					;[name, body] = getNameMaybeBody(dirArgs)
					break
				case "MACRO_TRACK": case "MACRO_T":
					open = Open.MACRO
					opener = parseTrack
					;[name, body] = getNameMaybeBody(dirArgs)
					break
				case "PATTERN": case "PAT":
					open = Open.PATTERN
					opener = parseMML
					;[name, body] = getNameMaybeBody(dirArgs)
					break
				case "SFX":
					open = Open.SFX
					opener = parseMML
					;[name, body] = getNameMaybeBody(dirArgs)
					break
				case "MACRO":
					open = Open.MACRO
					opener = parseMML
					;[name, body] = getNameMaybeBody(dirArgs)
					break
				default:
					throw new ParseError(`unknown directive ${dirName} at ${lineChar(errCtx)}`)
			}
		}
		if (body || bodyStart) {
			if (open === Open.DESCRIPTION) {
				const syn_until_end = new RegExp(SYN_UNTIL_END)
				syn_until_end.lastIndex = syn_main.lastIndex
				const desc = (syn_until_end.exec(text) ?? ["}", ""])[1].trim()
				syn_main.lastIndex = syn_until_end.lastIndex
				const lines = desc.replace(/\r\n?/g, "\n").split("\n").map(x => x.trimEnd())
				const firstLine = lines.shift() ?? ""
				const startingSpace = /^[ \t]*/
				let minStartingSpace = Number.POSITIVE_INFINITY
				for (let l of lines) {
					const res = (startingSpace.exec(l) ?? [""])[0]
					if (res.length < minStartingSpace)
						minStartingSpace = res.length
				}
				out.description = [
					firstLine.trimStart(),
					...lines.map(x => x.substring(minStartingSpace))
				].join("\n")
				continue
			}
			if (!opener || open === Open.None) {
				throw new ParseError(`unexpected start of body at ${lineChar(errCtx)}`)
			}
			let ender = /}/y
			if (body) {
				syn_main.lastIndex = text.lastIndexOf(body, syn_main.lastIndex)
				body = ""
				ender = /[ \t]*\r?\n/y
			}
			switch (open) {
				case Open.BGM:
					const [bgm, end] = opener(text, syn_main.lastIndex, ender, out)
					syn_main.lastIndex = end
					const finalCommand = bgm.commands.pop()
					if (finalCommand === undefined) break

					const loopName = `${name}_ENDBGM`
					const playTail = new ast.CommandSet()
					if (finalCommand instanceof ast.CommandSet) {
						// Infinite loop portion
						const tailPats = finalCommand.commands.length
						bgm.commands.push(...finalCommand.commands)
						if (tailPats)
							playTail.push(new ast.JumpPattern(-tailPats))
						else
							playTail.push(new ast.End())
					}
					else {
						// No loop, end song
						bgm.push(finalCommand)
						playTail.push(new ast.End())
					}
					out.pattern[loopName] = playTail
					bgm.push(new ast.PlayPattern(loopName))
					out.bgm[name] = bgm
					break
				case Open.PATTERN:
					[out.pattern[name], syn_main.lastIndex] = opener(text, syn_main.lastIndex, ender, out)
					break
				case Open.SFX:
					[out.sfx[name], syn_main.lastIndex] = opener(text, syn_main.lastIndex, ender, out)
					break
				case Open.MACRO:
					[out.macro[name], syn_main.lastIndex] = opener(text, syn_main.lastIndex, ender, out)
					break
			}
		}
		else if (bodyEnd) {
			throw new ParseError(`unexpected end of body at ${lineChar(errCtx)}`)
		}
	}
	return out
}

function parseBGM(text: string, start: number, ender: RegExp, opts: ast.PMMusic): [ast.CommandSet, number] {
	const out = new ast.CommandSet()
	let setting = out, looped = false

	const syn_pattern_list = new RegExp(SYN_PATTERN_LIST)
	syn_pattern_list.lastIndex = start
	while (syn_pattern_list.lastIndex < text.length) {
		const last = ender.lastIndex = syn_pattern_list.lastIndex
		if (ender.exec(text))
			return [out, last + 1]

		const res = syn_pattern_list.exec(text)
		if (!res)
			throw unexpected(new ErrContext(text, last))

		const [_, patName, loopMark] = res
		if (patName) {
			setting.push(new ast.PlayPattern(patName))
		}
		else if (loopMark) {
			if (looped)
				throw new ParseError(`can only mark one loop in BGM, problem at ${lineChar(text, start)}`)
			setting = setting.push(new ast.CommandSet())
		}
	}
	throw new ParseError(`unexpected end of file while processing BGM starting at ${lineChar(text, start)}`)
}

function parseTrack(text: string, start: number, ender: RegExp, opts: ast.PMMusic): [ast.CommandSet, number] {
	const out = new ast.CommandSet()
	let parents: ast.CommandSet[] = []
	let setting = out

	const syn_track = new RegExp(SYN_TRACK)
	syn_track.lastIndex = start
	let lastOctave = 4
	while (syn_track.lastIndex < text.length) {
		const last = ender.lastIndex = syn_track.lastIndex
		if (ender.exec(text))
			return [out, last + 1]

		const res = syn_track.exec(text)
		const errCtx = new ErrContext(text, last)
		if (!res)
			throw unexpected(errCtx)

		const [_, cmd, args] = res
		if (cmd) switch (cmd.toUpperCase()) {
			case "ROW":
				const row = new ast.Row()
				let end = 3
				for (let sub of args.split(SPLIT_PAT_SUB)) {
					++end  // space or sub command separator
					const trimmed = sub.trim()
					const note = SYN_PAT_SUB_NOTE.exec(trimmed)
					if (note) {
						const [_, sN, sharp, octave] = note
						let n = ast.str2note(sN)
						if (sharp) ++n
						if (octave) {
							lastOctave = parseNum(octave)
							if (isNaN(lastOctave))
								throw expected("number", errCtx.add(end + sub.length - sub.trimStart().length + 1))
						}
						row.note = {note: n, octave: lastOctave}
					}
					else {
						const c = trimmed[0].toLowerCase()
						const s = end
						const sArgs = trimmed.substring(c === "x" ? 2 : 1)
						const args = sArgs ? sArgs.split(":").map(x => {
							const r = parseNum(x.trim())
							if (isNaN(r)) throw expected("number", errCtx.add(end))
							end += x.length + 1
							return r
						}) : []
						if (args.length) --end
						switch (c) {
							case "-": case "_":
								row.note = {note: ast.Note.rest}
								if (trimmed.length > 1) throw unexpected(errCtx.add(s))
								break
							case "w":
								row.wait = args[0]
								break
							case "v":
								row.volume = args[0]
								break
							case "%":
								row.pulseWidth = new ast.PulseWidth(args[0])
								break
							case "\\": case "/":
								// args[0] * 255 / 100
								row.pulseWidth = new ast.PulseWidth(args[0], true)
								break
							case "q":
								row.quant = args[0]
								break
							case "s":
								row.sustain = args[0]
								break
							case "!":
								row.ram = {addr: args[0], data: args[1]}
								break
							case "x":
								const e = trimmed[1]
								if (e === "t")
									row.effectTicks = args[0]
								else
									row.effect = {type: e, params: [...args]}
								break
						}
					}
					end += sub.length
				}
				setting.push(row)
				break
			case "LOOP": case "MARK": case "DO":
				parents.push(setting)
				setting = new ast.Loop()
				break
			case "ENDLOOP": case "ENDL": case "REPEAT":
				if (!(setting instanceof ast.Loop))
					throw new ParseError(`unexpected ENDLOOP at ${lineChar(errCtx)}`)
				if (args && args.trim()) {
					setting.repeats = parseNum1(args.trim())
					if (isNaN(setting.repeats)) throw expected("numbers", errCtx.add(cmd.length))
				}
				parents[parents.length - 1].push(setting)
				setting = parents.pop() as ast.CommandSet
				break
			case "MACRO":
				setting.push(new ast.PlayMacro(args.trim()))
				break
			case "END":
				setting.push(new ast.End())
				break
		}
	}
	throw new ParseError(`unexpected end of file while processing TRACK starting at ${lineChar(text, start)}`)
}

function parseMML(text: string, start: number, ender: RegExp, opts: ast.PMMusic): [ast.CommandSet, number] {
	const out = new ast.CommandSet()
	let parents: ast.CommandSet[] = []
	let setting = out
	const syn_mml = new RegExp(SYN_MML)
	syn_mml.lastIndex = start
	while (syn_mml.lastIndex < text.length) {
		const last = ender.lastIndex = syn_mml.lastIndex
		if (ender.exec(text))
			return [out, last + 1]

		const res = syn_mml.exec(text)
		const errCtx = new ErrContext(text, last)
		if (!res)
			throw unexpected(errCtx)

		const [ _,
			loopStart, loopEnd, repeatHex, repeatDec,
			note, lengthHex, lengthDec, lengthExt,
			rest, rLengthHex, rLengthDec, rLengthExt,
			cmd1, cmdArgHex, cmdArgDec,
			cmd2, cmdArg1Hex, cmdArg1Dec, cmdArg2Hex, cmdArg2Dec,
			cmd0,
			effect, effectArgs
		] = res

		if (loopStart) {
			parents.push(setting)
			setting = new ast.Loop()
		}
		else if (loopEnd) {
			if (!(setting instanceof ast.Loop))
				throw unexpected(errCtx)
			setting.repeats = parsedToNum(repeatHex, repeatDec)
			if (isNaN(setting.repeats)) setting.repeats = 2
			parents[parents.length-1].push(setting)
			setting = parents.pop() as ast.CommandSet
		}
		else if (note) {
			const n = new ast.PlayNote(note)
			const l = parsedToNum(lengthHex, lengthDec)
			if (!isNaN(l)) n.length = l
			if (lengthExt) n.extend = lengthExt.length
			setting.push(n)
		}
		else if (rest) {
			const n = new ast.PlayNote(rest)
			const l = parsedToNum(rLengthHex, rLengthDec)
			if (!isNaN(l)) n.length = l
			if (rLengthExt) n.extend = rLengthExt.length
			setting.push(n)
		}
		else if (effect) {
			let end = 1
			const argPos = [end]
			const args = effectArgs ? effectArgs.split(":").map(x => {
				const r = parseNum(x.trim())
				if (isNaN(r)) throw expected("number", errCtx.add(end))
				end += x.length + 1
				argPos.push(end - 1)
				return r
			}) : []
			if (effect == "t") {
				if (args.length > 1)
					throw unexpected(errCtx.add(argPos[1]))
				setting.push(new ast.EffectTicks(args[0]))
			}
			else {
				setting.push(new ast.EffectStart(effect, args))
			}
		}
		else {
			let arg1 = parsedToNum(cmdArgHex || cmdArg1Hex, cmdArgDec || cmdArg1Dec)
			const arg2 = parsedToNum(cmdArg2Hex, cmdArg2Dec)
			switch (cmd0 || cmd1 || cmd2) {
				case "%":
					setting.push(new ast.PulseWidth(arg1))
					break
				case "\\": case "/":
					setting.push(new ast.PulseWidth(arg1, true))
					break
				case "v":
					if (!opts.volLevelIsMML)
						arg1 = [0, 4, 8, 15][arg1]
					setting.push(new ast.Volume(arg1))
					break
				case "w":
					setting.push(new ast.Wait(arg1))
					break
				case "l":
					setting.push(new ast.Length(arg1))
					break
				case "o":
					setting.push(new ast.Octave(arg1))
					break
				case "q":
					if (opts.shortQuantize)
						arg1 = (arg1 + 1) * 7
					setting.push(new ast.Quant(arg1))
					break
				case "s":
					setting.push(new ast.Sustain(arg1))
					break
				case "!":
					setting.push(new ast.RAM(arg1, arg2))
					break
				case "<":
					setting.push(new ast.StepOctave(opts.octaveReverse))
					break
				case ">":
					setting.push(new ast.StepOctave(!opts.octaveReverse))
					break
				case ";":
					setting.push(new ast.End())
					break
				default:
					if (cmd0)
						setting.push(new ast.PlayMacro(cmd0))
					break
			}
		}
	}
	throw new ParseError(`unexpected end of file while processing MML starting at ${lineChar(text, start)}`)
}

function getNameMaybeBody(text: string) {
	text = text.trim()
	const name = (SYN_CNAME.exec(text) ?? [""])[0]
	return [name, text.substring(name.length).trimStart()]
}

function parseNum1(text: string) {
	const [_, hs, hex, dec] = SYN_NUM1.exec(text) ?? ["", ""]
	if (hex) return parseInt(hs + hex, 16)
	if (dec) return parseInt(dec)
	return NaN
}

function parseNum(text: string) {
	const [_, hex, dec] = SYN_NUM.exec(text) ?? ["", ""]
	if (hex) return parseInt(hex, 16)
	if (dec) return parseInt(dec)
	return NaN
}

function parsedToNum(hex: string, dec: string) {
	if (hex) return parseInt(hex, 16)
	if (dec) return parseInt(dec)
	return NaN
}

function parseBool(text: string) {
	text = text.trim()
	switch (text.toLowerCase()) {
		case "no": case "false": case "0":
			return false
		case "yes": case "true": case "1":
			return true
	}
}

function lineChar(text: ErrContext|string, index?: number) {
	if (text instanceof ErrContext) {
		index = text.position
		text = text.text
	}
	else if (index === undefined)
		throw "doesn't happen"
	const r = /\n/g
	text = text.substring(0, index)
	const line = (text.match(r) ?? []).length + 1
	const char = index - text.lastIndexOf("\n") + 1
	return `line ${line}, char ${char}`
}
