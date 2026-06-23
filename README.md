# forkoff

A Pi extension that opens a cloned conversation branch in a new terminal tab, so the main session stays usable while the fork goes its own way.

## Install

```sh
pi install git:github.com/maxsumrall/forkoff
```

For local development:

```sh
pi install /Users/max/code/forkoff
```

Then reload Pi:

```text
/reload
```

## Usage

```text
/forkoff
/forkoff fix the build
/forkoff --terminal iterm fix the build
/forkoff --terminal terminal fix the build
/forkoff --terminal ghostty fix the build
/forkoff --print fix the build
```

`/forkoff` clones the current active branch into a new session file and opens it in a new terminal. If text is provided, the new Pi editor is prefilled with that text but not submitted.

## Terminal support

By default, forkoff detects the current terminal from environment variables and supports:

- iTerm2
- Terminal.app
- Ghostty

On non-macOS systems, or with `--print`, forkoff shows the command to run manually.
