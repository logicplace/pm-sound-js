import { GeneralTimer } from "./timers"
import { capU32, EmptyError, undefinedThrowsEmpty } from "./util"

export const AUDIO_FREQ = 44100
const AUDIO_CONV = (0x7fffffff / AUDIO_FREQ * 2)
const AUDIO_INC = 184969
export const SOUNDBUFFER = 2048

const AUDIO_PWM_RAG = 8191

const CountFreqOsc1 = [
	// Osc1 disabled
	1, 0, 0, 0, 0, 0, 0, 0,
	// Osc1 enabled
	(4000000/2),     // 2000000 Hz
	(4000000/8),     //  500000 Hz
	(4000000/32),    //  125000 Hz
	(4000000/64),    //   62500 Hz
	(4000000/128),   //   31250 Hz
	(4000000/256),   //   15625 Hz
	(4000000/1024),  //    3906.25 Hz
	(4000000/4096),  //     976.5625 Hz
]

const CountFreqOsc2 = [
	// Osc2 disabled
	0, 0, 0, 0, 0, 0, 0, 0,
	// Osc2 enabled
	(32768/1),   // 32768 Hz
	(32768/2),   // 16384 Hz
	(32768/4),   //  8192 Hz
	(32768/8),   //  4096 Hz
	(32768/16),  //  2048 Hz
	(32768/32),  //  1024 Hz
	(32768/64),  //   512 Hz
	(32768/128)  //   256 Hz
]

export enum SoundEngine {
	disabled = 0,
	generated,
	direct,
	emulated,
	directPWM,
}

export enum Filter {
	disabled = 0,
	piezo,
}

export class Audio {
	tmr3: GeneralTimer
	requireSoundSync: boolean
	private audioProcess?: ()=>number
	private filterer: (n:number)=>number
	private _volume: number = 0x4000
	private pwmMul: number = 2

	private fifo: number[]
	private fifoThreshold: number
	private audioCycleCount: number = 0
	private audioSampleCount: number = 0

	private engine: SoundEngine
	private hpSamples: number[]
	private lpSamples: number[]

	constructor (tmr3: GeneralTimer) {
		this.tmr3 = tmr3
		this.engine = SoundEngine.direct
		this.requireSoundSync = true
		this.audioProcess = this.audioProcessDirect
		this.filterer = this.piezoFilter

		const fifosize = SOUNDBUFFER * 4
		this.fifo = new Array()
		this.fifoThreshold = (fifosize * 3) >> 1

		// shut up typescript
		this.hpSamples = [0, 0, 0, 0]
		this.lpSamples = [0, 0, 0, 0]
	}

	public changeEngine(engine: SoundEngine) {
		switch(engine) {
			case SoundEngine.direct:
				this.requireSoundSync = true
				this.audioProcess = this.audioProcessDirect
				break
			case SoundEngine.emulated:
				this.requireSoundSync = true
				this.audioProcess = this.audioProcessEmulated
				break
			case SoundEngine.directPWM:
				this.requireSoundSync = true
				this.audioProcess = this.audioProcessDirectPWM
				break
			default:
				engine = SoundEngine.generated
				this.requireSoundSync = false
				this.audioProcess = undefined
		}
		this.engine = engine
	}

	public changeFilter(filter: Filter) {
		switch(filter) {
			case Filter.piezo:
				this.hpSamples = [0, 0, 0, 0]
				this.lpSamples = [0, 0, 0, 0]
				this.filterer = this.piezoFilter
				break
			default:
				this.filterer = this.noFilter
		}
	}

	get volume() {
		return this._volume
	}

	set volume(volume: number) {
		this._volume = [0, 0x2000, 0x2000, 0x4000][volume]
		this.pwmMul = [0, 1, 1, 2][volume]
	}

	public sync(cycles: number) {
		// Process single audio sample
		this.audioCycleCount += Math.trunc(AUDIO_INC * cycles)
		if (this.audioCycleCount >= 0x01000000) {
			this.audioCycleCount -= 0x01000000
			if (this.audioProcess)
				this.fifo.push(this.filterer(this.audioProcess()))
		}
	}

	public syncWithAudio() {
		if (!this.requireSoundSync) return false
		return this.fifo.length >= this.fifoThreshold
	}

	public getSamplesS16() {
		if (this.engine == SoundEngine.generated)
			return this.generateEmulatedS16()
		return undefinedThrowsEmpty(Array.prototype.shift.bind(this.fifo))
	}

	public generateEmulatedS16() {
		let [soundFrequency, pulseWidth] = this.getEmulated()
		return () => {
			if (50 <= soundFrequency && soundFrequency < 20000) {
				this.audioSampleCount += Math.trunc(soundFrequency * AUDIO_CONV)
				if (capU32(this.audioSampleCount & 0xfff00000) >= capU32(pulseWidth << 20))
					return this.filterer(this.volume)
			}
			return this.filterer(0)
		}
	}

	public getEmulated() {
		const tmr3Freq = (
			this.tmr3.lo.enabled
			? (
				this.tmr3.lo.oscillator
				? CountFreqOsc2
				: CountFreqOsc1
			)[this.tmr3.lo.prescale]
			: 0
		)

		// TODO: 0 if selected oscillator is disabled

		if (tmr3Freq) {
			const presetValue = this.tmr3.preset

			// Calculate sound frequency
			const soundFrequency = Math.trunc(tmr3Freq / (presetValue + 1))

			// ... and pulse width
			const pulseWidth = presetValue ? (
				Math.max(0, 4095 - Math.trunc(this.tmr3.pivot * 4096 / presetValue))
			) : 0
			return [soundFrequency, pulseWidth]
		}
		return [0, 0]
	}

	public audioProcessDirect() {
		if (this.tmr3.count <= this.tmr3.pivot)
			return this.volume
		return 0
	}

	public audioProcessEmulated() {
		let [soundFrequency, pulseWidth] = this.getEmulated()
		if (soundFrequency < 50)
			// Silence
			return 0
		else if (soundFrequency < 20000) {
			// Normal
			this.audioSampleCount -= Math.trunc(soundFrequency * AUDIO_CONV)
			if (capU32(this.audioSampleCount & 0xfff00000) >= capU32(pulseWidth << 20))
				return this.volume
			return 0
		}
		// PWM
		return (Math.min(0xfff, pulseWidth) << 2) * this.pwmMul
	}
	
	public audioProcessDirectPWM() {
		let tmrCount = this.tmr3.count
		const tmrPre = this.tmr3.preset

		// Affect sound based off PWM
		let pwm = tmrPre ? Math.trunc(this.tmr3.pivot * AUDIO_PWM_RAG / tmrPre) : 0
		if (pwm > AUDIO_PWM_RAG)
			// Avoid clipping
			pwm = AUDIO_PWM_RAG - 1
		if (tmrPre < 128)
			tmrCount = 0

		// Output
		if (tmrCount <= this.tmr3.pivot)
			return this.volume + pwm * this.pwmMul
		return pwm * this.pwmMul
	}

	public noFilter(sample: number) {
		return Math.max(-32768, Math.min(32767, sample))
	}

	public piezoFilter(sample: number) {
		const HP_pCoeff = 40960
		const LP_pCoeff = 4096
		const LP_nCoeff = (65535 - LP_pCoeff)

		const hpSamples = this.hpSamples
		const lpSamples = this.lpSamples
		
		// High pass to simulate a piezo crystal speaker
		const prev = [...hpSamples]
		hpSamples[0] = sample
		hpSamples[1] = (HP_pCoeff * (hpSamples[0] + prev[1] - prev[0])) >> 16
		hpSamples[2] = (HP_pCoeff * (hpSamples[1] + prev[2] - prev[1])) >> 16
		hpSamples[3] = (HP_pCoeff * (hpSamples[2] + prev[3] - prev[2])) >> 16

		// Amplify by 4
		sample = Math.max(-32768, Math.min(32767, hpSamples[3] << 2))

		// Low pass to kill the spikes in sound
		lpSamples[0] = sample
		lpSamples[1] = (lpSamples[1] * LP_pCoeff + lpSamples[0] * LP_nCoeff) >> 16
		lpSamples[2] = (lpSamples[2] * LP_pCoeff + lpSamples[1] * LP_nCoeff) >> 16
		lpSamples[3] = (lpSamples[3] * LP_pCoeff + lpSamples[2] * LP_nCoeff) >> 16

		// Amplify by 2, clamp and output
		return Math.max(-32768, Math.min(32767, lpSamples[3] << 1))
	}

	public getNextAs(frames: number, ...out: (Int16Array|Float64Array)[]) {
		const gen = this.getSamplesS16()
		const out16s: Int16Array[] = []
		const outFs: Float64Array[] = []
		if (!out.length)
			out16s.push(new Int16Array(frames))
		else {
			for (const o of out) {
				if (o instanceof Int16Array) out16s.push(o)
				else if (o instanceof Float64Array) outFs.push(o)
			}
		}

		let i: number, empty = false
		for (i = 0; i < frames; ++i) {
			try {
				const d = gen()
				for (const o of out16s) o[i] = d
				for (const o of outFs) o[i] = d / 32768
			}
			catch (err) {
				if (err instanceof EmptyError) {
					empty = true
					break
				}
			}
		}
		if (empty) {
			for (let j = i; j < frames; ++j) {
				for (const o of out) o[j] = 0
			}
		}
		return [out, i, empty]
	}

	public hasMoreToPlay() {
		return !!this.fifo.length
	}
}

export abstract class Sink {
	public writable: boolean = true

	public abstract open(): void
	public abstract close(): void
	public abstract getBuffer(): Int16Array|Float64Array
	public commitBuffer() {}
}

export abstract class Player {
	audio: Audio
	protected sinks: Sink[]

	constructor (audio: Audio) {
		this.audio = audio
		this.sinks = []
	}

	public addSink(sink: Sink) {
		this.sinks.push(sink)
	}

	public audioFill() {
		const bufs: (Int16Array|Float64Array)[] = []
		let lowestFrames = Number.POSITIVE_INFINITY
		for (const s of this.sinks) {
			const buf = s.getBuffer()
			bufs.push(buf)
			if (buf.length < lowestFrames)
				lowestFrames = buf.length
		}
		if (SOUNDBUFFER < lowestFrames)
			lowestFrames = SOUNDBUFFER
		this.audio.getNextAs(lowestFrames, ...bufs)
		for (const s of this.sinks)
			s.commitBuffer()
	}

	public abstract emulate(cycles: number): boolean

	public sync() {
		return this.audio.syncWithAudio()
	}

	public async play() {
		for (let s of this.sinks) {
			s.open()
		}

		let cont = true
		const cycles = Math.trunc(4000000 / 72)
		while (cont) {
			cont = this.emulate(cycles)

			while (!cont || this.sync()) {
				let writable = true
				for (const s of this.sinks)
					if (!s.writable) {
						writable = false
						break
					}
				if (writable) this.audioFill()
				if (!cont && !this.audio.hasMoreToPlay()) break;
				await new Promise(r => setTimeout(r, 1));
			}
		}

		for (let s of this.sinks) {
			s.close()
		}
	}
}
