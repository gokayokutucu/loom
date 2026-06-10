use std::process::Command;

struct Tm {
    year: i32,
    month: i32,
    day: i32,
    hour: i32,
    min: i32,
    sec: i32,
}

fn secs_to_tm(secs: u64) -> Tm {
    const SECS_PER_MIN: u64 = 60;
    const SECS_PER_HOUR: u64 = 3600;
    const SECS_PER_DAY: u64 = 86400;

    let day_seconds = secs % SECS_PER_DAY;
    let days = secs / SECS_PER_DAY;

    let hour = (day_seconds / SECS_PER_HOUR) as i32;
    let min = ((day_seconds % SECS_PER_HOUR) / SECS_PER_MIN) as i32;
    let sec = (day_seconds % SECS_PER_MIN) as i32;

    let mut year = 1970;
    let mut days_left = days;

    loop {
        let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
        let days_in_year = if is_leap { 366 } else { 365 };
        if days_left < days_in_year {
            break;
        }
        days_left -= days_in_year;
        year += 1;
    }

    let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    let month_days = if is_leap {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 1;
    for &days_in_month in &month_days {
        if days_left < days_in_month {
            break;
        }
        days_left -= days_in_month;
        month += 1;
    }

    Tm {
        year,
        month,
        day: (days_left + 1) as i32,
        hour,
        min,
        sec,
    }
}

fn format_secs_to_utc(secs: u64) -> String {
    let tm = secs_to_tm(secs);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        tm.year, tm.month, tm.day, tm.hour, tm.min, tm.sec
    )
}

fn main() {
    // Get git commit hash
    let git_commit = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                String::from_utf8(output.stdout).ok()
            } else {
                None
            }
        })
        .unwrap_or_else(|| "unknown".to_string());
    let git_commit = git_commit.trim();

    // Get build timestamp in ISO 8601 UTC format
    let now = std::time::SystemTime::now();
    let build_timestamp = match now.duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => format_secs_to_utc(duration.as_secs()),
        Err(_) => "unknown".to_string(),
    };

    println!("cargo:rustc-env=GIT_COMMIT={}", git_commit);
    println!("cargo:rustc-env=BUILD_TIMESTAMP={}", build_timestamp);
}
