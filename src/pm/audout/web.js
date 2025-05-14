export class AudioContextSink {
	constructor (cb) {
		this.callback = cb
	}

	open() {
		this.ac = new AudioContext()
		
	}
}
