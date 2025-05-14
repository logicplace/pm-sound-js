class Worker extends AudioWorkletProcessor {
	constructor () {
		super({
			numberOfOutputs: 1,
			outputChannelCount: [1],
		})

		this.samples = []
		this.sampleRate = 44100
		this.cont = true

		this.port.onmessage = (event) => {
			if (event.data.out)
				this.samples.push(...event.data.out)
			this.cont = event.data.cont
		}
	}

	process(inputs, outputs, parameters) {
		const output = outputs[0];
		const channel = output[0];

		for (let i = 0; i < channel.length; i++) {
			channel[i] = this.samples.shift()
		}

		return this.cont
	}
}

registerProcessor("out-worker", Worker);
