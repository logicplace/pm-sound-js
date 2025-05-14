declare module "@browserbox/speaker" {
	import { Writable, WritableOptions } from "stream"
	interface Format {
		bitDepth: number
		float?: boolean
		signed?: boolean
	}

	interface Opts extends WritableOptions {
		lowWaterMark?: number
		highWaterMark?: number
		channels?: number
		bitDepth?: number
		sampleRate?: number
		float?: boolean
		signed?: boolean
		samplesPerFrame?: number
		device?: string
		endianness?: "BE"|"LE"
	}

	class Speaker extends Writable {
		channels?: number
		bitDepth?: number
		sampleRate?: number
		float?: boolean
		signed?: boolean
		samplesPerFrame: number
		device?: string|null
		endianness?: "BE"|"LE"

		constructor(init: Opts)
		close(flush?: boolean): void

		static api_version: string
		static description: string
		static module_name: string
		static getFormat(format: Format): number
		static isSupported(format: number): boolean
	}

	export = Speaker
}
