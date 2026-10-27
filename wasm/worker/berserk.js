/* @ts-self-types="./berserk.d.ts" */
import * as wasm from "./berserk_bg.wasm";
import { __wbg_set_wasm } from "./berserk_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    Engine, run_helper_thread
} from "./berserk_bg.js";
