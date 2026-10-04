// Browser stand-ins for the node: modules am.mjs imports for its CLI. Never called by the renderer.
const no = () => { throw new Error("not available in the browser"); };
export const parseArgs = no, readFileSync = no, writeFileSync = no, mkdirSync = no, rmSync = no, spawn = no, realpathSync = no, fileURLToPath = no;
export const existsSync = () => false, homedir = () => "", join = (...p) => p.join("/"), resolve = (...p) => p.join("/"), dirname = (p) => String(p).replace(/\/[^/]*$/, "");
export default {};
