#!/usr/bin/env node
import * as fs from "node:fs"
import * as path from "node:path"

import { program, Command } from "commander";
import { LIB_VERSION } from "./version"
import { SoundEngine, Filter } from "./pm/audio";
import { PMMusic } from "./pmmusic/ast";
import { compile } from "./pmmusic/compiler"
import { PMMusicEngine } from "./pmmusic/engine"
import { parse } from "./pmmusic/parser"
import { SpeakerSink } from "./pm/audout/node";

program
	.description("PMSound-JS music conversion tool for Pokémon mini")
	.version(LIB_VERSION)

program
	.command("compile").alias("c")
	.argument("<pmmusic>", "the .pmmusic file to use")
	.option("-o, --out <path>", "output path or filename", "")
	.option("--pmas", "output PMAS-style assembly")
	.option("-a, --all", "compile all BGMs and SFX")
	.option("-b, --bgm <name...>", "compile given BGM(s)")
	.option("-s, --sfx <name...>", "compile given SFX")
	.action(readAnd(cmdCompile))

program
	.command("play").alias("p")
	.argument("<pmmusic>", "the .pmmusic file to use")
	.argument("<name>", "play BGM, pattern, or SFX")
	.option("-s, --sound <engine>", "specify sound engine to use: generated, direct (default), emulated, direct_pwm", "direct")
	.option("--no-piezo", "disable piezo filter")
	.action(readAnd(cmdPlay))

program.parse()

function readAnd(fun: (pmmusic: PMMusic, opts: any)=>void) {
	return function (this: Command, fn: string) {
		const cmd = this
		fs.readFile(fn, {encoding: "utf8"}, (err, data) => {
			if (err) throw err;
			const pmmusic = parse(data, getFile)
			fun.call(cmd, pmmusic, cmd.opts())
		})
	}
}

function cmdCompile(pmmusic: PMMusic, args: {all: boolean, bgm: string[], sfx: string[]}) {
	const opts = args.all ? {
		bgm: Object.keys(pmmusic.bgm),
		pattern: Object.keys(pmmusic.pattern),
		sfx: Object.keys(pmmusic.sfx),
	} : {
		bgm: args.bgm as string[],
		sfx: args.sfx as string[],
	}
	const cr = compile(pmmusic, opts)
	const out = cr.toPMAS()
	const outFN = getOutFilename(program.args[0], ".asm")
	fs.writeFile(outFN, out, {encoding: "utf8"}, (err) => {
		if (err) throw err;
		console.log("wrote to " + outFN)
	})
}

function getFile(fn: string) {
	fn = path.resolve(__dirname, fn)
	if (!path.extname(fn)) fn += ".pmmusic"
	return fs.readFileSync(fn, {encoding: "utf8"})
}

function getOutFilename(fn: string, ext: string) {
	const args: {out: string} = program.opts()
	if (args.out) {
		if (path.extname(args.out)) {
			// Export to single file
			return args.out
		}
		else {
			// Export to given folder with same name as file
			fn = path.basename(fn, path.extname(fn))
			return path.resolve(args.out, fn + ext)
		}
	}
	else {
		// Export relative to target file (default)
		fn = path.basename(fn, path.extname(fn))
		return path.resolve(path.dirname(fn), fn + ext)
	}
}

function cmdPlay(this: Command, pmmusic: PMMusic, opts: {sound: string, piezo: boolean}) {
	const name = this.args[1]
	const player = new PMMusicEngine(pmmusic.masterTime)

	player.addSink(new SpeakerSink())

	switch (opts.sound.toLowerCase()) {
		case "generated":
			player.audio.changeEngine(SoundEngine.generated)
			break
		case "direct":
			player.audio.changeEngine(SoundEngine.direct)
			break
		case "emulated":
			player.audio.changeEngine(SoundEngine.emulated)
			break
		case "direct_pwm": case "directpwm":
			player.audio.changeEngine(SoundEngine.directPWM)
			break
		default:
			console.error(`unknown engine "${opts.sound}"`)
			return
	}

	if (!opts.piezo) {
		player.audio.changeFilter(Filter.disabled)
	}

	// TODO: WAV output

	if (name in pmmusic.bgm) {
		const cr = compile(pmmusic, {bgm: name})
		player.playBGM(cr.bgmCommands(name))
		console.log(`Playing BGM "${name}"`)
	}
	else if (name in pmmusic.sfx) {
		const cr = compile(pmmusic, {sfx: name})
		player.playSFX(cr.sfx[name] ?? [])
		console.log(`Playing SFX "${name}"`)
	}
	else if (name in pmmusic.pattern) {
		const cr = compile(pmmusic, {pattern: name})
		player.playSFX(cr.pattern[name] ?? [])
		console.log(`Playing Pattern "${name}"`)
	}
	else {
		console.error(`couldn't find "${name}" to play`)
		return
	}

	console.log("Press Ctrl+C to stop...")

	// Initialize audio & play
	player.play()

	// .then(...) TODO: export and close WAV
}
