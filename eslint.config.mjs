/**
 * @fileoverview ESLint flat configuration.
 *
 * Two kinds of rule live here, and the distinction matters more than the rule
 * list. Most of this file is style and type safety. One block — the `domain/`
 * boundary — is architectural enforcement: build.md §H.2 states that a `domain/`
 * file importing from `lib/`, `app/`, or a framework is a build error, and
 * NFR 6 makes that boundary the reason the entire §F specification can be
 * verified in seconds with no network and no credential. Without a lint rule
 * that guarantee is an intention, and intentions decay silently.
 *
 * @see planning/build.md §H.2 — module boundaries
 * @see planning/build.md NFR 3 — no API token in the deployed system
 * @see planning/build.md NFR 6 — strict TypeScript, no `any`, no non-null assertion
 */
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';

/**
 * Import groups forbidden inside `src/domain/`.
 *
 * The domain layer is a pure function from `EmploymentRecord[]` to
 * `OrgSnapshot` (build.md §H.2). Each group below removes one way for that
 * purity to erode, and the messages name the consequence rather than the rule,
 * because the person who trips it is deciding whether to restructure or to
 * argue with the linter.
 */
const DOMAIN_FORBIDDEN_IMPORTS = [
  {
    group: ['next', 'next/*', 'react', 'react/*', 'react-dom', 'react-dom/*'],
    message:
      'domain/ must not import a framework. It stays renderer-agnostic so the §F guarantees can be tested with no DOM, and so another org-chart source needs only a new adapter.',
  },
  {
    group: ['node:*', 'fs', 'fs/*', 'path', 'http', 'https', 'crypto', 'os', 'child_process'],
    message:
      'domain/ performs no I/O. Reading a file or opening a socket here breaks the purity that makes the domain layer testable without a network or a credential.',
  },
  {
    group: [
      '@/lib/*',
      '@/app/*',
      '@/components/*',
      '**/lib/*',
      '**/app/*',
      '**/components/*',
    ],
    message:
      'domain/ must not import from lib/, app/, or components/. Dependencies point inward: the application consumes the domain, never the reverse (build.md §H.2).',
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'next-env.d.ts',
    // Specification and archived reference material. `planning/archived/` holds
    // configs copied from another project for comparison; they are documents
    // here, not sources, and linting them would report on decisions that were
    // never ours.
    'planning/**',
  ]),

  // ===========================================================================
  // Type-aware strictness — first-party TypeScript only
  //
  // Scoped to `src/` and `scripts/` rather than applied globally: type-aware
  // linting needs a program for every matched file, and config files at the
  // repository root are not part of one.
  // ===========================================================================
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    extends: [tseslint.configs.strictTypeChecked],
    rules: {
      // NFR 6, stated as two rules because each defeats the other's workaround.
      // Banning `any` alone leaves `!`; banning `!` alone leaves `as any`.
      // Together with noUncheckedIndexedAccess they make the compiler enforce
      // the null handling this system promises rather than merely describes.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',

      // The `IssueCode` union is a closed set of six values (build.md §F.1) and
      // `ReportingEdge.basis` is a closed set of five. This rule is what makes
      // "closed" mechanical: adding a variant breaks every switch that has not
      // handled it, at compile time, instead of falling through to a default.
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // `||` treats an empty string and 0 as absent; `??` does not. The §F.2
      // null tiers turn on exactly that distinction — a present-but-empty
      // job title is a different finding from a missing one.
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',

      // The sync script is the only async surface in the system and its failure
      // modes are the ones an operator sees on stderr (build.md §G.1). An
      // unawaited promise there loses the error entirely.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // delivery.md §2 fixes the exact exported signature of every domain and
      // lib module. Requiring the return type keeps the file and the manifest
      // in agreement rather than letting inference drift away from it.
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
        },
      ],

      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // `_`-prefixed bindings are intentionally unused. Mirrors the compiler's
      // noUnusedLocals / noUnusedParameters, which have no such escape hatch.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
    },
  },

  // ===========================================================================
  // The domain boundary — build.md §H.2
  //
  // This is the block the whole file exists for.
  // ===========================================================================
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: DOMAIN_FORBIDDEN_IMPORTS }],
    },
  },

  // ===========================================================================
  // The credential boundary — build.md NFR 3
  //
  // `scripts/sync.ts` reads the token from the environment. Nothing under
  // `src/` may, which is what makes "the deployed system holds no credential" a
  // property of the code rather than of the deployment configuration.
  // ===========================================================================
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'Only scripts/sync.ts reads the environment (build.md NFR 3). Application code that reads process.env gives the deployed system a credential to leak.',
        },
      ],
    },
  },

  // ===========================================================================
  // The network boundary — build.md §H.2
  //
  // `remote-client.ts` is imported by `scripts/` alone. The deployed app makes
  // no request at all, and this is what keeps that true as files are added.
  // ===========================================================================
  {
    files: ['src/app/**/*.ts', 'src/app/**/*.tsx', 'src/components/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/lib/remote-client', '**/lib/remote-client'],
              message:
                'remote-client.ts is imported by scripts/ only. The rendered application performs no network I/O — the chart comes from the committed snapshot (build.md §H.2, F8).',
            },
          ],
        },
      ],
    },
  },

  // ===========================================================================
  // React Server Components
  //
  // Next requires default exports from pages and layouts, and RSC pages are
  // async functions returning JSX, which `no-misused-promises` reads as a
  // misuse. Return-type annotations are relaxed here but not in `domain/` or
  // `lib/`: a component's return type is `JSX.Element` and says nothing, while
  // a domain function's return type is the contract in delivery.md §2.
  // ===========================================================================
  {
    files: ['src/app/**/*.tsx', 'src/components/**/*.tsx'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },

  // ===========================================================================
  // Tests
  //
  // Fixtures are loaded as `unknown` and narrowed by the schemas under test, so
  // the unsafe-* rules fire on the assertions themselves. Everything the tests
  // exercise is type-checked at its definition site.
  // ===========================================================================
  {
    files: ['src/**/__tests__/**/*.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
]);

export default eslintConfig;
