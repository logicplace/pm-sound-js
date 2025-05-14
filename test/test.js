const assert = require("node:assert/strict")
const fs = require("node:fs")
const test = require("node:test").test
const JSON5 = require("json5")

const { parse, ParseError } = require("../out/pmmusic/parser.js")
const ast = require("../out/pmmusic/ast.js")
const compile = require("../out/pmmusic/compiler.js").compile


// Test example commands
test("Check parsing", { concurrency: true }, async t => {
	t.test("INCLUDE", _ => {
		parse("INCLUDE abc.txt", fn => {
			assert.equal(fn, "abc.txt")
			return ""
		})
	})

	t.test("TITLE", _ => {
		assert.equal(parse("TITLE Re:Hello world").title, "Re:Hello world")
	})

	t.test("COMPOSER", _ => {
		assert.equal(parse("COMPOSER 律可").composer, "律可")
	})

	t.test("PROGRAMMER", _ => {
		assert.equal(parse("PROGRAMMER none yet :3").programmer, "none yet :3")
	})

	t.test("DESCRIPTION", _ => {
		// Single line
		assert.equal(parse("DESCRIPTION THX!! Half a million!!!").description, "THX!! Half a million!!!")
		// Multi-line extension
		assert.equal(
			parse("DESCRIPTION {\n    THX!! Half a million!!!\n    With gratitude to everyone!!!\n}").description,
			"THX!! Half a million!!!\nWith gratitude to everyone!!!"
		)
	})

	t.test("OUTFORMAT", _ => {
		assert.equal(parse("OUTFORMAT asm").outFormat, "asm")
		assert.equal(parse("OUTFORMAT c").outFormat, "c")
	})

	t.test("VARHEADER", _ => {
		assert.equal(parse("VARHEADER header.inc").varHeader, "header.inc")
	})

	t.test("OUTHEADER", _ => {
		assert.equal(parse("OUTHEADER header.inc").outHeader, "header.inc")
	})

	t.test("OUTFILE", _ => {
		assert.equal(parse("OUTFILE music.asm").outFile, "music.asm")
	})

	t.test("MASTERTIME", _ => {
		assert.equal(parse("MASTERTIME $00FF").masterTime, 0x00ff)
		assert.equal(parse("MTIME $01FF").masterTime, 0x01ff)
	})

	t.test("MASTERBPM", _ => {
		assert.equal(parse("MASTERBPM 114, 128").masterTime, 255)
		assert.equal(parse("MBPM 100.78, 150").masterTime, 247)
	})

	t.test("VOLLEVEL", _ => {
		assert.equal(parse("VOLLEVEL mml").volLevelIsMML, true)
		assert.equal(parse("VOLLVL 16").volLevelIsMML, true)
		assert.equal(parse("VOLLVL system").volLevelIsMML, false)
		assert.equal(parse("VOLLVL 4").volLevelIsMML, false)

		assert.throws(() => parse("VOLLVL 0"), ParseError)
	})

	t.test("OCTAVEREV", _ => {
		assert.equal(parse("OCTAVEREV yes").octaveReverse, true)
		assert.equal(parse("OCTREV no").octaveReverse, false)
		assert.equal(parse("OCTREV 1").octaveReverse, true)
		assert.equal(parse("OCTREV 0").octaveReverse, false)
		assert.equal(parse("OCTREV TRUE").octaveReverse, true)
		assert.equal(parse("OCTREV false").octaveReverse, false)

		assert.throws(() => parse("OCTREV q"), ParseError)
	})

	t.test("OCTAVEREV", _ => {
		assert.equal(parse("SHORTQUANTIZE yes").shortQuantize, true)
		assert.equal(parse("SHORTQ no").shortQuantize, false)
		assert.equal(parse("SHORTQ 1").shortQuantize, true)
		assert.equal(parse("SHORTQ 0").shortQuantize, false)
		assert.equal(parse("SHORTQ TRUE").shortQuantize, true)
		assert.equal(parse("SHORTQ false").shortQuantize, false)

		assert.throws(() => parse("SHORTQ q"), ParseError)
	})

	t.test("BGM", _ => {
		const bgm = {"foo": new ast.CommandSet(
			new ast.PlayPattern("bar"),
			new ast.PlayPattern("foo_ENDBGM"),
		)}
		const end = new ast.CommandSet(new ast.End())
		const back = new ast.CommandSet(new ast.JumpPattern(-1))
		let actual = parse("BGM foo { bar }")
		assert.deepEqual(actual.bgm, bgm)
		assert.deepEqual(actual.pattern["foo_ENDBGM"], end)
		actual = parse("BGM foo { bar |}")
		assert.deepEqual(actual.bgm, bgm)
		assert.deepEqual(actual.pattern["foo_ENDBGM"], end)
		actual = parse("BGM foo {| bar }")
		assert.deepEqual(actual.bgm, bgm)
		assert.deepEqual(actual.pattern["foo_ENDBGM"], back)
		actual = parse("BGM foo bar")
		assert.deepEqual(actual.bgm, bgm)
		assert.deepEqual(actual.pattern["foo_ENDBGM"], end)
	})

	t.test("PATTERN_TRACK", t2 => {
		t2.test("aliases", _ => {
			const pat = {
				"foo": new ast.CommandSet(new ast.End())
			}
			assert.deepEqual(parse("PATTERN_TRACK foo { END }").pattern, pat)
			assert.deepEqual(parse("PATTERN_T foo END").pattern, pat)
			assert.deepEqual(parse("PAT_TRACK foo END").pattern, pat)
			assert.deepEqual(parse("PAT_T foo END").pattern, pat)
		})

		function p1(t) {
			return parse(`PAT_T foo { ${t} }`).pattern["foo"].commands[0]
		}

		t2.test("ROW", _ => {
			const expected = new ast.Row({
				wait: 4,
				volume: 15,
				pulseWidth: new ast.PulseWidth(0x80),
				note: {note: ast.Note.E, octave: 5}
			})
			assert.deepEqual(p1("ROW w4, v15, %$80, E-5"), expected)
			assert.deepEqual(p1("ROW w4; v15; %$80; E-5"), expected)

			assert.deepEqual(p1("ROW E#5"), new ast.Row({
				note: {note: ast.Note.F, octave: 5}
			}))

			assert.deepEqual(p1("ROW /80"), new ast.Row({
				pulseWidth: new ast.PulseWidth(80, true),
			}))

			assert.deepEqual(p1("ROW \\80"), new ast.Row({
				pulseWidth: new ast.PulseWidth(80, true),
			}))

			assert.deepEqual(p1("ROW !$25:$50"), new ast.Row({
				ram: {addr: 0x25, data: 0x50},
			}))

			assert.deepEqual(p1("ROW q40"), new ast.Row({
				quant: 40,
			}))

			assert.deepEqual(p1("ROW s40"), new ast.Row({
				sustain: 40,
			}))

			assert.deepEqual(p1("ROW xt2, xa2:3"), new ast.Row({
				effectTicks: 2,
				effect: {type: "a", params: [2, 3]},
			}))

			assert.deepEqual(p1("ROW xd"), new ast.Row({
				effect: {type: "d", params: []},
			}))

			assert.deepEqual(p1("ROW xp2"), new ast.Row({
				effect: {type: "p", params: [2]},
			}))

			assert.deepEqual(p1("ROW xx-2:$0a:4:5"), new ast.Row({
				effect: {type: "x", params: [-2,0x0a,4,5]},
			}))
		})

		t2.test("LOOP / MACRO", _ => {
			let expected = new ast.CommandSet(
				new ast.Loop(new ast.PlayMacro("A"))
			)
			let actual = parse(
				"PAT_T foo {\n"
				+"  LOOP\n"
				+"  MACRO A\n"
				+"  ENDLOOP\n"
				+"}"
			).pattern["foo"]
			assert.deepEqual(actual, expected)

			actual = parse(
				"PAT_T foo {\n"
				+"  MARK\n"
				+"  MACRO A\n"
				+"  ENDL\n"
				+"}"
			).pattern["foo"]
			assert.deepEqual(actual, expected)

			actual = parse(
				"PAT_T foo {\n"
				+"  DO\n"
				+"  MACRO A\n"
				+"  REPEAT 3\n"
				+"}"
			).pattern["foo"]
			expected.commands[0].repeats = 3
			assert.deepEqual(actual, expected)
		})
	})

	t.test("SFX_TRACK", t2 => {
		t2.test("aliases", _ => {
			const sfx = {
				"foo": new ast.CommandSet(new ast.End())
			}
			assert.deepEqual(parse("SFX_TRACK foo { END }").sfx, sfx)
			assert.deepEqual(parse("SFX_T foo END").sfx, sfx)
		})
	})

	t.test("MACRO_TRACK", t2 => {
		t2.test("aliases", _ => {
			const mac = {
				"A": new ast.CommandSet(new ast.End())
			}
			assert.deepEqual(parse("MACRO_TRACK A { END }").macro, mac)
			assert.deepEqual(parse("MACRO_T A END").macro, mac)
		})
	})

	t.test("PATTERN", t2 => {
		t2.test("aliases", _ => {
			const pat = {
				"foo": new ast.CommandSet(new ast.End())
			}
			assert.deepEqual(parse("PATTERN foo { ; }").pattern, pat)
			assert.deepEqual(parse("PAT foo ;").pattern, pat)
		})

		function p1(t) {
			return parse(`PAT foo { ${t} }`).pattern["foo"].commands[0]
		}

		function note(n, l, e) {
			const ret = new ast.PlayNote()
			ret.note = n
			ret.length = l
			ret.extend = e ?? 0
			return ret
		}

		for (const [a, e] of [
			[p1("e"), note(ast.Note.E)],
			[p1("e1"), note(ast.Note.E, 1)],
			[p1("e2...."), note(ast.Note.E, 2, 4)],
			[p1("e."), note(ast.Note.E, undefined, 1)],
			[p1("e-"), note(ast.Note.Ds)],
			[p1("c-"), note(ast.Note.Cb)],
			[p1("b+"), note(ast.Note.Bs)],
			[p1("b#"), note(ast.Note.Bs)],
			[p1("r"), note(ast.Note.rest)],
			[p1("r-2."), note(ast.Note.rest, -2, 1)],
			[p1("r$-a"), note(ast.Note.rest, -0xa)],
		]) {
			assert.deepEqual(a, e)
		}

		assert.deepEqual(p1("%128"), new ast.PulseWidth(128))
		assert.deepEqual(p1("/80"), new ast.PulseWidth(80, true))
		assert.deepEqual(p1("\\8"), new ast.PulseWidth(8, true))
		assert.deepEqual(p1("v4"), new ast.Volume(4))
		assert.deepEqual(p1("w56"), new ast.Wait(56))
		assert.deepEqual(p1("!$00:$8b"), new ast.RAM(0x00, 0x8b))
		assert.deepEqual(p1("l64"), new ast.Length(64))
		assert.deepEqual(p1("A"), new ast.PlayMacro("A"))
		assert.deepEqual(p1("<"), new ast.StepOctave(false))
		assert.deepEqual(p1(">"), new ast.StepOctave(true))
		assert.deepEqual(
			parse("OCTREV 1\nPAT f <").pattern["f"].commands[0],
			new ast.StepOctave(true)
		)
		assert.deepEqual(
			parse("OCTREV 1\nPAT f >").pattern["f"].commands[0],
			new ast.StepOctave(false)
		)
		assert.deepEqual(p1("o2"), new ast.Octave(2))
		assert.deepEqual(p1("q17"), new ast.Quant(17))
		assert.deepEqual(p1("s23"), new ast.Sustain(23))
		assert.deepEqual(p1("xt3"), new ast.EffectTicks(3))
		assert.deepEqual(p1("xd"), new ast.EffectStart("d"))
		assert.deepEqual(p1("xA1"), new ast.EffectStart("A", [1]))
		assert.deepEqual(p1("xa3:7"), new ast.EffectStart("a", [3, 7]))
		assert.deepEqual(p1("xp-36"), new ast.EffectStart("p", [-36]))
		assert.deepEqual(p1("xs$ffffffff"), new ast.EffectStart("s", [0xffffffff]))
		assert.deepEqual(p1("xr20"), new ast.EffectStart("r", [20]))
	})

	t.test("SFX", t2 => {
		t2.test("bodied / bodyless", _ => {
			const sfx = {
				"foo": new ast.CommandSet(new ast.End())
			}
			assert.deepEqual(parse("SFX foo { ; }").sfx, sfx)
			assert.deepEqual(parse("SFX foo ;").sfx, sfx)
		})
	})

	t.test("MACRO", t2 => {
		t2.test("bodied / bodyless", _ => {
			const mac = {
				"A": new ast.CommandSet(new ast.End())
			}
			assert.deepEqual(parse("MACRO A { ; }").macro, mac)
			assert.deepEqual(parse("MACRO A ;").macro, mac)
		})
	})
})

// Test real songs (examples from Pokemini)
const songs = __dirname + "/songs/"

for (const n of [
	"pmintro",
	"galactix",
	"metroid",
	"unknown",
]) {
	test(`Check compilation of ${n}`, { concurrency: true }, async t => {
		const text = fs.readFileSync(songs + n + ".pmmusic", {encoding: "utf8"})
		const expected = JSON5.parse(fs.readFileSync(songs + n + ".json5", {encoding: "utf8"}))
		const pmmusic = parse(text)
		const cr = compile(pmmusic, {
			bgm: Object.keys(pmmusic.bgm),
			pattern: Object.keys(pmmusic.pattern),
			sfx: Object.keys(pmmusic.sfx),
		})
	
		// Compare
		t.test("Ensure BGM(s) are correct", t2 => {
			for (const b of Object.keys(expected.bgm)) {
				t2.test(b, () => {
					if (!(b in cr.bgm))
						throw new Error(`expected BGM ${b}`)
					assert.deepStrictEqual(cr.bgm[b], expected.bgm[b])
				})
			}
		})

		t.test("Ensure patterns are correct", t2 => {
			for (const p of Object.keys(expected.pattern)) {
				t2.test(p, () => {
					if (!(p in cr.pattern))
						throw new Error(`expected pattern ${p}`)
					assert.deepStrictEqual(toArray(cr.pattern[p]), expected.pattern[p])
				})
			}
		})

		t.test("Ensure SFX are correct", t2 => {
			for (const s of Object.keys(expected.sfx)) {
				t2.test(s, () => {
					if (!(s in cr.sfx))
						throw new Error(`expected SFX ${s}`)
					assert.deepStrictEqual(toArray(cr.sfx[s]), expected.sfx[s])
				})
			}
		})
	})
}

function toArray(cmds) {
	const out = []
	for (const cmd of cmds) {
		out.push(...cmd.toU16Array())
	}
	return out
}
