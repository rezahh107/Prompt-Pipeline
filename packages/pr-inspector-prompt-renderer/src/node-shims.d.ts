declare module "node:fs" { export const readFileSync: any; export const writeFileSync: any; export const mkdirSync: any; export const rmSync: any; export const cpSync: any; export const readdirSync: any; export const statSync: any; }
declare module "node:path" { export const dirname: any; export const join: any; export const resolve: any; export const basename: any; }
declare module "node:url" { export const fileURLToPath: any; }
declare module "node:crypto" { export const createHash: any; }
declare module "node:child_process" { export const execFileSync: any; export const spawnSync: any; }
declare const process: any;
declare const Buffer: any;
