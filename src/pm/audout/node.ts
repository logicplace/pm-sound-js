import Speaker from "@browserbox/speaker";
import { AUDIO_FREQ, Sink } from "../audio"

export class SpeakerSink extends Sink {
	private buffer?: Buffer
	private speaker?: Speaker

	public open() {
		this.speaker = new Speaker({
			channels: 1,
			bitDepth: 16,
			sampleRate: AUDIO_FREQ,
			float: false,
		})
		this.writable = true
		this.speaker.addListener("drain", () => {this.writable = true})
	}

	public async close() {
		await new Promise<void>(r => {
			this.speaker?.once("finish", () => {
				this.speaker?.close(true)
				r()
			})
			this.speaker?.end()
		})
	}

	public getBuffer() {
		this.buffer = Buffer.alloc(Int16Array.BYTES_PER_ELEMENT * 2048)
		return new Int16Array(this.buffer.buffer)
	}

	public commitBuffer() {
		if (this.buffer) {
			if (!this.speaker?.write(this.buffer))
				this.writable = false
		}
	}
}
