use std::{fmt, str::FromStr};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DateError {
    InvalidFormat,
    InvalidCalendarDate,
    OutOfRange,
}

impl fmt::Display for DateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidFormat => "date must use YYYY-MM-DD format",
            Self::InvalidCalendarDate => "date is not a valid calendar date",
            Self::OutOfRange => "date is outside the supported range",
        })
    }
}

impl std::error::Error for DateError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct LocalDate {
    year: i32,
    month: u8,
    day: u8,
}

impl LocalDate {
    pub fn new(year: i32, month: u8, day: u8) -> Result<Self, DateError> {
        if !(1..=9_999).contains(&year) {
            return Err(DateError::OutOfRange);
        }
        if !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) {
            return Err(DateError::InvalidCalendarDate);
        }
        Ok(Self { year, month, day })
    }

    pub fn parse(value: &str) -> Result<Self, DateError> {
        let bytes = value.as_bytes();
        if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
            return Err(DateError::InvalidFormat);
        }

        let year = parse_component(&bytes[0..4]).ok_or(DateError::InvalidFormat)? as i32;
        let month = parse_component(&bytes[5..7]).ok_or(DateError::InvalidFormat)?;
        let day = parse_component(&bytes[8..10]).ok_or(DateError::InvalidFormat)?;
        Self::new(year, month as u8, day as u8)
    }

    pub const fn year(self) -> i32 {
        self.year
    }

    pub const fn month(self) -> u8 {
        self.month
    }

    pub const fn day(self) -> u8 {
        self.day
    }

    pub fn weekday(self) -> Weekday {
        // 1970-01-01 was a Thursday. Monday is index zero here.
        match (days_from_civil(self.year, self.month, self.day) + 3).rem_euclid(7) {
            0 => Weekday::Mon,
            1 => Weekday::Tue,
            2 => Weekday::Wed,
            3 => Weekday::Thu,
            4 => Weekday::Fri,
            5 => Weekday::Sat,
            _ => Weekday::Sun,
        }
    }

    pub fn checked_add_days(self, days: i32) -> Result<Self, DateError> {
        let absolute = days_from_civil(self.year, self.month, self.day)
            .checked_add(i64::from(days))
            .ok_or(DateError::OutOfRange)?;
        let (year, month, day) = civil_from_days(absolute);
        Self::new(year, month, day)
    }
}

impl fmt::Display for LocalDate {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{:04}-{:02}-{:02}",
            self.year, self.month, self.day
        )
    }
}

impl FromStr for LocalDate {
    type Err = DateError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Weekday {
    Mon,
    Tue,
    Wed,
    Thu,
    Fri,
    Sat,
    Sun,
}

impl Weekday {
    pub const ALL: [Self; 7] = [
        Self::Mon,
        Self::Tue,
        Self::Wed,
        Self::Thu,
        Self::Fri,
        Self::Sat,
        Self::Sun,
    ];

    pub const fn is_weekday(self) -> bool {
        matches!(
            self,
            Self::Mon | Self::Tue | Self::Wed | Self::Thu | Self::Fri
        )
    }
}

fn parse_component(value: &[u8]) -> Option<u32> {
    value.iter().try_fold(0_u32, |total, digit| {
        digit
            .is_ascii_digit()
            .then(|| total * 10 + u32::from(digit - b'0'))
    })
}

fn days_in_month(year: i32, month: u8) -> u8 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => 0,
    }
}

fn is_leap_year(year: i32) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

// Howard Hinnant's civil-calendar conversion, using 1970-01-01 as day zero.
fn days_from_civil(year: i32, month: u8, day: u8) -> i64 {
    let year = i64::from(year) - i64::from(month <= 2);
    let era = (if year >= 0 { year } else { year - 399 }) / 400;
    let year_of_era = year - era * 400;
    let month = i64::from(month);
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn civil_from_days(days: i64) -> (i32, u8, u8) {
    let days = days + 719_468;
    let era = (if days >= 0 { days } else { days - 146_096 }) / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_part = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_part + 2) / 5 + 1;
    let month = month_part + if month_part < 10 { 3 } else { -9 };
    let year = year + i64::from(month <= 2);
    (year as i32, month as u8, day as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_and_formats_local_dates() {
        let date = LocalDate::parse("2026-02-28").unwrap();
        assert_eq!(date.to_string(), "2026-02-28");
        assert!(LocalDate::parse("2026-02-29").is_err());
        assert!(LocalDate::parse("2026-2-9").is_err());
    }

    #[test]
    fn handles_leap_days_and_weekdays() {
        let leap_day = LocalDate::parse("2024-02-29").unwrap();
        assert_eq!(
            leap_day.checked_add_days(1).unwrap().to_string(),
            "2024-03-01"
        );
        assert_eq!(
            LocalDate::parse("1970-01-01").unwrap().weekday(),
            Weekday::Thu
        );
        assert_eq!(
            LocalDate::parse("2026-01-05").unwrap().weekday(),
            Weekday::Mon
        );
    }
}
