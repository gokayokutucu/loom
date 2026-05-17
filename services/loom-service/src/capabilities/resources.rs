use serde::{Deserialize, Serialize};
use std::{fs, process::Command};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemResourceSnapshot {
    pub snapshot_id: String,
    pub os_name: String,
    pub os_version: Option<String>,
    pub arch: Option<String>,
    pub cpu_brand: Option<String>,
    pub physical_cores: Option<i64>,
    pub logical_cores: Option<i64>,
    pub total_memory_bytes: Option<i64>,
    pub available_memory_bytes: Option<i64>,
    pub gpu_info_json: Option<String>,
    pub detected_at: String,
}

pub fn detect_system_resources() -> SystemResourceSnapshot {
    let os_name = std::env::consts::OS.to_string();
    let os_version = detect_os_version(&os_name);
    let arch = Some(std::env::consts::ARCH.to_string());
    let cpu_brand = detect_cpu_brand(&os_name);
    let physical_cores = detect_physical_cores(&os_name);
    let logical_cores = std::thread::available_parallelism()
        .ok()
        .map(|value| value.get() as i64);
    let (total_memory_bytes, available_memory_bytes) = detect_memory_bytes(&os_name);

    SystemResourceSnapshot {
        snapshot_id: crate::capabilities::repository::new_id("sys"),
        os_name,
        os_version,
        arch,
        cpu_brand,
        physical_cores,
        logical_cores,
        total_memory_bytes,
        available_memory_bytes,
        gpu_info_json: None,
        detected_at: crate::capabilities::repository::timestamp(),
    }
}

fn detect_os_version(os_name: &str) -> Option<String> {
    match os_name {
        "macos" => command_output("sw_vers", &["-productVersion"]),
        "linux" => fs::read_to_string("/etc/os-release").ok().and_then(|text| {
            text.lines()
                .find_map(|line| line.strip_prefix("PRETTY_NAME="))
                .map(|value| value.trim_matches('"').to_string())
        }),
        "windows" => command_output("cmd", &["/C", "ver"]),
        _ => None,
    }
}

fn detect_cpu_brand(os_name: &str) -> Option<String> {
    match os_name {
        "macos" => command_output("sysctl", &["-n", "machdep.cpu.brand_string"]),
        "linux" => fs::read_to_string("/proc/cpuinfo").ok().and_then(|text| {
            text.lines().find_map(|line| {
                line.strip_prefix("model name").and_then(|value| {
                    value
                        .split_once(':')
                        .map(|(_, brand)| brand.trim().to_string())
                })
            })
        }),
        _ => None,
    }
}

fn detect_physical_cores(os_name: &str) -> Option<i64> {
    match os_name {
        "macos" => command_output("sysctl", &["-n", "hw.physicalcpu"])
            .and_then(|value| value.parse::<i64>().ok()),
        "linux" => fs::read_to_string("/proc/cpuinfo").ok().and_then(|text| {
            let count = text
                .lines()
                .filter(|line| line.starts_with("physical id"))
                .count();
            if count > 0 {
                Some(count as i64)
            } else {
                None
            }
        }),
        _ => None,
    }
}

fn detect_memory_bytes(os_name: &str) -> (Option<i64>, Option<i64>) {
    match os_name {
        "macos" => {
            let total = command_output("sysctl", &["-n", "hw.memsize"])
                .and_then(|value| value.parse::<i64>().ok());
            (total, None)
        }
        "linux" => {
            let text = match fs::read_to_string("/proc/meminfo") {
                Ok(text) => text,
                Err(_) => return (None, None),
            };
            let total = meminfo_kb(&text, "MemTotal:").map(|kb| kb * 1024);
            let available = meminfo_kb(&text, "MemAvailable:").map(|kb| kb * 1024);
            (total, available)
        }
        _ => (None, None),
    }
}

fn meminfo_kb(text: &str, key: &str) -> Option<i64> {
    text.lines()
        .find(|line| line.starts_with(key))
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<i64>().ok())
}

fn command_output(command: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(command).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let text = text.trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}
