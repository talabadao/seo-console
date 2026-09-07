// GSC returns ISO-3166-1 alpha-3 country codes, lowercase (e.g. "usa", "idn").
// Map to alpha-2 + English name; derive the flag emoji from the alpha-2 code.

const RAW =
  "afg AF Afghanistan|ala AX Åland Islands|alb AL Albania|dza DZ Algeria|asm AS American Samoa|and AD Andorra|ago AO Angola|aia AI Anguilla|ata AQ Antarctica|atg AG Antigua & Barbuda|arg AR Argentina|arm AM Armenia|abw AW Aruba|aus AU Australia|aut AT Austria|aze AZ Azerbaijan|bhs BS Bahamas|bhr BH Bahrain|bgd BD Bangladesh|brb BB Barbados|blr BY Belarus|bel BE Belgium|blz BZ Belize|ben BJ Benin|bmu BM Bermuda|btn BT Bhutan|bol BO Bolivia|bes BQ Caribbean Netherlands|bih BA Bosnia & Herzegovina|bwa BW Botswana|bvt BV Bouvet Island|bra BR Brazil|iot IO British Indian Ocean Territory|brn BN Brunei|bgr BG Bulgaria|bfa BF Burkina Faso|bdi BI Burundi|cpv CV Cape Verde|khm KH Cambodia|cmr CM Cameroon|can CA Canada|cym KY Cayman Islands|caf CF Central African Republic|tcd TD Chad|chl CL Chile|chn CN China|cxr CX Christmas Island|cck CC Cocos (Keeling) Islands|col CO Colombia|com KM Comoros|cog CG Congo - Brazzaville|cod CD Congo - Kinshasa|cok CK Cook Islands|cri CR Costa Rica|civ CI Côte d'Ivoire|hrv HR Croatia|cub CU Cuba|cuw CW Curaçao|cyp CY Cyprus|cze CZ Czechia|dnk DK Denmark|dji DJ Djibouti|dma DM Dominica|dom DO Dominican Republic|ecu EC Ecuador|egy EG Egypt|slv SV El Salvador|gnq GQ Equatorial Guinea|eri ER Eritrea|est EE Estonia|swz SZ Eswatini|eth ET Ethiopia|flk FK Falkland Islands|fro FO Faroe Islands|fji FJ Fiji|fin FI Finland|fra FR France|guf GF French Guiana|pyf PF French Polynesia|atf TF French Southern Territories|gab GA Gabon|gmb GM Gambia|geo GE Georgia|deu DE Germany|gha GH Ghana|gib GI Gibraltar|grc GR Greece|grl GL Greenland|grd GD Grenada|glp GP Guadeloupe|gum GU Guam|gtm GT Guatemala|ggy GG Guernsey|gin GN Guinea|gnb GW Guinea-Bissau|guy GY Guyana|hti HT Haiti|hmd HM Heard & McDonald Islands|vat VA Vatican City|hnd HN Honduras|hkg HK Hong Kong|hun HU Hungary|isl IS Iceland|ind IN India|idn ID Indonesia|irn IR Iran|irq IQ Iraq|irl IE Ireland|imn IM Isle of Man|isr IL Israel|ita IT Italy|jam JM Jamaica|jpn JP Japan|jey JE Jersey|jor JO Jordan|kaz KZ Kazakhstan|ken KE Kenya|kir KI Kiribati|prk KP North Korea|kor KR South Korea|kwt KW Kuwait|kgz KG Kyrgyzstan|lao LA Laos|lva LV Latvia|lbn LB Lebanon|lso LS Lesotho|lbr LR Liberia|lby LY Libya|lie LI Liechtenstein|ltu LT Lithuania|lux LU Luxembourg|mac MO Macao|mdg MG Madagascar|mwi MW Malawi|mys MY Malaysia|mdv MV Maldives|mli ML Mali|mlt MT Malta|mhl MH Marshall Islands|mtq MQ Martinique|mrt MR Mauritania|mus MU Mauritius|myt YT Mayotte|mex MX Mexico|fsm FM Micronesia|mda MD Moldova|mco MC Monaco|mng MN Mongolia|mne ME Montenegro|msr MS Montserrat|mar MA Morocco|moz MZ Mozambique|mmr MM Myanmar|nam NA Namibia|nru NR Nauru|npl NP Nepal|nld NL Netherlands|ncl NC New Caledonia|nzl NZ New Zealand|nic NI Nicaragua|ner NE Niger|nga NG Nigeria|niu NU Niue|nfk NF Norfolk Island|mkd MK North Macedonia|mnp MP Northern Mariana Islands|nor NO Norway|omn OM Oman|pak PK Pakistan|plw PW Palau|pse PS Palestine|pan PA Panama|png PG Papua New Guinea|pry PY Paraguay|per PE Peru|phl PH Philippines|pcn PN Pitcairn Islands|pol PL Poland|prt PT Portugal|pri PR Puerto Rico|qat QA Qatar|reu RE Réunion|rou RO Romania|rus RU Russia|rwa RW Rwanda|blm BL St. Barthélemy|shn SH St. Helena|kna KN St. Kitts & Nevis|lca LC St. Lucia|maf MF St. Martin|spm PM St. Pierre & Miquelon|vct VC St. Vincent & Grenadines|wsm WS Samoa|smr SM San Marino|stp ST São Tomé & Príncipe|sau SA Saudi Arabia|sen SN Senegal|srb RS Serbia|syc SC Seychelles|sle SL Sierra Leone|sgp SG Singapore|sxm SX Sint Maarten|svk SK Slovakia|svn SI Slovenia|slb SB Solomon Islands|som SO Somalia|zaf ZA South Africa|sgs GS South Georgia & South Sandwich Islands|ssd SS South Sudan|esp ES Spain|lka LK Sri Lanka|sdn SD Sudan|sur SR Suriname|sjm SJ Svalbard & Jan Mayen|swe SE Sweden|che CH Switzerland|syr SY Syria|twn TW Taiwan|tjk TJ Tajikistan|tza TZ Tanzania|tha TH Thailand|tls TL Timor-Leste|tgo TG Togo|tkl TK Tokelau|ton TO Tonga|tto TT Trinidad & Tobago|tun TN Tunisia|tur TR Turkey|tkm TM Turkmenistan|tca TC Turks & Caicos Islands|tuv TV Tuvalu|uga UG Uganda|ukr UA Ukraine|are AE United Arab Emirates|gbr GB United Kingdom|usa US United States|umi UM U.S. Outlying Islands|ury UY Uruguay|uzb UZ Uzbekistan|vut VU Vanuatu|ven VE Venezuela|vnm VN Vietnam|vgb VG British Virgin Islands|vir VI U.S. Virgin Islands|wlf WF Wallis & Futuna|esh EH Western Sahara|yem YE Yemen|zmb ZM Zambia|zwe ZW Zimbabwe";

interface Country {
  alpha2: string;
  name: string;
  flag: string;
}

function flagOf(alpha2: string): string {
  if (!/^[A-Z]{2}$/.test(alpha2)) return "🏳️";
  return String.fromCodePoint(
    ...[...alpha2].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

const COUNTRIES = new Map<string, Country>();
for (const entry of RAW.split("|")) {
  const [a3, a2, ...rest] = entry.split(" ");
  COUNTRIES.set(a3, { alpha2: a2, name: rest.join(" "), flag: flagOf(a2) });
}

export function country(code: string): Country {
  const c = COUNTRIES.get(code?.toLowerCase());
  if (c) return c;
  if (code?.toLowerCase() === "zzz") return { alpha2: "", name: "Unknown region", flag: "🌐" };
  return { alpha2: "", name: (code || "—").toUpperCase(), flag: "🌐" };
}

export function deviceLabel(key: string): { label: string; icon: string } {
  switch ((key || "").toUpperCase()) {
    case "MOBILE":
      return { label: "Mobile", icon: "📱" };
    case "DESKTOP":
      return { label: "Desktop", icon: "🖥️" };
    case "TABLET":
      return { label: "Tablet", icon: "📲" };
    default:
      return { label: key || "—", icon: "•" };
  }
}
