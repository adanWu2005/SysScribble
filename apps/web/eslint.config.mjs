import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

const config = [
  { ignores: ['.next/', 'node_modules/', 'next-env.d.ts'] },
  ...nextCoreWebVitals,
  {
    rules: {
      'react/no-danger': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Never render raw HTML. Use text nodes or sanitize() from @/lib/sanitize (PRD §5.5).',
        },
      ],
    },
  },
];

export default config;
