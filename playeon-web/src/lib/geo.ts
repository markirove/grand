/**
 * Where the viewer is, near enough to answer one question: is a stream locked
 * to country X already playable for them?
 *
 * The IP is what actually decides that, and the browser never sees it. The
 * time zone is the next best signal and the only one that costs nothing - no
 * request, no geo service, no permission prompt - and unlike `navigator.
 * language` it describes where the device is rather than what language its
 * owner reads in.
 *
 * The table is deliberately partial: a zone we don't know maps to `null`, and
 * every caller treats `null` as "assume they're elsewhere", so a gap shows a
 * notice that was always shown before rather than hiding a real block.
 */
const ZONE_COUNTRY: Record<string, string> = {
  // South and Central Asia
  "Asia/Kolkata": "in",
  "Asia/Calcutta": "in",
  "Asia/Colombo": "lk",
  "Asia/Kathmandu": "np",
  "Asia/Dhaka": "bd",
  "Asia/Karachi": "pk",
  "Asia/Kabul": "af",
  "Asia/Thimphu": "bt",
  "Indian/Maldives": "mv",
  "Asia/Almaty": "kz",
  "Asia/Tashkent": "uz",
  "Asia/Bishkek": "kg",
  "Asia/Dushanbe": "tj",
  "Asia/Ashgabat": "tm",

  // West Asia
  "Asia/Tehran": "ir",
  "Asia/Dubai": "ae",
  "Asia/Qatar": "qa",
  "Asia/Riyadh": "sa",
  "Asia/Kuwait": "kw",
  "Asia/Bahrain": "bh",
  "Asia/Muscat": "om",
  "Asia/Baghdad": "iq",
  "Asia/Amman": "jo",
  "Asia/Beirut": "lb",
  "Asia/Damascus": "sy",
  "Asia/Jerusalem": "il",
  "Asia/Istanbul": "tr",
  "Europe/Istanbul": "tr",
  "Asia/Yerevan": "am",
  "Asia/Baku": "az",
  "Asia/Tbilisi": "ge",

  // East and Southeast Asia
  "Asia/Shanghai": "cn",
  "Asia/Urumqi": "cn",
  "Asia/Hong_Kong": "hk",
  "Asia/Macau": "mo",
  "Asia/Taipei": "tw",
  "Asia/Tokyo": "jp",
  "Asia/Seoul": "kr",
  "Asia/Pyongyang": "kp",
  "Asia/Ulaanbaatar": "mn",
  "Asia/Bangkok": "th",
  "Asia/Yangon": "mm",
  "Asia/Ho_Chi_Minh": "vn",
  "Asia/Saigon": "vn",
  "Asia/Phnom_Penh": "kh",
  "Asia/Vientiane": "la",
  "Asia/Kuala_Lumpur": "my",
  "Asia/Kuching": "my",
  "Asia/Singapore": "sg",
  "Asia/Brunei": "bn",
  "Asia/Jakarta": "id",
  "Asia/Makassar": "id",
  "Asia/Jayapura": "id",
  "Asia/Manila": "ph",

  // Europe
  "Europe/London": "gb",
  "Europe/Dublin": "ie",
  "Europe/Lisbon": "pt",
  "Europe/Madrid": "es",
  "Europe/Paris": "fr",
  "Europe/Brussels": "be",
  "Europe/Amsterdam": "nl",
  "Europe/Luxembourg": "lu",
  "Europe/Berlin": "de",
  "Europe/Zurich": "ch",
  "Europe/Vienna": "at",
  "Europe/Rome": "it",
  "Europe/Malta": "mt",
  "Europe/Athens": "gr",
  "Europe/Nicosia": "cy",
  "Europe/Sofia": "bg",
  "Europe/Bucharest": "ro",
  "Europe/Chisinau": "md",
  "Europe/Kyiv": "ua",
  "Europe/Kiev": "ua",
  "Europe/Minsk": "by",
  "Europe/Moscow": "ru",
  "Europe/Kaliningrad": "ru",
  "Asia/Yekaterinburg": "ru",
  "Asia/Novosibirsk": "ru",
  "Asia/Krasnoyarsk": "ru",
  "Asia/Irkutsk": "ru",
  "Asia/Vladivostok": "ru",
  "Europe/Warsaw": "pl",
  "Europe/Prague": "cz",
  "Europe/Bratislava": "sk",
  "Europe/Budapest": "hu",
  "Europe/Ljubljana": "si",
  "Europe/Zagreb": "hr",
  "Europe/Sarajevo": "ba",
  "Europe/Belgrade": "rs",
  "Europe/Podgorica": "me",
  "Europe/Skopje": "mk",
  "Europe/Tirane": "al",
  "Europe/Copenhagen": "dk",
  "Europe/Oslo": "no",
  "Europe/Stockholm": "se",
  "Europe/Helsinki": "fi",
  "Europe/Tallinn": "ee",
  "Europe/Riga": "lv",
  "Europe/Vilnius": "lt",
  "Atlantic/Reykjavik": "is",

  // North America
  "America/New_York": "us",
  "America/Detroit": "us",
  "America/Indiana/Indianapolis": "us",
  "America/Chicago": "us",
  "America/Denver": "us",
  "America/Phoenix": "us",
  "America/Los_Angeles": "us",
  "America/Anchorage": "us",
  "Pacific/Honolulu": "us",
  "America/Toronto": "ca",
  "America/Winnipeg": "ca",
  "America/Edmonton": "ca",
  "America/Vancouver": "ca",
  "America/Halifax": "ca",
  "America/St_Johns": "ca",
  "America/Mexico_City": "mx",
  "America/Monterrey": "mx",
  "America/Cancun": "mx",
  "America/Tijuana": "mx",

  // Latin America and the Caribbean
  "America/Guatemala": "gt",
  "America/Tegucigalpa": "hn",
  "America/San_Salvador": "sv",
  "America/Managua": "ni",
  "America/Costa_Rica": "cr",
  "America/Panama": "pa",
  "America/Havana": "cu",
  "America/Santo_Domingo": "do",
  "America/Puerto_Rico": "pr",
  "America/Jamaica": "jm",
  "America/Port-au-Prince": "ht",
  "America/Bogota": "co",
  "America/Caracas": "ve",
  "America/Guayaquil": "ec",
  "America/Lima": "pe",
  "America/La_Paz": "bo",
  "America/Santiago": "cl",
  "America/Asuncion": "py",
  "America/Montevideo": "uy",
  "America/Argentina/Buenos_Aires": "ar",
  "America/Sao_Paulo": "br",
  "America/Bahia": "br",
  "America/Fortaleza": "br",
  "America/Recife": "br",
  "America/Manaus": "br",

  // Africa
  "Africa/Cairo": "eg",
  "Africa/Casablanca": "ma",
  "Africa/Algiers": "dz",
  "Africa/Tunis": "tn",
  "Africa/Tripoli": "ly",
  "Africa/Khartoum": "sd",
  "Africa/Addis_Ababa": "et",
  "Africa/Nairobi": "ke",
  "Africa/Kampala": "ug",
  "Africa/Dar_es_Salaam": "tz",
  "Africa/Kigali": "rw",
  "Africa/Lagos": "ng",
  "Africa/Accra": "gh",
  "Africa/Abidjan": "ci",
  "Africa/Dakar": "sn",
  "Africa/Bamako": "ml",
  "Africa/Kinshasa": "cd",
  "Africa/Luanda": "ao",
  "Africa/Lusaka": "zm",
  "Africa/Harare": "zw",
  "Africa/Maputo": "mz",
  "Africa/Johannesburg": "za",
  "Indian/Mauritius": "mu",

  // Oceania
  "Australia/Sydney": "au",
  "Australia/Melbourne": "au",
  "Australia/Brisbane": "au",
  "Australia/Adelaide": "au",
  "Australia/Perth": "au",
  "Australia/Hobart": "au",
  "Australia/Darwin": "au",
  "Pacific/Auckland": "nz",
  "Pacific/Fiji": "fj",
  "Pacific/Port_Moresby": "pg",
};

/**
 * The viewer's country as a lowercase ISO 3166-1 alpha-2 code, or `null` when
 * the time zone is unreadable or isn't one we have a mapping for.
 *
 * Browser-only: on the server this returns the *host's* country, which is not
 * the viewer's, so call it after mount rather than during render.
 */
export function viewerCountry(): string | null {
  if (typeof Intl === "undefined") return null;
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return (zone && ZONE_COUNTRY[zone]) || null;
  } catch {
    return null;
  }
}
