use super::attacks::*;

pub fn generate_king_map() -> [u64; 64] {
    generate_map(king_attacks)
}

pub fn generate_knight_map() -> [u64; 64] {
    generate_map(knight_attacks)
}

fn generate_map<F: Fn(u8) -> u64>(f: F) -> [u64; 64] {
    let mut map = [0; 64];
    for square in 0..64 {
        map[square as usize] = f(square as u8);
    }
    map
}

pub fn generate_between_map() -> [[u64; 64]; 64] {
    std::array::from_fn(|square| {
        generate_map(|target| generate_ray(square as u8, target as u8, true))
    })
}

pub fn generate_rays_map() -> [[u64; 64]; 64] {
    std::array::from_fn(|square| {
        generate_map(|target| generate_ray(square as u8, target as u8, false))
    })
}

pub fn generate_pawn_map() -> [[u64; 64]; 2] {
    [
        generate_map(|square| pawn_attacks(square, Color::White)),
        generate_map(|square| pawn_attacks(square, Color::Black)),
    ]
}

pub fn generate_diagonal_tables() -> [[u64; 2]; 64] {
    std::array::from_fn(|square| {
        [
            generate_map(|_| sliding_attacks(square as u8, 0, &[9, -9])),
            generate_map(|_| sliding_attacks(square as u8, 0, &[7, -7])),
        ]
    })
}

pub fn generate_rook_map() -> Vec<u64> {
    generate_sliding_map(ROOK_MASK, &ROOK_MAGIC_SQUARES, &[8, -8, 1, -1])
}

pub fn generate_bishop_map() -> Vec<u64> {
    generate_sliding_map(BISHOP_MASK, &BISHOP_MAGIC_SQUARES, &[9, -9, 7, -7])
}

pub fn generate_sliding_map(size: usize, magics: &[MagicEntry], directions: &[i8]) -> Vec<u64> {
    let mut map = vec![0; size];
    for square in 0..64 {
        let entry = &magics[square];
        let occupancies = entry.mask;
        let mut hash = 0u64;
        for _ in 0..get_permutation_count(entry.mask) {
            let value = sliding_attacks(square as u8, occupancies, directions);
            map[hash as usize] = value;
            occupancies = occupancies.wrapping_sub(entry.mask) & entry.mask;
            hash += 1;
        }
    }
    map
}

const fn get_permutation_count(mask: u64) -> u64 {
    1u64 << mask.count_ones()
}

const ROOK_MASK: usize = 64;
const BISHOP_MASK: usize = 64;
const ROOK_MAGIC_SQUARES: [MagicEntry; 64] = [MagicEntry { mask: 0, magic: 0, shift: 0, offset: 0 }; 64];
const BISHOP_MAGIC_SQUARES: [MagicEntry; 64] = [MagicEntry { mask: 0, magic: 0, shift: 0, offset: 0 }; 64];

#[derive(Clone, Copy)]
pub struct MagicEntry {
    pub mask: u64,
    pub magic: u64,
    pub shift: u32,
    pub offset: u32,
}
