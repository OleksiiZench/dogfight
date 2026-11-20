import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: [
			"node_modules/**",
			"client/dist/**",
			"coverage/**",
			"playwright-report/**",
			"test-results/**",
			"docs/assets/**",
			"eslint.config.mjs",
		],
	},
	tseslint.configs.base,
	{
		files: ["**/*.ts", "**/*.mts"],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/no-misused-promises": "error",
		},
	},
);
