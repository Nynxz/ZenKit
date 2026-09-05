// ESLint flat config for the whole monorepo — one file, every package.
//
// A single root config rather than one per package: the packages share a language, a framework and
// a set of conventions, so duplicating configs would only create more chances to drift. Flat
// config's `files` globs express per-area differences (browser vs node globals, declaration shims).
//
// Division of labour: ESLint catches BUGS, Prettier owns FORMATTING (see .prettierrc.json). The
// `prettier` config goes last and switches off every rule that would argue with the formatter.

import { defineConfig, globalIgnores } from 'eslint/config'
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import prettier from 'eslint-config-prettier/flat'
import globals from 'globals'

export default defineConfig(
  // Build output and deps — never our source. `js/` and `web/` are where the plugins emit their
  // ComfyUI bundles; theme JSON is generated.
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/web/**',
    '**/js/**',
    '**/.vite/**',
    'themes/**',
    'plugins/*/themes/**',
    '**/*.tsbuildinfo',
    // Internal working notes, never committed.
    'internal/**',
  ]),

  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  // `essential` = Vue's error-prevention rules only. The `recommended` tier adds
  // attribute-formatting opinions (one attribute per line, self-closing style) that belong to a
  // formatter, not a linter — the same split as ruff lint vs `ruff format` on the Python side.
  ...pluginVue.configs['flat/essential'],

  {
    // vue-eslint-parser handles the SFC; hand its <script> blocks to the TS parser.
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },

  {
    // TypeScript-wide rule corrections. These aren't preferences — `no-undef` and core
    // `no-unused-vars` predate TS and get it wrong.
    files: ['**/*.{ts,mts,cts,vue}'],
    rules: {
      // `no-undef` cannot see TYPE-only globals, so it reports `ParentNode`, `EventListener` and
      // friends as undefined when they are perfectly valid DOM types. TypeScript already errors on
      // genuinely undefined identifiers, so the rule is pure noise here — turning it off in TS is
      // typescript-eslint's own documented recommendation.
      'no-undef': 'off',
      // Allow the `_unused` convention for deliberately-ignored parameters and catch bindings.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          // Destructuring to OMIT keys — `const { id, open, ...rest } = p` — is the idiomatic way
          // to build a filtered object. The named keys are meant to be discarded, so they aren't
          // "unused variables"; without this the pattern can't be written at all.
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  {
    // Everything under src/ runs in the browser (ComfyUI's page, or a plugin panel).
    files: ['**/src/**/*.{ts,vue}'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // ComfyUI's frontend surface is largely untyped: route responses, litegraph nodes and node
      // `output` records all arrive as `any`, and coercing at those boundaries is idiomatic. Kept
      // visible as a warning rather than a failure.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  {
    // Build configs and authoring scripts run in Node; console/process are the interface there.
    files: [
      '**/*.{mts,cts}',
      '**/*.config.{js,ts,mts}',
      'workspace-aliases.ts',
      'internal/**/*.mjs',
    ],
    languageOptions: { globals: { ...globals.node } },
  },

  {
    // A plugin's root component is namespaced by the PLUGIN, so `Launcher.vue` inside
    // ComfyUI-ZenFlow is unambiguous — the same reasoning as Next.js's `page.tsx`. The rule guards
    // against a globally-registered one-word component colliding with a future HTML element, which
    // cannot happen here: these are imported by path and mounted directly.
    files: ['plugins/*/src/*.vue'],
    rules: { 'vue/multi-word-component-names': 'off' },
  },

  {
    // Declaration shims. `declare module '*.vue'` with `DefineComponent<{}, {}, any>` is Vite's own
    // recommended boilerplate — both rules fire on it by design.
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Last: switch off anything that would fight Prettier.
  prettier,
)
