# PMSound

## CLI

To see usage use: `npx pmsound -h`

If you're running from this repo use `npx . -h` instead.

The CLI works via subcommands, explained by sections below.

### compile

Compile a `.pmmusic` file.

```sh
npx pmsound compile my.pmmusic -o build -a --pmas
```

* `-o`/`--out` - specify output file or directory
  * in the case of a directory name, it uses the filename from the `.pmmusic` file
* `-a`/`--all` - compile all BGMs and sound effects
* `-b`/`--bgm` - specify BGM(s) to compile by name
* `-s`/`--sfx` - specify sound effect(s) to compile by name
* `--pmas` - output in PMAS assembly
  * default extension for this format is `.asm`

### play

Play a sound from a `.pmmusic` file

```sh
npx pmsound compile my.pmmusic nameOfSound
```

* `-s`/`--sound` - pick the sound engine to use
  * these are the same as pokemini's options,
    technical details provided for those interested but are not important to know
  * `direct` - (default) outputs volume level when pivot is triggered
  * `emulated` - emulates the oscillators to decide output
  * `direct_pwm` - similar to `direct` but adjusted by PWM simulation
* `--no-piezo` - disable piezo filter
