import { type ChildProcess, spawn } from "node:child_process";

const children: ChildProcess[] = [];

function run(workspace: string): ChildProcess {
	const child = spawn("npm", ["run", "dev", "--workspace", workspace], {
		stdio: "inherit",
		env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? "1" },
	});
	children.push(child);
	child.on("exit", (code, signal) => {
		if (shuttingDown) return;
		stop(signal ?? "SIGTERM", code ?? 0);
	});
	return child;
}

let shuttingDown = false;

function stop(signal: NodeJS.Signals = "SIGTERM", code = 0): void {
	if (shuttingDown) return;
	shuttingDown = true;
	for (const child of children) {
		if (child.exitCode === null) child.kill(signal);
	}
	const timer: NodeJS.Timeout = setTimeout(() => process.exit(code), 50);
	timer.unref();
}

run("dogfight-server");
run("dogfight-client");

const signals: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
for (const signal of signals) {
	process.on(signal, () => stop(signal, 0));
}
