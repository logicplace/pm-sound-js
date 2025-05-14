import { Audio } from "./audio";
import { GeneralTimer } from "./timers";

export class PM {
	// Module emulators
	audio?: Audio
	timersGen: GeneralTimer[]

	// Memory
	_memory: DataView
	bios: DataView
	ram: DataView
	registers: DataView
	rom: DataView

	constructor () {
		const memory = new ArrayBuffer(0x200000)
		this._memory = new DataView(memory)
		this.bios = new DataView(memory, 0, 0x1000)
		this.ram = new DataView(memory, 0x1000, 0x1000)
		this.registers = new DataView(memory, 0x2000, 0x100)
		this.rom = new DataView(memory, 0x2100)

		this.timersGen = []
	}

	public initTimers() {
		// TODO: timer256, timerSec
		this.timersGen = [
			new GeneralTimer(),
			new GeneralTimer(),
			(
				this.audio
				? this.audio.tmr3
				: new GeneralTimer()
			)
		]
	}

	public initAudio() {
		if (this.timersGen.length)
			this.audio = new Audio(this.timersGen[2])
		else
			this.audio = new Audio(new GeneralTimer())
		return this.audio
	}

	public read1(page: number, addr: number) {
		if (addr & 0x8000)
			addr = (page << 15) | (addr & 0x7fff)
		if (0x2000 <= addr && addr < 0x2100)
			return this.readReg(addr - 0x2000)
		return this._memory.getUint8(addr)
	}

	public read2(page: number, addr: number) {
		if (addr & 0x8000)
			addr = (page << 15) | (addr & 0x7fff)
		if (0x2000 <= addr && addr < 0x2100) {
			const resLO = this.readReg(addr - 0x2000)
			const resHI = this.readReg(addr + 1 - 0x2000)
			return (resHI << 8) | resLO
		}
		return this._memory.getUint16(addr, true)
	}

	public write1(addr: number, value: number) {
		if (!(0x1000 <= addr && addr < 0x2100))
			throw "cannot write to ROM"
		if (addr < 0x2000)
			this._memory.setUint8(addr, value)
		else
			this.writeReg(addr - 0x2000, value)
	}

	public write2(addr: number, value: number) {
		if (!(0x1000 <= addr && addr < 0x2100))
			throw "cannot write to ROM"
		if (addr < 0x2000)
			this._memory.setUint16(addr, value, true)
		else
			this.write2Reg(addr - 0x2000, value)
	}

	public write2Reg(reg: number, value: number) {
		this.writeReg(reg, value & 0xff)
		this.writeReg(reg + 1, value >> 8)
	}

	public load(addr: number, data: Uint8Array) {
		if (addr + data.length > 0x200000)
			throw "load too big"
		for (const x of data) {
			this._memory.setUint8(addr++, x)
		}
	}

	public readReg(reg: number) {
		if (reg < 0 || reg > 0xff)
			throw "register address out of range: " + reg
		switch (reg) {
			// TODO: System
			// TODO: Seconds timer
			// TODO: Battery sensor
			// General timers
			case 0x18:
				if (!this.timersGen.length) break
				return this._readTimerPrescale(0)
			case 0x19:
				if (!this.timersGen.length) break
				return this._readTimerOsc(0)
			case 0x1a:
				if (!this.timersGen.length) break
				return this._readTimerPrescale(1)
			case 0x1b:
				if (!this.timersGen.length) break
				return this._readTimerOsc(1)
			case 0x1c:
				if (!this.timersGen.length) break
				return this._readTimerPrescale(2)
			case 0x1d:
				if (!this.timersGen.length) break
				return this._readTimerOsc(2)
			// TODO: IRQ
			// General timers (again)
			case 0x30:
				if (!this.timersGen.length) break
				return this._readTimerLoControl(0)
			case 0x31:
				if (!this.timersGen.length) break
				return this._readTimerHiControl(0)
			case 0x32:
				if (!this.timersGen.length) break
				return this.timersGen[0].lo.preset
			case 0x33:
				if (!this.timersGen.length) break
				return this.timersGen[0].hi.preset
			case 0x34:
				if (!this.timersGen.length) break
				return this.timersGen[0].pivot & 0x00ff
			case 0x35:
				if (!this.timersGen.length) break
				return this.timersGen[0].pivot >> 8
			// 36~37 unwritable
			case 0x38:
				if (!this.timersGen.length) break
				return this._readTimerLoControl(1)
			case 0x39:
				if (!this.timersGen.length) break
				return this._readTimerHiControl(1)
			case 0x3a:
				if (!this.timersGen.length) break
				return this.timersGen[1].lo.preset 
			case 0x3b:
				if (!this.timersGen.length) break
				return this.timersGen[1].hi.preset 
			case 0x3c:
				if (!this.timersGen.length) break
				return this.timersGen[1].pivot & 0x00ff
			case 0x3d:
				if (!this.timersGen.length) break
				return this.timersGen[1].pivot >> 8
			// 3e~3f unwritable
			// TODO: 256Hz timer
			// TODO?: unknown
			// General timer (final)
			case 0x48:
				if (!this.timersGen.length) break
				return this._readTimerLoControl(2)
			case 0x49:
				if (!this.timersGen.length) break
				return this._readTimerHiControl(2)
			case 0x4a:
				if (!this.timersGen.length) break
				return this.timersGen[2].lo.preset
			case 0x4b:
				if (!this.timersGen.length) break
				return this.timersGen[2].hi.preset
			case 0x4c:
				if (!this.timersGen.length) break
				return this.timersGen[2].pivot & 0x00ff
			case 0x4d:
				if (!this.timersGen.length) break
				return this.timersGen[2].pivot >> 8
			// 4e~4f unwritable
			// TODO: input stuff?
			// 52~52 unwritable
			// TODO: I/O
			// Audio
			// 70 can't be reconstructed
			case 0x71:
				if (!this.audio) break
				return this.audio.volume
			// TODO: PRC
			// TODO: pokemini debug
			// TODO: LCD
		}
		return this.registers.getUint8(reg)
	}

	private _readTimerPrescale(idx: number) {
		const tmr = this.timersGen[idx]
		return (tmr.hi.prescale << 4) | tmr.lo.prescale
	}

	private _readTimerOsc(idx: number) {
		const tmr = this.timersGen[idx]
		return (tmr.hi.oscillator << 1) | tmr.lo.oscillator
	}

	private _readTimerLoControl(idx: number) {
		const tmr = this.timersGen[idx]
		// TODO: etc
		return (tmr.wideMode ? 0x80 : 0) | (tmr.lo.enabled ? 0x04 : 0)
	}

	private _readTimerHiControl(idx: number) {
		const tmr = this.timersGen[idx]
		// TODO: etc
		return (tmr.hi.enabled ? 0x04 : 0)
	}

	public writeReg(reg: number, value: number) {
		this.registers.setUint8(reg, value)
		switch (reg) {
			// TODO: System
			// TODO: Seconds timer
			// TODO: Battery sensor
			// General timers
			case 0x18:
				this._writeTimerPrescale(0, value)
				return
			case 0x19:
				this._writeTimerOsc(0, value)
				return
			case 0x1a:
				this._writeTimerPrescale(1, value)
				return
			case 0x1b:
				this._writeTimerOsc(1, value)
				return
			case 0x1c:
				this._writeTimerPrescale(2, value)
				return
			case 0x1d:
				this._writeTimerOsc(2, value)
				return
			// TODO: IRQ
			// General timers (again)
			case 0x30:
				this._writeTimerLoControl(0, value)
				return
			case 0x31:
				this._writeTimerHiControl(0, value)
				return
			case 0x32:
				if (!this.timersGen.length) return
				this.timersGen[0].lo.preset = value
				return
			case 0x33:
				if (!this.timersGen.length) return
				this.timersGen[0].hi.preset = value
				return
			case 0x34:
				if (!this.timersGen.length) return
				this.timersGen[0].pivot &= 0xff00
				this.timersGen[0].pivot |= value
				return
			case 0x35:
				if (!this.timersGen.length) return
				this.timersGen[0].pivot &= 0x00ff
				this.timersGen[0].pivot |= value << 8
				return
			// 36~37 unwritable
			case 0x38:
				this._writeTimerLoControl(1, value)
				return
			case 0x39:
				this._writeTimerHiControl(1, value)
				return
			case 0x3a:
				if (!this.timersGen.length) return
				this.timersGen[1].lo.preset = value
				return
			case 0x3b:
				if (!this.timersGen.length) return
				this.timersGen[1].hi.preset = value
				return
			case 0x3c:
				if (!this.timersGen.length) return
				this.timersGen[1].pivot &= 0xff00
				this.timersGen[1].pivot |= value
				return
			case 0x3d:
				if (!this.timersGen.length) return
				this.timersGen[1].pivot &= 0x00ff
				this.timersGen[1].pivot |= value << 8
				return
			// 3e~3f unwritable
			// TODO: 256Hz timer
			// TODO?: unknown
			// General timer (final)
			case 0x48:
				this._writeTimerLoControl(2, value)
				return
			case 0x49:
				this._writeTimerHiControl(2, value)
				return
			case 0x4a:
				if (!this.timersGen.length) return
				this.timersGen[2].lo.preset = value
				return
			case 0x4b:
				if (!this.timersGen.length) return
				this.timersGen[2].hi.preset = value
				return
			case 0x4c:
				if (!this.timersGen.length) return
				this.timersGen[2].pivot &= 0xff00
				this.timersGen[2].pivot |= value
				return
			case 0x4d:
				if (!this.timersGen.length) return
				this.timersGen[2].pivot &= 0x00ff
				this.timersGen[2].pivot |= value << 8
				return
			// 4e~4f unwritable
			// TODO: input stuff?
			// 52~52 unwritable
			// TODO: I/O
			// Audio
			case 0x70:
				if (!this.audio) return
				if (value & 3) this.audio.volume = 0
				return
			case 0x71:
				if (!this.audio) return
				this.audio.volume = value & 3
			// TODO: PRC
			// TODO: pokemini debug
			// TODO: LCD
		}
	}

	private _writeTimerPrescale(idx: number, value: number) {
		if (!this.timersGen.length) return
		const tmr = this.timersGen[idx]
		tmr.hi.prescale = (value & 0xf0) >> 4
		tmr.lo.prescale = value & 0x0f
	}

	private _writeTimerOsc(idx: number, value: number) {
		if (!this.timersGen.length) return
		const tmr = this.timersGen[idx]
		tmr.hi.oscillator = (value & 0x02) >> 1
		tmr.lo.oscillator = value & 0x01
	}

	private _writeTimerLoControl(idx: number, value: number) {
		if (!this.timersGen.length) return
		const tmr = this.timersGen[idx]
		tmr.wideMode = !!(value & 0x80)
		tmr.lo.enabled = !!(value & 0x04)
		// TODO: reset, etc
	}

	private _writeTimerHiControl(idx: number, value: number) {
		if (!this.timersGen.length) return
		const tmr = this.timersGen[idx]
		tmr.hi.enabled = !!(value & 0x04)
		// TODO: reset, etc
	}
}
