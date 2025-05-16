import { Filter, Player, SoundEngine } from "../pm/audio"
import { PM } from "../pm/pm"
import {
	PMMusicCommand,
	FLAG_VOL, FLAG_WRITERAM, FLAG_PRESET, FLAG_PIVOT,
	FLAG_END, FLAG_PATTERN, FLAG_MARK, FLAG_LOOP
} from "./compiler"

const DIV_2   = 8
const DIV_256 = 13

const VOLTABLE = [
	[0x00, 0x00, 0x00, 0x00],
	[0x00, 0x00, 0x06, 0x06],
	[0x00, 0x06, 0x06, 0x07],
	[0x00, 0x06, 0x02, 0x02],
	[0x00, 0x06, 0x02, 0x03],
]

interface LoopInfo {
	patOffset: number
	dataOffset: number
	count: number
}

export class PMMusicEngine extends Player {
	// Hardware
	pm: PM
	mtime: number
	hwpreset: number = 0
	hwpivot: number = 0
	hwvol: number = 0

	// Main Data
	audEna: number = 0
	ram: DataView

	// BGM Data
	bgmPats: PMMusicCommand[][]
	bgmPatOffset: number = 0
	bgmData: PMMusicCommand[]
	bgmDataOffset: number = 0
	bgmWait: number = 1
	bgmMasterVol: number = 0
	bgmPlayVol: number = 0
	bgmFrq: number = 0
	bgmPvt: number = 0
	bgmVolTable: number[]
	bgmLoop: {[key: number]: LoopInfo}
	bgmOnEnd?: ()=>void

	// SFX Data
	sfxData: PMMusicCommand[]
	sfxDataOffset: number = 0
	sfxWait: number = 1
	sfxMasterVol: number = 0
	sfxPlayVol: number = 0
	sfxFrq: number = 0
	sfxPvt: number = 0
	sfxVolTable: number[]
	sfxLoop: {[key: number]: LoopInfo}
	sfxOnEnd?: ()=>void

	//
	playdec: number = 36

	constructor (mastertime: number, ramOffset?: number) {
		const pm = new PM()
		pm.initTimers()
		const audio = pm.initAudio()
		super(audio)
		audio.changeEngine(SoundEngine.direct)
		audio.changeFilter(Filter.piezo)

		this.pm = pm
		this.bgmPats = []
		this.bgmData = []
		this.sfxData = []
		this.bgmLoop = {}
		this.sfxLoop = {}
		// shut up typescript
		this.bgmVolTable = []
		this.sfxVolTable = []

		// Set master time
		this.mtime = mastertime
		this.pm.write2Reg(0x3a, mastertime)

		// Set RAM pointer, default to general purpose memory for convenience
		ramOffset ??= 0x500
		this.ram = new DataView(
			pm.ram.buffer,
			pm.ram.byteOffset + ramOffset,
			pm.ram.byteLength - ramOffset
		)

		// Registers to zero
		pm.writeReg(0x71, 0)   // Audio Volume
		pm.write2Reg(0x38, 0)  // Tmr2 Ctrl
		pm.write2Reg(0x4a, 0)  // Tmr3 Preset
		pm.write2Reg(0x4c, 0)  // Tmr3 Pivot
		pm.writeReg(0x1b, 0)   // Tmr2 Osc
		pm.writeReg(0x1d, 0)   // Tmr3 Osc
		pm.writeReg(0x1a, DIV_256)  // Tmr2 Scale
		pm.writeReg(0x1c, DIV_2)    // Tmr3 Scale
		pm.timersGen[1].hi.onUnderflow = this.irq.bind(this)

		// Registers to non-zero
		this.setVolBGM(4)
		this.setVolSFX(4)
		pm.write2Reg(0x48, 0x86)  // Tmr3 Ctrl
		pm.writeReg(0x19, 0x20)   // Enable Osc1
	}

	public setVolBGM(volume: number) {
		if (volume < 5) {
			this.bgmMasterVol = volume
			this.bgmVolTable = VOLTABLE[volume]
		}
	}

	public setVolSFX(volume: number) {
		if (volume < 5) {
			this.sfxMasterVol = volume
			this.sfxVolTable = VOLTABLE[volume]
		}
	}

	public setMasterTime(mtime: number) {
		this.mtime = mtime
		this.pm.write2Reg(0x3a, mtime)
	}

	public playBGM(data: PMMusicCommand[][], onEnd?: ()=>void) {
		this.bgmPats = data
		this.bgmPatOffset = 0
		this.bgmData = data[0]
		this.bgmDataOffset = 0
		this.bgmLoop = {}
		if (this.bgmOnEnd)
			this.bgmOnEnd()
		this.bgmOnEnd = onEnd

		this.audEna &= 0x02
		this.audEna |= 0x01
		this.bgmWait = 1
		if (!(this.audEna & 0x02)) {
			const pm = this.pm
			pm.write2Reg(0x38, 0x86)  // Tmr2 Ctrl
			this.hwpreset = 0
			pm.write2Reg(0x4a, 0x00)  // Tmr3 Preset
			pm.writeReg(0x48, 0x86)   // Tmr3 Ctrl
		}
	}

	public stopBGM() {
		this.bgmData = []
		if (this.bgmOnEnd)
			this.bgmOnEnd()
		this.audEna &= 0x02
		if (!this.audEna) {
			this.pm.writeReg(0x38, 0)  // Tmr2 Ctrl
			this.pm.writeReg(0x48, 0)  // Tmr3 Ctrl
		}
	}

	public isPlayingBGM() {
		return !!this.bgmData.length
	}

	public playSFX(data: PMMusicCommand[], onEnd?: ()=>void) {
		this.sfxData = data
		this.sfxDataOffset = 0
		this.sfxLoop = {}
		if (this.sfxOnEnd)
			this.sfxOnEnd()
		this.sfxOnEnd = onEnd

		this.audEna &= 0x01
		this.audEna |= 0x02
		this.sfxWait = 1
		const pm = this.pm
		pm.write2Reg(0x38, 0x86)  // Tmr2 Ctrl
		this.hwpreset = 0
		pm.write2Reg(0x4a, 0x00)  // Tmr3 Preset
		pm.writeReg(0x48, 0x86)   // Tmr3 Ctrl
	}

	public stopSFX() {
		this.sfxData = []
		if (this.sfxOnEnd)
			this.sfxOnEnd()
		this.audEna &= 0x01
		if (!this.audEna) {
			this.pm.writeReg(0x38, 0)  // Tmr2 Ctrl
			this.pm.writeReg(0x48, 0)  // Tmr3 Ctrl
		}
	}

	public isPlayingSFX() {
		return !!this.sfxData.length
	}

	public irq() {
		let recursiveLimit = 65536

		// Process BGM
		if (this.audEna & 0x01) {
			// Decrease BGM wait
			if (this.bgmWait)
				--this.bgmWait
			if (!this.bgmWait) {
				while (recursiveLimit >= 0) {
					--recursiveLimit

					// Read data from playing BGM
					const cmd = this.bgmData[this.bgmDataOffset]
					// Set wait and volume
					this.bgmWait = cmd.wait
					if (cmd.flags & FLAG_VOL)
						this.bgmPlayVol = this.bgmVolTable[cmd.volume & 3]
					// Increment BGM pointer to next command
					++this.bgmDataOffset
					if (this.bgmDataOffset > this.bgmData.length) {
						this.audEna = 0
						throw "player error: BGM out of range"
					}
					// Write RAM
					if (cmd.flags & FLAG_WRITERAM)
						this.ram.setUint8(cmd.ramAddr, cmd.ramData)
					// Set Frequency
					if (cmd.flags & FLAG_PRESET)
						this.bgmFrq = cmd.preset
					// Set Frequency
					if (cmd.flags & FLAG_PIVOT)
						this.bgmPvt = cmd.pivot
					// Jump pattern / End Sound
					if (cmd.flags & FLAG_END) {
						this.stopBGM()
						return
					}
					if (cmd.flags & FLAG_PATTERN) {
						const p = cmd.pattern
						this.bgmPatOffset += p >= 0x8000 ? p - 0x10000 : p
						if (this.bgmPatOffset < 0 || this.bgmPatOffset >= this.bgmPats.length) {
							this.audEna = 0
							throw "player error: BGM invalid pattern"
						}
						this.bgmData = this.bgmPats[this.bgmPatOffset]
						this.bgmDataOffset = 0
					}
					// Loop
					if (cmd.flags & FLAG_MARK)
						this.bgmLoop[cmd.loopID] = {
							patOffset: this.bgmPatOffset,
							dataOffset: this.bgmDataOffset,
							count: 0
						}
					else if (cmd.flags & FLAG_LOOP) {
						const loop = this.bgmLoop[cmd.loopID]
						if (loop.count != cmd.loopNum) {
							++loop.count
							this.bgmPatOffset = loop.patOffset
							this.bgmData = this.bgmPats[this.bgmPatOffset]
							this.bgmDataOffset = loop.dataOffset
						}
					}
					// All done!
					if (!this.bgmWait) continue
					// Check SFX first as it has higher priority
					if (!this.sfxMasterVol || !(this.audEna & 2)) {
						this.pm.write2Reg(0x4a, this.bgmFrq)
						let pvt = this.bgmPvt
						if (this.bgmPlayVol & 4)
							pvt >>= 4
						this.pm.write2Reg(0x4c, pvt)	
						this.pm.writeReg(0x71, this.bgmPlayVol & 3)
					}
					break
				}
			}
		}

		// Process SFX
		if (this.audEna & 0x02) {
			// Decrease SFX wait
			if (this.sfxWait)
				--this.sfxWait
			if (!this.sfxWait) {
				while (recursiveLimit >= 0) {
					--recursiveLimit

					// Read data from SFX pointer
					const cmd = this.sfxData[this.sfxDataOffset]
					// Set wait and volume
					this.sfxWait = cmd.wait
					if (cmd.flags & FLAG_VOL)
						this.sfxPlayVol = this.sfxVolTable[cmd.volume & 3]
					// Increment SFX pointer to next command
					++this.sfxDataOffset
					if (this.sfxDataOffset > this.sfxData.length) {
						this.audEna = 0
						throw "player error: SFX out of range"
					}
					// Write RAM
					if (cmd.flags & FLAG_WRITERAM)
						this.ram.setUint8(cmd.ramAddr, cmd.ramData)
					// Set Frequency
					if (cmd.flags & FLAG_PRESET)
						this.sfxFrq = cmd.preset
					// Set Frequency
					if (cmd.flags & FLAG_PIVOT)
						this.sfxPvt = cmd.pivot
					// Jump pattern / End Sound
					if (cmd.flags & (FLAG_END|FLAG_PATTERN)) {
						this.stopSFX()
						return
					}
					// Loop
					if (cmd.flags & FLAG_MARK)
						this.sfxLoop[cmd.loopID] = {
							patOffset: 0,
							dataOffset: this.sfxDataOffset,
							count: 0
						}
					else if (cmd.flags & FLAG_LOOP) {
						const loop = this.sfxLoop[cmd.loopID]
						if (loop.count != cmd.loopNum) {
							++loop.count
							this.sfxDataOffset = loop.dataOffset
						}
					}
					// All done!
					if (!this.sfxWait) continue
					this.pm.write2Reg(0x4a, this.sfxFrq)
					let pvt = this.sfxPvt
					if (this.sfxPlayVol & 4)
						pvt >>= 4
					this.pm.write2Reg(0x4c, pvt)	
					this.pm.writeReg(0x71, this.sfxPlayVol & 3)
					break
				}
			}
		}

		if (recursiveLimit <= 0) {
			this.audEna = 0
			throw "player error: recursive overflow"
		}
	}

	public emulate(cycles: number): boolean {
		if (this.audEna) this.playdec = 36
		else --this.playdec

		const PokeHWCycles = 16
		if (this.audio.requireSoundSync) {
			while (cycles > 0) {
				for (const t of this.pm.timersGen)
					t.sync(PokeHWCycles)
				this.audio.sync(PokeHWCycles)
				cycles -= PokeHWCycles
			}
		}
		else {
			while (cycles > 0) {
				for (const t of this.pm.timersGen)
					t.sync(PokeHWCycles)
				cycles -= PokeHWCycles
			}
		}

		return !!this.playdec
	}

	public makeEndCommand() {
		return new PMMusicCommand({
			wait: 1,
			flags: FLAG_VOL | FLAG_END,
			volume: 0,
		})
	}
}
