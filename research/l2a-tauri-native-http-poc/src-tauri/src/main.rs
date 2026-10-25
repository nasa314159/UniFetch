#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--self-test") {
        std::process::exit(unifetch_l2a_lib::selftest::run());
    }
    unifetch_l2a_lib::run();
}
