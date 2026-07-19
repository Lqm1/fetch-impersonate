use std::{
    env, fs,
    path::{Path, PathBuf},
};

use serde_json::Value;

fn main() {
    napi_build::setup();
    println!("cargo:rerun-if-changed=c/shim.c");
    println!("cargo:rerun-if-changed=c/shim.h");
    println!("cargo:rerun-if-changed=../../native-targets.json");
    println!("cargo:rerun-if-changed=../../vendor/curl-impersonate.lock.json");
    println!("cargo:rerun-if-env-changed=FETCH_IMPERSONATE_CURL_DIR");

    if env::var_os("CARGO_FEATURE_NATIVE_STUB").is_some() {
        return;
    }

    if env::var_os("CARGO_FEATURE_NATIVE_CURL").is_none() {
        panic!("enable exactly one of native-curl or native-stub");
    }

    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let root = manifest_dir.join("../..");
    let target = env::var("TARGET").expect("Cargo did not provide TARGET");
    let target_key =
        target_key(&target).unwrap_or_else(|| panic!("unsupported Rust target: {target}"));
    let lock = read_json(&root.join("vendor/curl-impersonate.lock.json"));
    let tag = lock["tag"].as_str().expect("curl lock has no tag");
    let curl_dir = env::var_os("FETCH_IMPERSONATE_CURL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("vendor/artifacts").join(target_key).join(tag));
    let include_dir = curl_dir.join("include");
    let lib_dir = if curl_dir.join("lib").is_dir() {
        curl_dir.join("lib")
    } else {
        curl_dir.clone()
    };

    require_file(&include_dir.join("curl/curl.h"));
    println!(
        "cargo:rustc-env=FI_CURL_IMPERSONATE_VERSION={}",
        tag.trim_start_matches('v')
    );
    println!("cargo:rustc-link-search=native={}", lib_dir.display());

    cc::Build::new()
        .file("c/shim.c")
        .include(&include_dir)
        .warnings(true)
        .compile("fetch_impersonate_curl_shim");

    if target.contains("windows-msvc") {
        require_file(&lib_dir.join("libcurl-impersonate_imp.lib"));
        println!("cargo:rustc-link-lib=dylib=libcurl-impersonate_imp");
        for library in ["Crypt32", "Secur32", "wldap32", "Normaliz", "iphlpapi"] {
            println!("cargo:rustc-link-lib={library}");
        }
    } else {
        require_file(&lib_dir.join("libcurl-impersonate.a"));
        println!("cargo:rustc-link-lib=static:+whole-archive=curl-impersonate");
        if target.contains("android") {
            println!("cargo:rustc-link-lib=static=c++_static");
            println!("cargo:rustc-link-lib=static=c++abi");
        } else if target.contains("apple") {
            println!("cargo:rustc-link-lib=c++");
        } else {
            println!("cargo:rustc-link-lib=stdc++");
            println!("cargo:rustc-link-lib=pthread");
            println!("cargo:rustc-link-lib=dl");
            println!("cargo:rustc-link-lib=m");
        }
    }
}

fn read_json(path: &Path) -> Value {
    serde_json::from_str(
        &fs::read_to_string(path)
            .unwrap_or_else(|error| panic!("could not read {}: {error}", path.display())),
    )
    .unwrap_or_else(|error| panic!("invalid JSON in {}: {error}", path.display()))
}

fn require_file(path: &Path) {
    if !path.is_file() {
        panic!(
            "required curl-impersonate file is missing: {}. Run scripts/prepare-native.ts first",
            path.display()
        );
    }
}

fn target_key(target: &str) -> Option<&'static str> {
    match target {
        "x86_64-pc-windows-msvc" => Some("win32-x64-msvc"),
        "aarch64-pc-windows-msvc" => Some("win32-arm64-msvc"),
        "x86_64-apple-darwin" => Some("darwin-x64"),
        "aarch64-apple-darwin" => Some("darwin-arm64"),
        "x86_64-unknown-linux-gnu" => Some("linux-x64-gnu"),
        "aarch64-unknown-linux-gnu" => Some("linux-arm64-gnu"),
        "x86_64-unknown-linux-musl" => Some("linux-x64-musl"),
        "aarch64-unknown-linux-musl" => Some("linux-arm64-musl"),
        "i686-unknown-linux-gnu" => Some("linux-ia32-gnu"),
        "armv7-unknown-linux-gnueabihf" => Some("linux-arm-gnueabihf"),
        "riscv64gc-unknown-linux-gnu" => Some("linux-riscv64-gnu"),
        "aarch64-linux-android" => Some("android-arm64"),
        _ => None,
    }
}
