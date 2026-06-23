import { SessionManager, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

type TerminalTarget = "auto" | "terminal" | "iterm" | "ghostty" | "print";

type ParsedArgs = {
	prompt: string;
	target: TerminalTarget;
};

const editorTextEnv = "PI_FORKOFF_EDITOR_TEXT_B64";
const forkNotice =
	"This session was opened by forkoff as an independent fork of another Pi session. Continue from the inherited context, but treat this branch as separate from its parent.";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		const encoded = process.env[editorTextEnv];
		if (!encoded || ctx.mode !== "tui") return;

		delete process.env[editorTextEnv];
		ctx.ui.setEditorText(Buffer.from(encoded, "base64").toString("utf8"));
		ctx.ui.notify("Forked session ready", "info");
	});

	pi.registerCommand("forkoff", {
		description: "Open a new terminal tab cloned from the current conversation branch",
		handler: async (args, ctx) => {
			await forkoff(pi, args, ctx);
		},
	});
}

async function forkoff(pi: ExtensionAPI, rawArgs: string, ctx: ExtensionCommandContext) {
	const parsed = parseArgs(rawArgs);
	if (parsed.prompt === "--help") {
		ctx.ui.notify("Usage: /forkoff [--terminal auto|iterm|terminal|ghostty|print] [prompt]", "info");
		return;
	}

	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile) {
		ctx.ui.notify("Current session is not persisted; cannot fork it", "error");
		return;
	}

	await ctx.waitForIdle();

	const leafId = ctx.sessionManager.getLeafId();
	const branchFile = leafId
		? createBranchedSession(ctx, sessionFile, leafId)
		: createEmptyFork(ctx, sessionFile);

	if (!branchFile) {
		ctx.ui.notify("Could not create forked session", "error");
		return;
	}

	const command = buildPiCommand(ctx.cwd, branchFile, parsed.prompt);
	const target = parsed.target === "auto" ? detectTerminal() : parsed.target;

	if (target === "print" || process.platform !== "darwin") {
		await ctx.ui.editor("Run this command", command);
		return;
	}

	const result = await openTerminal(pi, target, command);
	if (result.code !== 0) {
		throw new Error(result.stderr || result.stdout || `Failed to open ${target}`);
	}

	ctx.ui.notify(`Forked session opened in ${target}`, "info");
}

function createBranchedSession(ctx: ExtensionCommandContext, sessionFile: string, leafId: string): string | undefined {
	try {
		const branchFile = ctx.sessionManager.createBranchedSession(leafId);
		ctx.sessionManager.appendCustomMessageEntry("forkoff", forkNotice, false, {
			parentSession: sessionFile,
			forkedFromEntryId: leafId,
		});
		return branchFile;
	} finally {
		ctx.sessionManager.setSessionFile(sessionFile);
	}
}

function createEmptyFork(ctx: ExtensionCommandContext, sessionFile: string): string | undefined {
	const branch = SessionManager.create(ctx.cwd, ctx.sessionManager.getSessionDir(), { parentSession: sessionFile });
	branch.appendCustomMessageEntry("forkoff", forkNotice, false, { parentSession: sessionFile });
	return branch.getSessionFile();
}

function parseArgs(rawArgs: string): ParsedArgs {
	const words = rawArgs.trim().split(/\s+/).filter(Boolean);
	let target: TerminalTarget = "auto";
	let index = 0;

	while (index < words.length) {
		const word = words[index];
		if (word === "--terminal" || word === "--target") {
			target = parseTarget(words[index + 1] ?? "auto");
			index += 2;
			continue;
		}
		if (word.startsWith("--terminal=") || word.startsWith("--target=")) {
			target = parseTarget(word.slice(word.indexOf("=") + 1));
			index += 1;
			continue;
		}
		if (word === "--print") {
			target = "print";
			index += 1;
			continue;
		}
		break;
	}

	return { prompt: words.slice(index).join(" "), target };
}

function parseTarget(value: string): TerminalTarget {
	const normalized = value.toLowerCase();
	if (normalized === "iterm" || normalized === "iterm2") return "iterm";
	if (normalized === "terminal" || normalized === "terminal.app") return "terminal";
	if (normalized === "ghostty") return "ghostty";
	if (normalized === "print") return "print";
	return "auto";
}

function detectTerminal(): Exclude<TerminalTarget, "auto"> {
	const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase();
	if (termProgram.includes("iterm")) return "iterm";
	if (termProgram.includes("ghostty") || process.env.GHOSTTY_RESOURCES_DIR) return "ghostty";
	if (termProgram === "apple_terminal" || termProgram.includes("terminal")) return "terminal";
	return "terminal";
}

function buildPiCommand(cwd: string, sessionFile: string, prompt: string): string {
	const env = prompt ? `${editorTextEnv}=${shellQuote(Buffer.from(prompt, "utf8").toString("base64"))} ` : "";
	const name = prompt ? `forkoff: ${prompt.slice(0, 64)}` : "forkoff";
	return `cd ${shellQuote(cwd)} && ${env}pi --session ${shellQuote(sessionFile)} --name ${shellQuote(name)}`;
}

async function openTerminal(pi: ExtensionAPI, target: Exclude<TerminalTarget, "auto" | "print">, command: string) {
	if (target === "iterm") {
		return pi.exec("osascript", ["-e", itermScript(command)], { timeout: 10000 });
	}
	if (target === "ghostty") {
		return pi.exec("open", ["-na", "Ghostty", "--args", "-e", "/bin/zsh", "-lc", command], { timeout: 10000 });
	}
	return pi.exec("osascript", ["-e", terminalScript(command)], { timeout: 10000 });
}

function itermScript(command: string): string {
	const value = appleString(command);
	return `tell application "iTerm2"
	activate
	if (count of windows) = 0 then
		create window with default profile
	else
		tell current window
			create tab with default profile
		end tell
	end if
	tell current session of current window to write text ${value}
end tell`;
}

function terminalScript(command: string): string {
	const value = appleString(command);
	return `tell application "Terminal"
	activate
	if (count of windows) = 0 then
		do script ${value}
	else
		tell application "System Events" to keystroke "t" using command down
		delay 0.2
		do script ${value} in selected tab of front window
	end if
end tell`;
}

function appleString(value: string): string {
	return JSON.stringify(value);
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
