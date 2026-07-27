use palsave_core::{ compress_sav, decompress_sav };
use std::io::Cursor;
use uesave::Save;

fn main() {
    let path = std::env::args().nth(1).expect("usage: roundtrip <player.sav>");
    let data = std::fs::read(&path).unwrap();

    let gvas1 = decompress_sav(&data).expect("decompress");
    println!("gvas = {} bytes", gvas1.len());

    let save = Save::read(&mut Cursor::new(gvas1.clone())).expect("parse GVAS");

    let mut gvas2 = Vec::new();
    save.write(&mut gvas2).expect("write GVAS");

    assert_eq!(gvas1, gvas2, "GVAS bytes changed on round-trip");
    println!("✅ GVAS round-trip is byte-identical");

    let repacked = compress_sav(&gvas2).expect("repack");
    println!("repacked .sav = {} bytes (original {})", repacked.len(), data.len());
}
