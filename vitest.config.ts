import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			{
				extends: false,
				root: "./client",
				test: {
					name: "client",
					include: ["test/**/*.test.ts"],
					environment: "node",
				},
			},
			{
				extends: false,
				root: "./server",
				test: {
					name: "server",
					include: ["test/**/*.test.ts"],
					environment: "node",
				},
			},
			{
				extends: false,
				root: "./shared",
				test: {
					name: "shared",
					include: ["test/**/*.test.ts"],
					environment: "node",
				},
			},
		],
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary", "html"],
			reportsDirectory: "coverage",
			include: ["shared/src/**/*.ts"],
			thresholds: {
				statements: 85,
				branches: 85,
				functions: 85,
				lines: 85,
			},
		},
	},
});
