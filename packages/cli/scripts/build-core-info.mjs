import { readFile, writeFile } from 'node:fs/promises';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const release = JSON.parse(await readFile(new URL('../core-release.json', import.meta.url), 'utf8'));
const info = { version: pkg.version, ...release };
await writeFile(new URL('../dist/core/build-info.js', import.meta.url), `// Generated from package.json and core-release.json during the build.\nexport const coreInfo = Object.freeze(${JSON.stringify(info)});\n`);
await writeFile(new URL('../dist/core/build-info.d.ts', import.meta.url), 'export declare const coreInfo: Readonly<{ version: string; protocol: 1; contractVersion: number; docsVersion: string }>;\n');
