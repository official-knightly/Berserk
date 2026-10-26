// Runner/build support for Berserk's precomputed lookup tables.
// This helper is stored under wasm/ because build/attacks.rs is missing
// from the current repository source. Copy it to build/attacks.rs only when
// rebuilding the WebAssembly target.

#[derive(Copy, Clone)]
pub enum Color {
    White,
    Black,
}

pub fn king_attacks(square: u8) -> u64 {
    let file = (square % 8) as i8;
    let rank = (square / 8) as i8;
    let mut attacks = 0u64;

    for df in -1..=1 {
        for dr in -1..=1 {
            if df == 0 && dr == 0 {
                continue;
            }
            let f = file + df;
            let r = rank + dr;
            if (0..8).contains(&f) && (0..8).contains(&r) {
                attacks |= 1u64 << (r * 8 + f);
            }
        }
    }
    attacks
}

pub fn knight_attacks(square: u8) -> u64 {
    let file = (square % 8) as i8;
    let rank = (square / 8) as i8;
    let offsets: [(i8, i8); 8] = [
        (1, 2), (2, 1), (2, -1), (1, -2),
        (-1, -2), (-2, -1), (-2, 1), (-1, 2),
    ];
    let mut attacks = 0u64;
    for (df, dr) in offsets {
        let f = file + df;
        let r = rank + dr;
        if (0..8).contains(&f) && (0..8).contains(&r) {
            attacks |= 1u64 << (r * 8 + f);
        }
    }
    attacks
}

pub fn pawn_attacks(square: u8, color: Color) -> u64 {
    let file = (square % 8) as i8;
    let rank = (square / 8) as i8;
    let step = match color {
        Color::White => 1,
        Color::Black => -1,
    };
    let mut attacks = 0u64;
    for df in [-1, 1] {
        let f = file + df;
        let r = rank + step;
        if (0..8).contains(&f) && (0..8).contains(&r) {
            attacks |= 1u64 << (r * 8 + f);
        }
    }
    attacks
}

pub fn sliding_attacks(square: u8, occupancies: u64, directions: &[i8]) -> u64 {
    let file = (square % 8) as i8;
    let rank = (square / 8) as i8;
    let mut attacks = 0u64;

    for direction in directions {
        let (df, dr) = match *direction {
            8 => (0, 1),
            -8 => (0, -1),
            1 => (1, 0),
            -1 => (-1, 0),
            9 => (1, 1),
            -9 => (-1, -1),
            7 => (-1, 1),
            -7 => (1, -1),
            _ => continue,
        };
        let mut f = file + df;
        let mut r = rank + dr;
        while (0..8).contains(&f) && (0..8).contains(&r) {
            let bit = 1u64 << (r * 8 + f);
            attacks |= bit;
            if occupancies & bit != 0 {
                break;
            }
            f += df;
            r += dr;
        }
    }
    attacks
}

pub fn generate_ray(square1: u8, square2: u8, between_only: bool) -> u64 {
    let f1 = (square1 % 8) as i8;
    let r1 = (square1 / 8) as i8;
    let f2 = (square2 % 8) as i8;
    let r2 = (square2 / 8) as i8;
    let df = f2 - f1;
    let dr = r2 - r1;

    if square1 == square2 {
        return if between_only { 0 } else { 1u64 << square1 };
    }
    if !(df == 0 || dr == 0 || df.abs() == dr.abs()) {
        return 0;
    }

    let sf = df.signum();
    let sr = dr.signum();
    if between_only {
        let mut f = f1 + sf;
        let mut r = r1 + sr;
        let mut result = 0u64;
        while f != f2 || r != r2 {
            if !(0..8).contains(&f) || !(0..8).contains(&r) {
                return 0;
            }
            result |= 1u64 << (r * 8 + f);
            f += sf;
            r += sr;
        }
        return result;
    }

    // Full aligned line, including both endpoints and extending to both edges.
    let mut result = 0u64;
    let mut f = f1;
    let mut r = r1;
    while (0..8).contains(&f) && (0..8).contains(&r) {
        result |= 1u64 << (r * 8 + f);
        f -= sf;
        r -= sr;
    }
    let mut f = f1 + sf;
    let mut r = r1 + sr;
    while (0..8).contains(&f) && (0..8).contains(&r) {
        result |= 1u64 << (r * 8 + f);
        f += sf;
        r += sr;
    }
    result
}
