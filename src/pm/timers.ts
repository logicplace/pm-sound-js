import { capU32 } from "./util"

const CalculateDecOsc1 = [
	// Osc1 disabled
	0, 0, 0, 0, 0, 0, 0, 0,
	// Osc1 enabled
	(0x1000000/2),     // 2000000 Hz
	(0x1000000/8),     //  500000 Hz
	(0x1000000/32),    //  125000 Hz
	(0x1000000/64),    //   62500 Hz
	(0x1000000/128),   //   31250 Hz
	(0x1000000/256),   //   15625 Hz
	(0x1000000/1024),  //    3906.25 Hz
	(0x1000000/4096),  //     976.5625 Hz
]

const CalculateDecOsc2 = [
	// Osc2 disabled
	0, 0, 0, 0, 0, 0, 0, 0,
	// Osc2 enabled (Aproximate values)
	(0x1000000/122),   // 32768 Hz
	(0x1000000/244),   // 16384 Hz
	(0x1000000/488),   //  8192 Hz
	(0x1000000/977),   //  4096 Hz
	(0x1000000/1953),  //  2048 Hz
	(0x1000000/3906),  //  1024 Hz
	(0x1000000/7812),  //   512 Hz
	(0x1000000/15625)  //   256 Hz
]

const Timer256Inc = 0x1000000/15625  // Aproximate value of 256Hz Timer (256 Hz)

class _GeneralTimerByte {
	preset: number = 0xff
	count: number = 0
	_enabled: boolean = false
	_prescale: number = 0
	_oscillator: number = 0
	onUnderflow?: () => void

	_dec: number = 0

	constructor(init?: Partial<_GeneralTimerByte>) {
		Object.assign(this, init)
		this.enabled = this._enabled
		this.prescale = this._prescale
		this.oscillator = this._oscillator
	}

	private _updateDec() {
		if (this._enabled) {
			this._dec = (
				this._oscillator ? CalculateDecOsc2 : CalculateDecOsc1
			)[this._prescale]
		}
		else {
			this._dec = 0
		}
	}

	get enabled() {
		return this._enabled
	}

	set enabled(b: boolean) {
		this._enabled = !!b
		this._updateDec()
	}

	get prescale() {
		return this._prescale
	}

	set prescale(i: number) {
		this._prescale = i
		this._updateDec()
	}

	get oscillator() {
		return this._oscillator
	}

	set oscillator(i: number) {
		this._oscillator = i & 1
		this._updateDec()
	}
}

export class GeneralTimer {
	wideMode: boolean = false
	pivot: number = 0
	hi: _GeneralTimerByte
	lo: _GeneralTimerByte
	onPivot?: () => void

	constructor(init?: Partial<_GeneralTimerByte>) {
		Object.assign(this, init)
		this.hi = new _GeneralTimerByte()
		this.lo = new _GeneralTimerByte()
	}

	public sync(cycles: number) {
		if (this.wideMode) {
			if (this.lo.enabled) {
				let precount = this.lo.count >>> 24
				this.lo.count -= this.lo._dec * cycles
				if (this.lo.count < 0) {
					this.hi.count -= 0x01000000
					if (this.hi.count < 0) {
						this.lo.count = capU32(this.lo.preset << 24)
						this.hi.count = capU32(this.hi.preset << 24)
						if (this.hi.onUnderflow)
							this.hi.onUnderflow()
					}
					else
						this.lo.count = capU32(this.lo.count)
				}
				if (this.onPivot) {
					// idk why pokemini does this
					let count = (this.hi.count >>> 16) & 0xff00
					precount |= count
					count = capU32(count | (this.lo.count >>> 24))
					if (precount > this.pivot && count <= this.pivot) {
						this.onPivot()
					}
				}
			}
		}
		else {
			if (this.lo.enabled) {
				this.lo.count -= this.lo._dec * cycles
				if (this.lo.count < 0) {
					this.lo.count = capU32(this.lo.preset << 24)
					if (this.lo.onUnderflow)
						this.lo.onUnderflow()
				}
			}
			if (this.hi.enabled) {
				let precount = (this.hi.count >>> 16) & 0xff00
				this.hi.count -= this.hi._dec * cycles
				if (this.hi.count < 0) {
					this.hi.count = capU32(this.hi.preset << 24)
					if (this.hi.onUnderflow)
						this.hi.onUnderflow()
				}
				if (this.onPivot) {
					// idk why pokemini does this
					let count = this.lo.count >>> 24
					precount |= count
					count = capU32(count | (this.hi.count >>> 16) & 0xff00)
					if (precount > this.pivot && count <= this.pivot) {
						this.onPivot()
					}
				}
			}
		}
	}

	get preset() {
		return (this.hi.preset << 8) | this.lo.preset
	}

	get count() {
		return this.lo.count >>> 24 | ((this.hi.count >>> 24) << 8)
	}
}
