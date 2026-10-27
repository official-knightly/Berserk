/* tslint:disable */
/* eslint-disable */

export class Engine {
    free(): void;
    [Symbol.dispose](): void;
    evaluate(): number;
    fen(): string;
    go_movetime(ms: number, multi_pv: number, on_info?: Function | null): void;
    go_uci(depth: number, nodes: number, multi_pv: number, on_info?: Function | null): void;
    last_bestmove(): string;
    last_depth(): number;
    last_nodes(): bigint;
    last_score(): number;
    make_move(uci_move: string): void;
    constructor();
    reset(): void;
    set_dispatch(dispatch?: Function | null): void;
    set_position(fen: string): void;
    set_threads(n: number): void;
    take_output(): string;
}

export function run_helper_thread(ptr: number, thread_count: number): void;
