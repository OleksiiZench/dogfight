import { spawn } from "node:child_process";

const children = [];

function run(workspace) {
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

function stop(signal = "SIGTERM", code = 0) {
	if (shuttingDown) return;
	shuttingDown = true;
	for (const child of children) {
		if (child.exitCode === null) child.kill(signal);
	}
	setTimeout(() => process.exit(code), 50).unref();
}

run("dogfight-server");
run("dogfight-client");

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => stop(signal, 0));
}
