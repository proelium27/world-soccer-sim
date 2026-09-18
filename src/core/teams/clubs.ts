import type { League } from "../league/generate.js";
import type { Competition } from "../competitions.js";
import { competitionOf, countryClubRanges, worldCompetitions } from "../competitions.js";
import { generateClubIdentities } from "./clubNames.js";
import type { FormationId } from "../lineup/formations.js";
import { chooseBestFormation } from "../lineup/formations.js";
import type { Player, Position } from "../players/types.js";
import {
  HYPE_INITIAL, SCOUTING_SPEND_DEFAULT, difficultyProfile, type Difficulty,
} from "../constants.js";
import { chargeSeasonStart, wageBill, financeScale } from "../finance/budget.js";
import { clampScoutingSpend } from "../finance/scouting.js";

export interface ClubIdentity {
  name: string;
  abbrev: string;
  colors: [string, string];
}

/**
 * Default club identities are fictional (invented place names, no real-club
 * stand-ins) to avoid shipping real trademarks. Users can rename clubs
 * per-save via the Customize Teams editor on the Leagues page.
 */
// English clubs (tids 0-19, 20-39... see below): real English cities/towns
// paired with generic, non-trademarked suffixes (United/Town/Rovers/Athletic/
// Wanderers/etc., or no suffix) — not reproductions of actual club names.
export const CLUBS: ClubIdentity[] = [
  { name: "Ashbourne United",     abbrev: "ASH", colors: ["#c0392b", "#ffffff"] },
  { name: "Bakewell Colliers",    abbrev: "BAK", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Chipping Norton",      abbrev: "CHN", colors: ["#76d7c4", "#1a1a1a"] },
  { name: "Devizes Forgers",      abbrev: "DEV", colors: ["#f39c12", "#2c3e50"] },
  { name: "Evesham Cormorants",   abbrev: "EVE", colors: ["#2980b9", "#ffffff"] },
  { name: "Faversham Town",       abbrev: "FAV", colors: ["#27ae60", "#ffffff"] },
  { name: "Glastonbury",          abbrev: "GLA", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Henley Ploughmen",     abbrev: "HEN", colors: ["#e74c3c", "#3498db"] },
  { name: "Ilkley Wanderers",     abbrev: "ILK", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Knaresborough Sentinels", abbrev: "KNA", colors: ["#16a085", "#ecf0f1"] },
  { name: "Ludlow Sabres",        abbrev: "LUD", colors: ["#ffffff", "#2c3e50"] },
  { name: "Marlow",               abbrev: "MAR", colors: ["#d35400", "#1a1a1a"] },
  { name: "Newark",               abbrev: "NEW", colors: ["#f7dc6f", "#145a32"] },
  { name: "Oakham Stags",         abbrev: "OAK", colors: ["#145a32", "#f4d03f"] },
  { name: "Petworth Larks",       abbrev: "PET", colors: ["#2e4053", "#e74c3c"] },
  { name: "Ross Masons",          abbrev: "ROS", colors: ["#6c3483", "#ffffff"] },
  { name: "Sudbury Rovers",       abbrev: "SUD", colors: ["#922b21", "#f0f3f4"] },
  { name: "Tewkesbury",           abbrev: "TEW", colors: ["#aab7b8", "#17202a"] },
  { name: "Uppingham Foresters",  abbrev: "UPP", colors: ["#0e6251", "#f5b041"] },
  { name: "Wallingford Crowns",   abbrev: "WAL", colors: ["#1f618d", "#f8f9f9"] },
  { name: "Amersham Rovers",     abbrev: "AME", colors: ["#8e2de2", "#f2f2f2"] },
  { name: "Bourton",             abbrev: "BOU", colors: ["#2c3e50", "#e67e22"] },
  { name: "Corbridge Town",      abbrev: "CBR", colors: ["#b5651d", "#ffffff"] },
  { name: "Dorking United",      abbrev: "DOR", colors: ["#1a5276", "#f1c40f"] },
  { name: "Emsworth",            abbrev: "EMS", colors: ["#145a32", "#ecf0f1"] },
  { name: "Framlingham Wanderers", abbrev: "FRA", colors: ["#c0392b", "#2c3e50"] },
  { name: "Grantham",            abbrev: "GRN", colors: ["#5b2c6f", "#f4d03f"] },
  { name: "Haslemere",           abbrev: "HAS", colors: ["#117864", "#ffffff"] },
  { name: "Ivybridge Athletic",  abbrev: "IVY", colors: ["#212f3d", "#e74c3c"] },
  { name: "Kirkby",              abbrev: "KIR", colors: ["#1e8449", "#f7dc6f"] },
  { name: "Louth Miners",        abbrev: "LOU", colors: ["#4a235a", "#aeb6bf"] },
  { name: "Malmesbury Town",     abbrev: "MAL", colors: ["#0b5345", "#f5b041"] },
  { name: "Nantwich Rangers",    abbrev: "NAN", colors: ["#7b241c", "#f0f3f4"] },
  { name: "Oundle Athletic",     abbrev: "OUN", colors: ["#1b2631", "#f39c12"] },
  { name: "Pershore",            abbrev: "PSH", colors: ["#154360", "#ffffff"] },
  { name: "Rye",                 abbrev: "RYE", colors: ["#145214", "#f8c471"] },
  { name: "Stamford",            abbrev: "STA", colors: ["#1c2833", "#c0392b"] },
  { name: "Thirsk",              abbrev: "THI", colors: ["#6e2c00", "#f4f6f6"] },
  { name: "Uttoxeter Town",      abbrev: "UTT", colors: ["#283747", "#f1948a"] },
  { name: "Wetherby",            abbrev: "WET", colors: ["#512e5f", "#ffffff"] },
  // English third-division clubs, same styling as the block above.
  { name: "Alnwick Wanderers",                 abbrev: "ALN", colors: ["#7d3c98", "#f7dc6f"] },
  { name: "Beverley Minstermen",               abbrev: "BEV", colors: ["#1f618d", "#ffffff"] },
  { name: "Bridport Netmakers",                abbrev: "BRI", colors: ["#0e6251", "#f9e79f"] },
  { name: "Congleton Bearsmen",                abbrev: "CON", colors: ["#873600", "#fdebd0"] },
  { name: "Dorchester",                        abbrev: "DRC", colors: ["#2e4053", "#e59866"] },
  { name: "Faringdon Athletic",                abbrev: "FAA", colors: ["#641e16", "#f2f4f4"] },
  { name: "Godalming Millers",                 abbrev: "GOD", colors: ["#186a3b", "#fcf3cf"] },
  { name: "Hexham Reivers",                    abbrev: "HEX", colors: ["#4a235a", "#d7bde2"] },
  { name: "Kendal Fellrunners",                abbrev: "KEN", colors: ["#117a65", "#fdfefe"] },
  { name: "Leominster Town",                   abbrev: "LET", colors: ["#7e5109", "#fef9e7"] },
  { name: "Melton Rovers",                     abbrev: "MEL", colors: ["#1a5276", "#f5cba7"] },
  { name: "Nailsworth",                        abbrev: "NAI", colors: ["#4d5656", "#f7dc6f"] },
  { name: "Ottery Saints",                     abbrev: "OTT", colors: ["#922b21", "#eaf2f8"] },
  { name: "Penrith Beacons",                   abbrev: "PEB", colors: ["#154360", "#abebc6"] },
  { name: "Ripon Wakemen",                     abbrev: "RIP", colors: ["#6c3483", "#f4ecf7"] },
  { name: "Saxmundham United",                 abbrev: "SAX", colors: ["#0b5345", "#f0b27a"] },
  { name: "Tavistock Foresters",               abbrev: "TAV", colors: ["#784212", "#f6ddcc"] },
  { name: "Wantage Drovers",                   abbrev: "WAN", colors: ["#1b4f72", "#fadbd8"] },
  { name: "Wirksworth Quarrymen",              abbrev: "WIR", colors: ["#515a5a", "#f9e79f"] },
  { name: "Yarm Bridgers",                     abbrev: "YAR", colors: ["#5b2c6f", "#fdfefe"] },
  // Spanish clubs (tids 40-79): real Spanish cities/towns, styled like the
  // English list above — most carry a distinctive noun suffix (varied, not a
  // single generic tag repeated), some stand alone with just the town name.
  { name: "Madrid",              abbrev: "MAD", colors: ["#c0392b", "#f1c40f"] },
  { name: "Barcelona Halcones",  abbrev: "BAR", colors: ["#1a5276", "#ffffff"] },
  { name: "Valencia",            abbrev: "VAL", colors: ["#e74c3c", "#1a1a1a"] },
  { name: "Sevilla Toros",       abbrev: "SEV", colors: ["#154360", "#f4d03f"] },
  { name: "Zaragoza Mineros",    abbrev: "ZAR", colors: ["#ffffff", "#2874a6"] },
  { name: "Malaga",              abbrev: "MLG", colors: ["#1a1a1a", "#f0f3f4"] },
  { name: "Murcia Lobos",        abbrev: "MUR", colors: ["#d35400", "#1a1a1a"] },
  { name: "Palma Aguilas",       abbrev: "PAL", colors: ["#7d6608", "#f7dc6f"] },
  { name: "Bilbao Centinelas",   abbrev: "BIL", colors: ["#212f3d", "#e74c3c"] },
  { name: "Alicante",            abbrev: "ALI", colors: ["#196f3d", "#ffffff"] },
  { name: "Cordoba Cazadores",   abbrev: "COR", colors: ["#a04000", "#f5b7b1"] },
  { name: "Valladolid Real",     abbrev: "VLL", colors: ["#5b2c6f", "#f4d03f"] },
  { name: "Vigo Pescadores",     abbrev: "VIG", colors: ["#0b5345", "#f8c471"] },
  { name: "Gijon",               abbrev: "GIJ", colors: ["#943126", "#ecf0f1"] },
  { name: "Granada Leones",      abbrev: "GRA", colors: ["#1b4f72", "#e67e22"] },
  { name: "Vitoria Errantes",    abbrev: "VIT", colors: ["#17202a", "#c0392b"] },
  { name: "Elche",               abbrev: "ELC", colors: ["#145a32", "#f1c40f"] },
  { name: "Oviedo Herreros",     abbrev: "OVI", colors: ["#b7950b", "#1a1a1a"] },
  { name: "Badalona Union",      abbrev: "BAD", colors: ["#78281f", "#f0f3f4"] },
  { name: "Cartagena Forjadores", abbrev: "CAR", colors: ["#ffffff", "#922b21"] },
  { name: "Terrassa",            abbrev: "TER", colors: ["#2e4053", "#f39c12"] },
  { name: "Jerez Halcones",      abbrev: "JER", colors: ["#0e6251", "#ecf0f1"] },
  { name: "Sabadell Guardianes", abbrev: "SAB", colors: ["#4a235a", "#f7dc6f"] },
  { name: "Mostoles",            abbrev: "MOS", colors: ["#e67e22", "#1a1a1a"] },
  { name: "Alcala Toros",        abbrev: "ALC", colors: ["#186a3b", "#f4f6f6"] },
  { name: "Pamplona Sables",     abbrev: "PAM", colors: ["#f1c40f", "#212f3d"] },
  { name: "Fuenlabrada Atletico", abbrev: "FUE", colors: ["#641e16", "#f0f3f4"] },
  { name: "Almeria",             abbrev: "ALM", colors: ["#1a5276", "#f5b041"] },
  { name: "Leganes Alondras",    abbrev: "LEG", colors: ["#6e2c00", "#ffffff"] },
  { name: "Santander Coronados", abbrev: "SAN", colors: ["#1c2833", "#e74c3c"] },
  { name: "Burgos",              abbrev: "BUR", colors: ["#0b5345", "#f8c471"] },
  { name: "Castellon Canteros",  abbrev: "CAS", colors: ["#512e5f", "#f0f3f4"] },
  { name: "Getafe Real",         abbrev: "GET", colors: ["#a93226", "#f4d03f"] },
  { name: "Albacete Ciervos",    abbrev: "ALB", colors: ["#154360", "#e67e22"] },
  { name: "Alcorcon",            abbrev: "ALK", colors: ["#7d6608", "#ffffff"] },
  { name: "Donostia Lobos",      abbrev: "DON", colors: ["#117864", "#f7dc6f"] },
  { name: "Logrono Aguilas",     abbrev: "LOG", colors: ["#78281f", "#ecf0f1"] },
  { name: "Huelva",              abbrev: "HUE", colors: ["#1b2631", "#f39c12"] },
  { name: "Tarragona Centinelas", abbrev: "TAR", colors: ["#0e6251", "#f5b7b1"] },
  { name: "Leon CF",             abbrev: "LEO", colors: ["#283747", "#f8f9f8"] },
  // Spanish third-division clubs, same styling as the block above.
  { name: "Alcaniz Templarios",                abbrev: "ALT", colors: ["#943126", "#fdf2e9"] },
  { name: "Aranda Bodegueros",                 abbrev: "ARA", colors: ["#4a235a", "#f4d03f"] },
  { name: "Baeza Olivares",                    abbrev: "BAE", colors: ["#145a32", "#fcf3cf"] },
  { name: "Calatayud Mudejar",                 abbrev: "CAL", colors: ["#7e5109", "#fef5e7"] },
  { name: "Carmona Alcazares",                 abbrev: "CAA", colors: ["#1a5276", "#f8c471"] },
  { name: "Denia Marineros",                   abbrev: "DEN", colors: ["#0e6251", "#eaf2f8"] },
  { name: "Ecija Astigitanos",                 abbrev: "ECI", colors: ["#922b21", "#fdebd0"] },
  { name: "Estella Peregrinos",                abbrev: "EST", colors: ["#5b2c6f", "#f2f3f4"] },
  { name: "Guadix Trogloditas",                abbrev: "GUA", colors: ["#6e2c00", "#f9e79f"] },
  { name: "Haro Riojanos",                     abbrev: "HAR", colors: ["#7b241c", "#fadbd8"] },
  { name: "Jaca Pirenaicos",                   abbrev: "JAC", colors: ["#1b4f72", "#ffffff"] },
  { name: "Lorca Solanos",                     abbrev: "LOS", colors: ["#b9770e", "#fbeee6"] },
  { name: "Medina Murallas",                   abbrev: "MED", colors: ["#4d5656", "#f7dc6f"] },
  { name: "Morella Almenas",                   abbrev: "MOA", colors: ["#186a3b", "#fdfefe"] },
  { name: "Olite Reales",                      abbrev: "OLI", colors: ["#76448a", "#f5cba7"] },
  { name: "Ronda Tajeros",                     abbrev: "RON", colors: ["#154360", "#f6ddcc"] },
  { name: "Siguenza Doncelas",                 abbrev: "SIG", colors: ["#873600", "#eafaf1"] },
  { name: "Trujillo Conquenses",               abbrev: "TRU", colors: ["#0b5345", "#f4ecf7"] },
  { name: "Ubeda Renacientes",                 abbrev: "UBE", colors: ["#641e16", "#fef9e7"] },
  { name: "Zafra Segedanos",                   abbrev: "ZAF", colors: ["#1f618d", "#fcf3cf"] },
  // Italian clubs (tids 80-119): real Italian cities/towns, same styling
  // principle as Spain above — varied noun suffixes or none, not a single
  // generic tag (Calcio/AC/FC/Unione/Sportiva) repeated for every club.
  { name: "Milano",              abbrev: "MLN", colors: ["#1e8449", "#ffffff"] },
  { name: "Torino Lupi",         abbrev: "TOR", colors: ["#154360", "#f1c40f"] },
  { name: "Napoli",              abbrev: "NAP", colors: ["#78281f", "#1a1a1a"] },
  { name: "Genova Falchi",       abbrev: "GEN", colors: ["#1a1a1a", "#f4d03f"] },
  { name: "Bologna Aquile",      abbrev: "BOL", colors: ["#c0392b", "#f0f3f4"] },
  { name: "Firenze",             abbrev: "FIR", colors: ["#212f3d", "#e67e22"] },
  { name: "Bari Leoni",          abbrev: "BAI", colors: ["#d68910", "#1a1a1a"] },
  { name: "Catania Cacciatori",  abbrev: "CAT", colors: ["#7d3c98", "#f7dc6f"] },
  { name: "Verona",              abbrev: "VER", colors: ["#0b5345", "#e74c3c"] },
  { name: "Padova Pescatori",    abbrev: "PAD", colors: ["#1b4f72", "#f0f3f4"] },
  { name: "Venezia Minatori",    abbrev: "VEN", colors: ["#943126", "#ecf0f1"] },
  { name: "Palermo",             abbrev: "PLM", colors: ["#186a3b", "#f4d03f"] },
  { name: "Trieste Fabbri",      abbrev: "TRI", colors: ["#5b2c6f", "#f8c471"] },
  { name: "Brescia Sentinelle",  abbrev: "BRE", colors: ["#b03a2e", "#ffffff"] },
  { name: "Parma",               abbrev: "PAR", colors: ["#17202a", "#e67e22"] },
  { name: "Modena Vagabondi",    abbrev: "MOD", colors: ["#0e6251", "#f5b041"] },
  { name: "Reggio Guardiani",    abbrev: "REG", colors: ["#196f3d", "#f1c40f"] },
  { name: "Perugia",             abbrev: "PER", colors: ["#b7950b", "#1a1a1a"] },
  { name: "Livorno Scalpellini", abbrev: "LIV", colors: ["#6e2c00", "#f4f6f6"] },
  { name: "Foggia Allodole",     abbrev: "FOG", colors: ["#ffffff", "#78281f"] },
  { name: "Salerno",             abbrev: "SAL", colors: ["#2e4053", "#f39c12"] },
  { name: "Ferrara Cervi",       abbrev: "FER", colors: ["#0b5345", "#ecf0f1"] },
  { name: "Pisa Sciabole",       abbrev: "PIS", colors: ["#4a235a", "#f7dc6f"] },
  { name: "Bergamo",             abbrev: "BGM", colors: ["#e67e22", "#1a1a1a"] },
  { name: "Vicenza Boscaioli",   abbrev: "VIC", colors: ["#186a3b", "#f8f9f9"] },
  { name: "Taranto Incoronati",  abbrev: "TRN", colors: ["#f1c40f", "#1a1a1a"] },
  { name: "Cagliari",            abbrev: "CAG", colors: ["#641e16", "#f4f6f6"] },
  { name: "Messina Lupi",        abbrev: "MES", colors: ["#1a5276", "#f5b041"] },
  { name: "Siena Falchi",        abbrev: "SIE", colors: ["#6e2c00", "#ecf0f1"] },
  { name: "Cremona",             abbrev: "CRE", colors: ["#1c2833", "#e74c3c"] },
  { name: "Ravenna Aquile",      abbrev: "RVN", colors: ["#0b5345", "#f8c471"] },
  { name: "Lecce Leoni",         abbrev: "LEC", colors: ["#512e5f", "#f4f6f6"] },
  { name: "Pescara",             abbrev: "PES", colors: ["#a93226", "#f4d03f"] },
  { name: "Ancona Cacciatori",   abbrev: "ANC", colors: ["#154360", "#e67e22"] },
  { name: "Piacenza Pescatori",  abbrev: "PIA", colors: ["#7d6608", "#ffffff"] },
  { name: "Novara",              abbrev: "NOV", colors: ["#117864", "#f7dc6f"] },
  { name: "Udine Minatori",      abbrev: "UDI", colors: ["#78281f", "#f0f3f4"] },
  { name: "Como Fabbri",         abbrev: "COM", colors: ["#1b2631", "#f39c12"] },
  { name: "Latina",              abbrev: "LAT", colors: ["#0e6251", "#f5b7b1"] },
  { name: "Sassari Sentinelle",  abbrev: "SAS", colors: ["#283747", "#f8f9f9"] },
  // Italian third-division clubs, same styling as the block above.
  { name: "Amelia Umbri",                      abbrev: "AMU", colors: ["#145a32", "#f9e79f"] },
  { name: "Ascoli Picentini",                  abbrev: "ASC", colors: ["#4a235a", "#ffffff"] },
  { name: "Bitonto Olivari",                   abbrev: "BIT", colors: ["#7e5109", "#fdf2e9"] },
  { name: "Camerino Varanesi",                 abbrev: "CAM", colors: ["#1a5276", "#f8c471"] },
  { name: "Cividale Longobardi",               abbrev: "CIV", colors: ["#922b21", "#eaf2f8"] },
  { name: "Corinaldo Muraglia",                abbrev: "CMU", colors: ["#0e6251", "#fdebd0"] },
  { name: "Erice Elimi",                       abbrev: "ERI", colors: ["#5b2c6f", "#f2f3f4"] },
  { name: "Fabriano Cartai",                   abbrev: "FAB", colors: ["#6e2c00", "#fef5e7"] },
  { name: "Gubbio Ceraioli",                   abbrev: "GUB", colors: ["#7b241c", "#fadbd8"] },
  { name: "Lanciano Frentani",                 abbrev: "LAN", colors: ["#1b4f72", "#f7dc6f"] },
  { name: "Melfi Normanni",                    abbrev: "MEN", colors: ["#b9770e", "#fbeee6"] },
  { name: "Narni Corsari",                     abbrev: "NAR", colors: ["#4d5656", "#fdfefe"] },
  { name: "Offida Merlettai",                  abbrev: "OFF", colors: ["#186a3b", "#f5cba7"] },
  { name: "Pitigliano Tufari",                 abbrev: "PIT", colors: ["#76448a", "#f6ddcc"] },
  { name: "Recanati Leopardi",                 abbrev: "REC", colors: ["#154360", "#eafaf1"] },
  { name: "Sansepolcro Balestrieri",           abbrev: "SBA", colors: ["#873600", "#f4ecf7"] },
  { name: "Sulmona Ovidiani",                  abbrev: "SUL", colors: ["#0b5345", "#fef9e7"] },
  { name: "Tolentino Piceni",                  abbrev: "TOL", colors: ["#641e16", "#fcf3cf"] },
  { name: "Venosa Orazi",                      abbrev: "VEO", colors: ["#1f618d", "#f9e79f"] },
  { name: "Vipiteno Alpini",                   abbrev: "VIP", colors: ["#2e4053", "#ffffff"] },
  // German clubs (tids 120-159): real German cities/towns, same styling
  // principle as Spain/Italy above — varied German noun suffixes (Adler/Lowen/
  // Bergleute/Schmiede/etc.) or none, deliberately not reproductions of real
  // Bundesliga club names. ASCII-only spellings (no umlauts/ss), matching the
  // accent-free Spanish/Italian entries.
  { name: "Berlin Adler",        abbrev: "BER", colors: ["#1b2631", "#f1c40f"] },
  { name: "Munchen Lowen",       abbrev: "MUN", colors: ["#c0392b", "#ffffff"] },
  { name: "Hamburg",             abbrev: "HAM", colors: ["#1a5276", "#f0f3f4"] },
  { name: "Koln Greifen",        abbrev: "KLN", colors: ["#7d3c98", "#f7dc6f"] },
  { name: "Frankfurt Falken",    abbrev: "FRK", colors: ["#17202a", "#e74c3c"] },
  { name: "Stuttgart Schmiede",  abbrev: "STU", colors: ["#943126", "#f4d03f"] },
  { name: "Dortmund Bergleute",  abbrev: "DTM", colors: ["#f39c12", "#1a1a1a"] },
  { name: "Leipzig",             abbrev: "LPZ", colors: ["#186a3b", "#ffffff"] },
  { name: "Bremen Wachter",      abbrev: "BRM", colors: ["#0e6251", "#f5b041"] },
  { name: "Hannover Rosser",     abbrev: "HNV", colors: ["#b03a2e", "#f0f3f4"] },
  { name: "Nurnberg",            abbrev: "NRN", colors: ["#212f3d", "#f8c471"] },
  { name: "Dresden Kurfursten",  abbrev: "DRS", colors: ["#5b2c6f", "#f4d03f"] },
  { name: "Freiburg Jager",      abbrev: "FRB", colors: ["#196f3d", "#e67e22"] },
  { name: "Augsburg Weber",      abbrev: "AUG", colors: ["#1a5276", "#ecf0f1"] },
  { name: "Bochum Hammer",       abbrev: "BOC", colors: ["#4a235a", "#f7dc6f"] },
  { name: "Mainz Winzer",        abbrev: "MNZ", colors: ["#7b241c", "#f5b7b1"] },
  { name: "Kiel Mowen",          abbrev: "KIE", colors: ["#154360", "#ffffff"] },
  { name: "Rostock Anker",       abbrev: "RST", colors: ["#0b5345", "#f1c40f"] },
  { name: "Bielefeld Leinen",    abbrev: "BIE", colors: ["#283747", "#f39c12"] },
  { name: "Karlsruhe Markgrafen", abbrev: "KRL", colors: ["#a04000", "#f5b041"] },
  { name: "Mannheim Kurpfalz",   abbrev: "MAN", colors: ["#512e5f", "#f0f3f4"] },
  { name: "Wiesbaden Quellen",   abbrev: "WIE", colors: ["#117864", "#f8c471"] },
  { name: "Munster Radler",      abbrev: "MST", colors: ["#1b4f72", "#f7dc6f"] },
  { name: "Aachen Kaiser",       abbrev: "AAC", colors: ["#1a1a1a", "#f4d03f"] },
  { name: "Braunschweig Herzoge", abbrev: "BSC", colors: ["#78281f", "#f8f9f9"] },
  { name: "Kassel Landgrafen",   abbrev: "KSL", colors: ["#186a3b", "#ecf0f1"] },
  { name: "Ulm Spatzen",         abbrev: "ULM", colors: ["#2874a6", "#ffffff"] },
  { name: "Erfurt Gartner",      abbrev: "ERF", colors: ["#0e6251", "#f5b7b1"] },
  { name: "Jena Optiker",        abbrev: "JEN", colors: ["#1e8449", "#1a1a1a"] },
  { name: "Osnabruck Lerchen",   abbrev: "OSN", colors: ["#641e16", "#f4d03f"] },
  { name: "Paderborn Domherren", abbrev: "PBN", colors: ["#154360", "#f5b041"] },
  { name: "Ingolstadt Schanzer", abbrev: "ING", colors: ["#212f3d", "#e67e22"] },
  { name: "Regensburg Steinerne", abbrev: "RGB", colors: ["#7d6608", "#f0f3f4"] },
  { name: "Furth Kleeblatter",   abbrev: "FUR", colors: ["#196f3d", "#ffffff"] },
  { name: "Heidenheim Brenztaler", abbrev: "HDH", colors: ["#b7950b", "#1a1a1a"] },
  { name: "Darmstadt Lilien",    abbrev: "DAR", colors: ["#1b2631", "#5dade2"] },
  // German third-division clubs, same styling as the block above.
  { name: "Ahrweiler Winzer",                  abbrev: "AHR", colors: ["#7d3c98", "#f7dc6f"] },
  { name: "Andernach Bimssteiner",             abbrev: "AND", colors: ["#1f618d", "#ffffff"] },
  { name: "Bad Tolz Flosser",                  abbrev: "BAT", colors: ["#0e6251", "#f9e79f"] },
  { name: "Butzbach Wetterauer",               abbrev: "BUT", colors: ["#873600", "#fdebd0"] },
  { name: "Celle Hengste",                     abbrev: "CEL", colors: ["#2e4053", "#e59866"] },
  { name: "Detmold Hermannsleute",             abbrev: "DET", colors: ["#641e16", "#f2f4f4"] },
  { name: "Eutin Rosenstadt",                  abbrev: "EUT", colors: ["#186a3b", "#fcf3cf"] },
  { name: "Freudenstadt Waldler",              abbrev: "FRE", colors: ["#4a235a", "#d7bde2"] },
  { name: "Gorlitz Neissetaler",               abbrev: "GOR", colors: ["#117a65", "#fdfefe"] },
  { name: "Hameln Rattenfanger",               abbrev: "HRA", colors: ["#7e5109", "#fef9e7"] },
  { name: "Ilmenau Bergleute",                 abbrev: "ILM", colors: ["#1a5276", "#f5cba7"] },
  { name: "Kronach Frankenwalder",             abbrev: "KRO", colors: ["#4d5656", "#f7dc6f"] },
  { name: "Lauenburg Schiffer",                abbrev: "LAU", colors: ["#922b21", "#eaf2f8"] },
  { name: "Meppen Emslander",                  abbrev: "MEP", colors: ["#154360", "#abebc6"] },
  { name: "Nordlingen Ries",                   abbrev: "NOR", colors: ["#6c3483", "#f4ecf7"] },
  { name: "Quedlinburg Stiftsherren",          abbrev: "QUE", colors: ["#0b5345", "#f0b27a"] },
  { name: "Rinteln Weserleute",                abbrev: "RIN", colors: ["#784212", "#f6ddcc"] },
  { name: "Sonneberg Spielzeugler",            abbrev: "SON", colors: ["#1b4f72", "#fadbd8"] },
  { name: "Wertheim Tauberleute",              abbrev: "WER", colors: ["#515a5a", "#f9e79f"] },
  { name: "Zeitz Elsteraner",                  abbrev: "ZEI", colors: ["#5b2c6f", "#fdfefe"] },
  // French clubs (tids 160-199): real French cities/towns with invented,
  // evocative suffixes (Griffons/Corsaires/Aiglons/etc.), same fictional
  // styling as the sets above — deliberately not real Ligue 1/2 club names.
  // ASCII-only (no accents). France is a deliberately weaker league (see
  // COUNTRY_STRENGTH_OFFSET in constants.ts).
  { name: "Lyon Griffons",       abbrev: "LYO", colors: ["#2874a6", "#e74c3c"] },
  { name: "Marseille Corsaires", abbrev: "MSL", colors: ["#5dade2", "#ffffff"] },
  { name: "Lille Dragons",       abbrev: "LIL", colors: ["#c0392b", "#1a1a1a"] },
  { name: "Nice Aiglons",        abbrev: "NCE", colors: ["#1a1a1a", "#e74c3c"] },
  { name: "Rennes Hermines",     abbrev: "REN", colors: ["#e74c3c", "#1a1a1a"] },
  { name: "Nantes Canaris",      abbrev: "NTS", colors: ["#f4d03f", "#196f3d"] },
  { name: "Montpellier Pailladins", abbrev: "MTP", colors: ["#2980b9", "#f39c12"] },
  { name: "Strasbourg Cigognes", abbrev: "STR", colors: ["#2e86c1", "#ffffff"] },
  { name: "Bordeaux Mariniers",  abbrev: "BDX", colors: ["#7b241c", "#154360"] },
  { name: "Toulouse Violets",    abbrev: "TLS", colors: ["#6c3483", "#ffffff"] },
  { name: "Reims Sacres",        abbrev: "RMS", colors: ["#943126", "#ffffff"] },
  { name: "Angers Ardoisiers",   abbrev: "ANG", colors: ["#1b2631", "#f0f3f4"] },
  { name: "Brest Goelands",      abbrev: "BST", colors: ["#e74c3c", "#154360"] },
  { name: "Lorient Merlus",      abbrev: "LOR", colors: ["#f39c12", "#1a1a1a"] },
  { name: "Metz Grenats",        abbrev: "MTZ", colors: ["#7b241c", "#f4d03f"] },
  { name: "Nancy Lorrains",      abbrev: "NCY", colors: ["#e74c3c", "#154360"] },
  { name: "Dijon Ducs",          abbrev: "DIJ", colors: ["#a04000", "#f5b041"] },
  { name: "Caen Vikings",        abbrev: "CAE", colors: ["#1a5276", "#e74c3c"] },
  { name: "Le Havre Quais",      abbrev: "LEH", colors: ["#154360", "#5dade2"] },
  { name: "Clermont Volcans",    abbrev: "CLF", colors: ["#7b241c", "#1a1a1a"] },
  { name: "Grenoble Alpins",     abbrev: "GBL", colors: ["#2e86c1", "#f0f3f4"] },
  { name: "Valenciennes Mineurs", abbrev: "VLN", colors: ["#e74c3c", "#ffffff"] },
  { name: "Rouen Diables",       abbrev: "ROU", colors: ["#c0392b", "#1a1a1a"] },
  { name: "Tours Ligeriens",     abbrev: "TRS", colors: ["#2980b9", "#f4d03f"] },
  { name: "Orleans Johannique",  abbrev: "ORL", colors: ["#943126", "#f5b041"] },
  { name: "Nimes Crocos",        abbrev: "NIM", colors: ["#196f3d", "#e74c3c"] },
  { name: "Avignon Papes",       abbrev: "AVI", colors: ["#6c3483", "#f4d03f"] },
  { name: "Perpignan Catalans",  abbrev: "PRP", colors: ["#c0392b", "#f4d03f"] },
  { name: "Bayonne Corsaires",   abbrev: "BYN", colors: ["#1b2631", "#e74c3c"] },
  { name: "Pau Bearnais",        abbrev: "PAU", colors: ["#e74c3c", "#154360"] },
  { name: "Ajaccio Insulaires",  abbrev: "AJA", colors: ["#1a5276", "#f0f3f4"] },
  { name: "Bastia Lions",        abbrev: "BAS", colors: ["#1a1a1a", "#5dade2"] },
  { name: "Auxerre Bourguignons", abbrev: "AUX", colors: ["#2874a6", "#ffffff"] },
  { name: "Sochaux Lionceaux",   abbrev: "SOC", colors: ["#f39c12", "#154360"] },
  { name: "Guingamp Rouges",     abbrev: "GGP", colors: ["#c0392b", "#1a1a1a"] },
  { name: "Niort Chamois",       abbrev: "NIO", colors: ["#196f3d", "#f0f3f4"] },
  // French third-division clubs, same styling as the block above.
  { name: "Agen Pruniers",                     abbrev: "AGE", colors: ["#c0392b", "#ffffff"] },
  { name: "Albi Cathares",                     abbrev: "ACA", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Arras Beffrois",                    abbrev: "ARR", colors: ["#145a32", "#ecf0f1"] },
  { name: "Beziers Vignerons",                 abbrev: "BEZ", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Blois Ligeriens",                   abbrev: "BLO", colors: ["#2980b9", "#ffffff"] },
  { name: "Cahors Malbecs",                    abbrev: "CAH", colors: ["#e67e22", "#2c3e50"] },
  { name: "Calais Dentelliers",                abbrev: "CAD", colors: ["#16a085", "#ecf0f1"] },
  { name: "Chartres Verriers",                 abbrev: "CVE", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Cholet Mouchoirs",                  abbrev: "CHO", colors: ["#d35400", "#1a1a1a"] },
  { name: "Dax Thermalistes",                  abbrev: "DAX", colors: ["#2c3e50", "#f39c12"] },
  { name: "Epinal Imagiers",                   abbrev: "EPI", colors: ["#27ae60", "#ffffff"] },
  { name: "Laval Lanciers",                    abbrev: "LAV", colors: ["#922b21", "#f7dc6f"] },
  { name: "Libourne Bastidiens",               abbrev: "LIB", colors: ["#4a235a", "#d7bde2"] },
  { name: "Macon Vinicoles",                   abbrev: "MAC", colors: ["#0e6251", "#f9e79f"] },
  { name: "Millau Gantiers",                   abbrev: "MIL", colors: ["#873600", "#fdebd0"] },
  { name: "Roanne Tisserands",                 abbrev: "ROA", colors: ["#154360", "#abebc6"] },
  { name: "Saumur Cavaliers",                  abbrev: "SAU", colors: ["#6c3483", "#f4ecf7"] },
  { name: "Vichy Curistes",                    abbrev: "VCU", colors: ["#784212", "#f6ddcc"] },
  // Portuguese clubs (tids 200-239): real Portuguese cities/towns with invented
  // suffixes (Navegadores/Corsarios/Caravelas/etc.), same fictional styling.
  // ASCII-only (no accents); deliberately avoids the real big-three nicknames.
  // Portugal is the weakest league in the world (see COUNTRY_STRENGTH_OFFSET).
  { name: "Lisboa Navegadores",  abbrev: "LSB", colors: ["#c0392b", "#196f3d"] },
  { name: "Porto Corsarios",     abbrev: "PRT", colors: ["#154360", "#ffffff"] },
  { name: "Braga Arcebispos",    abbrev: "BRG", colors: ["#7b241c", "#ffffff"] },
  { name: "Guimaraes Condes",    abbrev: "GUI", colors: ["#196f3d", "#f4d03f"] },
  { name: "Coimbra Estudantes",  abbrev: "CBA", colors: ["#1a1a1a", "#f0f3f4"] },
  { name: "Setubal Sadinos",     abbrev: "STB", colors: ["#2874a6", "#f4d03f"] },
  { name: "Faro Algarvios",      abbrev: "FAR", colors: ["#f39c12", "#1a5276"] },
  { name: "Aveiro Moliceiros",   abbrev: "AVR", colors: ["#5dade2", "#e74c3c"] },
  { name: "Funchal Insulares",   abbrev: "FNC", colors: ["#f4d03f", "#c0392b"] },
  { name: "Leiria Pinhal",       abbrev: "LEI", colors: ["#196f3d", "#1a1a1a"] },
  { name: "Viseu Beiroes",       abbrev: "VIS", colors: ["#6c3483", "#ffffff"] },
  { name: "Evora Alentejanos",   abbrev: "EVO", colors: ["#a04000", "#f5b041"] },
  { name: "Portimao Gaivotas",   abbrev: "PTM", colors: ["#2e86c1", "#f0f3f4"] },
  { name: "Chaves Flavienses",   abbrev: "CHV", colors: ["#c0392b", "#154360"] },
  { name: "Famalicao Teceloes",  abbrev: "FML", colors: ["#1a5276", "#ffffff"] },
  { name: "Barcelos Galos",      abbrev: "BCL", colors: ["#f39c12", "#c0392b"] },
  { name: "Tondela Serranos",    abbrev: "TND", colors: ["#196f3d", "#f4d03f"] },
  { name: "Moreira Conegos",     abbrev: "MOR", colors: ["#154360", "#e74c3c"] },
  { name: "Almada Ribeirinhos",  abbrev: "ALD", colors: ["#7b241c", "#f0f3f4"] },
  { name: "Loule Mouros",        abbrev: "LLE", colors: ["#a04000", "#1a1a1a"] },
  { name: "Guarda Sentinelas",   abbrev: "GDA", colors: ["#2c3e50", "#f5b041"] },
  { name: "Covilha Serranos",    abbrev: "COV", colors: ["#1b4f72", "#ecf0f1"] },
  { name: "Viana Navegantes",    abbrev: "VNA", colors: ["#2980b9", "#f4d03f"] },
  { name: "Vila Real Duriense",  abbrev: "VRL", colors: ["#7b241c", "#f39c12"] },
  { name: "Santarem Ribatejanos", abbrev: "SNT", colors: ["#196f3d", "#ffffff"] },
  { name: "Beja Planicie",       abbrev: "BEJ", colors: ["#b7950b", "#1a1a1a"] },
  { name: "Portalegre Alto",     abbrev: "PTL", colors: ["#6c3483", "#f4d03f"] },
  { name: "Lamego Vinhateiros",  abbrev: "LMG", colors: ["#7b241c", "#f5b7b1"] },
  { name: "Espinho Tigres",      abbrev: "ESP", colors: ["#f39c12", "#1a1a1a"] },
  { name: "Matosinhos Conserveiros", abbrev: "MTS", colors: ["#154360", "#5dade2"] },
  { name: "Gondomar Ourives",    abbrev: "GDM", colors: ["#b7950b", "#ffffff"] },
  { name: "Maia Falcoes",        abbrev: "MAI", colors: ["#1a5276", "#e74c3c"] },
  { name: "Penafiel Rios",       abbrev: "PEN", colors: ["#2874a6", "#ffffff"] },
  { name: "Fafe Montanheses",    abbrev: "FAF", colors: ["#196f3d", "#f0f3f4"] },
  { name: "Vizela Termas",       abbrev: "VZL", colors: ["#0e6251", "#f8c471"] },
  { name: "Trofa Fabris",        abbrev: "TRF", colors: ["#4a235a", "#f7dc6f"] },
  // Portuguese third-division clubs, same styling as the block above.
  { name: "Abrantes Ribeirinhos",              abbrev: "ABR", colors: ["#c0392b", "#ffffff"] },
  { name: "Amarante Doceiros",                 abbrev: "AMA", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Braganca Transmontanos",            abbrev: "BRA", colors: ["#145a32", "#ecf0f1"] },
  { name: "Caldas Ceramistas",                 abbrev: "CAC", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Elvas Ameixeiras",                  abbrev: "ELV", colors: ["#2980b9", "#ffffff"] },
  { name: "Estremoz Marmoristas",              abbrev: "ESM", colors: ["#e67e22", "#2c3e50"] },
  { name: "Fundao Cerejeiras",                 abbrev: "FUN", colors: ["#16a085", "#ecf0f1"] },
  { name: "Lagos Navegadores",                 abbrev: "LAG", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Mirandela Alheiras",                abbrev: "MIR", colors: ["#d35400", "#1a1a1a"] },
  { name: "Odemira Campinos",                  abbrev: "ODE", colors: ["#2c3e50", "#f39c12"] },
  { name: "Olhao Pescadores",                  abbrev: "OLH", colors: ["#27ae60", "#ffffff"] },
  { name: "Ourem Romeiros",                    abbrev: "OUR", colors: ["#922b21", "#f7dc6f"] },
  { name: "Peniche Rendilheiras",              abbrev: "PRE", colors: ["#4a235a", "#d7bde2"] },
  { name: "Pombal Marqueses",                  abbrev: "POM", colors: ["#0e6251", "#f9e79f"] },
  { name: "Regua Vinhateiros",                 abbrev: "REV", colors: ["#873600", "#fdebd0"] },
  { name: "Serpa Queijeiros",                  abbrev: "SER", colors: ["#154360", "#abebc6"] },
  { name: "Tavira Ilheus",                     abbrev: "TAI", colors: ["#6c3483", "#f4ecf7"] },
  { name: "Valenca Muralhas",                  abbrev: "VAM", colors: ["#784212", "#f6ddcc"] },
  { name: "Nazare Surfistas",                  abbrev: "NAZ", colors: ["#2874a6", "#ffffff"] },
  { name: "Sintra Palacianos",                 abbrev: "SIN", colors: ["#6c3483", "#f7dc6f"] },
  // Belgian clubs (tids 240-279): real Belgian cities/towns with invented
  // Dutch/French suffixes (Beiaardiers/Sangliers/Diamantairs/etc.), same
  // fictional styling. ASCII-only; deliberately avoids every real Pro League
  // club name and nickname. Belgium is a weak league (see
  // COUNTRY_STRENGTH_OFFSET) and the poorest in the world
  // (COUNTRY_BUDGET_SCALE) — a development-and-sell pipeline.
  { name: "Brussel Zwanen",      abbrev: "BXL", colors: ["#6c3483", "#ffffff"] },
  { name: "Antwerpen Diamantairs", abbrev: "ATW", colors: ["#1a1a1a", "#f4d03f"] },
  { name: "Gent Torenwachters",  abbrev: "GNT", colors: ["#2874a6", "#f0f3f4"] },
  { name: "Brugge Beiaardiers",  abbrev: "BRU", colors: ["#154360", "#e74c3c"] },
  { name: "Luik Perroniers",     abbrev: "LUI", colors: ["#c0392b", "#f4d03f"] },
  { name: "Leuven Brouwers",     abbrev: "LVN", colors: ["#a04000", "#ffffff"] },
  { name: "Charleroi Fondeurs",  abbrev: "CHR", colors: ["#1b2631", "#f39c12"] },
  { name: "Mechelen Maneblussers", abbrev: "MCH", colors: ["#f4d03f", "#c0392b"] },
  { name: "Genk Mijnwerkers",    abbrev: "GNK", colors: ["#1a5276", "#5dade2"] },
  { name: "Kortrijk Wevers",     abbrev: "KTR", colors: ["#e74c3c", "#ffffff"] },
  { name: "Oostende Loodsen",    abbrev: "OST", colors: ["#5dade2", "#1a1a1a"] },
  { name: "Namen Sangliers",     abbrev: "NAM", colors: ["#f39c12", "#1b2631"] },
  { name: "Hasselt Jenevers",    abbrev: "HSL", colors: ["#196f3d", "#f0f3f4"] },
  { name: "Sint-Truiden Kanunniken", abbrev: "STT", colors: ["#7b241c", "#f4d03f"] },
  { name: "Waregem Vlasboeren",  abbrev: "WRG", colors: ["#0e6251", "#f8c471"] },
  { name: "Beveren Wasbeken",    abbrev: "BVR", colors: ["#2e86c1", "#ffffff"] },
  { name: "Knokke Duinenvolk",   abbrev: "KNK", colors: ["#1f618d", "#f7dc6f"] },
  { name: "Tongeren Ambiorixen", abbrev: "TNG", colors: ["#7b241c", "#ecf0f1"] },
  { name: "Doornik Tapijtwevers", abbrev: "DRN", colors: ["#154360", "#f4d03f"] },
  { name: "Verviers Lainiers",   abbrev: "VRV", colors: ["#7d6608", "#ffffff"] },
  { name: "Turnhout Kaartmakers", abbrev: "THT", colors: ["#c0392b", "#154360"] },
  { name: "Lokeren Touwslagers", abbrev: "LKR", colors: ["#196f3d", "#ffffff"] },
  { name: "Eupen Grenswachters", abbrev: "EUP", colors: ["#1b2631", "#5dade2"] },
  { name: "Deinze Leiemannen",   abbrev: "DNZ", colors: ["#2980b9", "#f0f3f4"] },
  { name: "Waver Wolven",        abbrev: "WVR", colors: ["#5d6d7e", "#e74c3c"] },
  { name: "Aarlen Ardennais",    abbrev: "ARL", colors: ["#0b5345", "#f4d03f"] },
  { name: "Bastenaken Everzwijnen", abbrev: "BSN", colors: ["#6e2c00", "#f5b041"] },
  { name: "Ieper Klaprozen",     abbrev: "IPR", colors: ["#c0392b", "#1a1a1a"] },
  { name: "Halle Pelgrims",      abbrev: "HLL", colors: ["#4a235a", "#ffffff"] },
  { name: "Vilvoorde Ketelaars", abbrev: "VLV", colors: ["#1a5276", "#f39c12"] },
  { name: "Ninove Reuzen",       abbrev: "NNV", colors: ["#873600", "#f7dc6f"] },
  { name: "Geel Ambachten",      abbrev: "GEL", colors: ["#f4d03f", "#2874a6"] },
  { name: "Herentals Kempenaars", abbrev: "HRT", colors: ["#196f3d", "#e74c3c"] },
  { name: "Tienen Suikerbieten", abbrev: "TNN", colors: ["#ecf0f1", "#7b241c"] },
  // Belgian third-division clubs, same styling as the block above.
  { name: "Aalst Ajuinen",                     abbrev: "AAL", colors: ["#c0392b", "#ffffff"] },
  { name: "Ath Reuzendragers",                 abbrev: "ATR", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Binche Gillesdragers",              abbrev: "BIN", colors: ["#145a32", "#ecf0f1"] },
  { name: "Dendermonde Rosdragers",            abbrev: "DER", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Diest Lakenwevers",                 abbrev: "DIE", colors: ["#2980b9", "#ffffff"] },
  { name: "Diksmuide Ijzermannen",             abbrev: "DIK", colors: ["#e67e22", "#2c3e50"] },
  { name: "Dinant Rotsklimmers",               abbrev: "DIN", colors: ["#16a085", "#ecf0f1"] },
  { name: "Enghien Parkwachters",              abbrev: "ENG", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Huy Maasvissers",                   abbrev: "HUY", colors: ["#d35400", "#1a1a1a"] },
  { name: "Izegem Borstelmakers",              abbrev: "IZE", colors: ["#2c3e50", "#f39c12"] },
  { name: "Lier Netevolk",                     abbrev: "LIE", colors: ["#27ae60", "#ffffff"] },
  { name: "Maaseik Maaslanders",               abbrev: "MAM", colors: ["#922b21", "#f7dc6f"] },
  { name: "Malmedy Hoogveners",                abbrev: "MAH", colors: ["#4a235a", "#d7bde2"] },
  { name: "Poperinge Hoppeboeren",             abbrev: "POP", colors: ["#0e6251", "#f9e79f"] },
  { name: "Ronse Fiertelaars",                 abbrev: "ROF", colors: ["#873600", "#fdebd0"] },
  { name: "Veurne Boetelingen",                abbrev: "VEU", colors: ["#154360", "#abebc6"] },
  // Turkish clubs (tids 280-319): real Turkish cities with invented Turkish
  // suffixes (Kartallar/Cinarlar/Madenciler/etc.), same fictional styling.
  // ASCII-only (no dotted-I, cedillas or breves) and deliberately avoiding the
  // real "-spor" club-name pattern and every real club nickname. Turkey is the
  // weakest league on the pitch (see COUNTRY_STRENGTH_OFFSET) while spending
  // more than Belgium (COUNTRY_BUDGET_SCALE).
  { name: "Istanbul Bogazlar",   abbrev: "IST", colors: ["#7b241c", "#f4d03f"] },
  { name: "Ankara Sancaklar",    abbrev: "ANK", colors: ["#1a5276", "#ffffff"] },
  { name: "Izmir Efeler",        abbrev: "IZM", colors: ["#0e6251", "#f8c471"] },
  { name: "Bursa Kozalar",       abbrev: "BRS", colors: ["#196f3d", "#f0f3f4"] },
  { name: "Antalya Portakallar", abbrev: "ANT", colors: ["#e67e22", "#1a1a1a"] },
  { name: "Adana Pamukcular",    abbrev: "ADN", colors: ["#2874a6", "#ecf0f1"] },
  { name: "Konya Selcuklular",   abbrev: "KNY", colors: ["#145a32", "#f4d03f"] },
  { name: "Trabzon Kayikcilar",  abbrev: "TRB", colors: ["#5dade2", "#7b241c"] },
  { name: "Gaziantep Fistikcilar", abbrev: "GZT", colors: ["#b7950b", "#1b2631"] },
  { name: "Kayseri Erciyesliler", abbrev: "KYS", colors: ["#c0392b", "#f0f3f4"] },
  { name: "Eskisehir Lulesciler", abbrev: "ESK", colors: ["#1a1a1a", "#f39c12"] },
  { name: "Samsun Yaprakcilar",  abbrev: "SMS", colors: ["#c0392b", "#154360"] },
  { name: "Denizli Horozlar",    abbrev: "DNL", colors: ["#196f3d", "#e74c3c"] },
  { name: "Malatya Kayisiler",   abbrev: "MLT", colors: ["#a04000", "#f7dc6f"] },
  { name: "Sivas Yigitler",      abbrev: "SVS", colors: ["#7d3c98", "#ffffff"] },
  { name: "Erzurum Dadaslar",    abbrev: "ERZ", colors: ["#5d6d7e", "#2874a6"] },
  { name: "Mersin Limancilar",   abbrev: "MRS", colors: ["#0b5345", "#f4d03f"] },
  { name: "Rize Caycilar",       abbrev: "RIZ", colors: ["#145a32", "#5dade2"] },
  { name: "Van Kediler",         abbrev: "VAN", colors: ["#ecf0f1", "#2e86c1"] },
  { name: "Diyarbakir Karpuzlar", abbrev: "DYB", colors: ["#196f3d", "#c0392b"] },
  { name: "Sakarya Adapazarlilar", abbrev: "SKR", colors: ["#154360", "#f39c12"] },
  { name: "Manisa Mesirciler",   abbrev: "MNS", colors: ["#873600", "#f7dc6f"] },
  { name: "Aydin Incirciler",    abbrev: "AYD", colors: ["#6c3483", "#f0f3f4"] },
  { name: "Mugla Balcilar",      abbrev: "MGL", colors: ["#b9770e", "#1a1a1a"] },
  { name: "Tokat Bagcilar",      abbrev: "TKT", colors: ["#7d6608", "#ffffff"] },
  { name: "Corum Hititler",      abbrev: "CRM", colors: ["#5d4037", "#f4d03f"] },
  { name: "Elazig Harputlular",  abbrev: "ELZ", colors: ["#c0392b", "#1a1a1a"] },
  { name: "Kutahya Ciniciler",   abbrev: "KTH", colors: ["#1a5276", "#ecf0f1"] },
  { name: "Zonguldak Madenciler", abbrev: "ZNG", colors: ["#1b2631", "#f4d03f"] },
  { name: "Isparta Gulculer",    abbrev: "ISP", colors: ["#c2185b", "#ffffff"] },
  { name: "Afyon Mermerciler",   abbrev: "AFY", colors: ["#ecf0f1", "#5d6d7e"] },
  { name: "Nevsehir Peribacalari", abbrev: "NVS", colors: ["#a04000", "#f8c471"] },
  { name: "Kirikkale Celikciler", abbrev: "KRK", colors: ["#5d6d7e", "#e74c3c"] },
  { name: "Usak Halicilar",      abbrev: "USK", colors: ["#7b241c", "#f0f3f4"] },
  { name: "Edirne Pehlivanlar",  abbrev: "EDR", colors: ["#145a32", "#b7950b"] },
  { name: "Canakkale Bogazcilar", abbrev: "CNK", colors: ["#1a1a1a", "#5dade2"] },
  // Turkish third-division clubs, same styling as the block above.
  { name: "Adiyaman Nemrutlular",              abbrev: "ADI", colors: ["#c0392b", "#ffffff"] },
  { name: "Aksaray Tuzcular",                  abbrev: "AKS", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Balikesir Zeytinciler",             abbrev: "BAL", colors: ["#145a32", "#ecf0f1"] },
  { name: "Bartin Tekneciler",                 abbrev: "BTE", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Batman Petrolculer",                abbrev: "BAP", colors: ["#2980b9", "#ffffff"] },
  { name: "Bilecik Ipekciler",                 abbrev: "BII", colors: ["#e67e22", "#2c3e50"] },
  { name: "Bolu Ormancilar",                   abbrev: "BOO", colors: ["#16a085", "#ecf0f1"] },
  { name: "Burdur Gulyagcilar",                abbrev: "BUG", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Cankiri Tuzlacilar",                abbrev: "CAN", colors: ["#d35400", "#1a1a1a"] },
  { name: "Duzce Findikciler",                 abbrev: "DUZ", colors: ["#2c3e50", "#f39c12"] },
  { name: "Erzincan Bakircilar",               abbrev: "ERB", colors: ["#27ae60", "#ffffff"] },
  { name: "Hatay Baharatcilar",                abbrev: "HAT", colors: ["#922b21", "#f7dc6f"] },
  { name: "Kars Kazcilar",                     abbrev: "KAR", colors: ["#4a235a", "#d7bde2"] },
  { name: "Kastamonu Sarimsakcilar",           abbrev: "KAS", colors: ["#0e6251", "#f9e79f"] },
  { name: "Karaman Cobanlar",                  abbrev: "KAC", colors: ["#873600", "#fdebd0"] },
  { name: "Kirsehir Ahiler",                   abbrev: "KIA", colors: ["#154360", "#abebc6"] },
  { name: "Nigde Patatesciler",                abbrev: "NIG", colors: ["#6c3483", "#f4ecf7"] },
  { name: "Ordu Denizciler",                   abbrev: "ORD", colors: ["#784212", "#f6ddcc"] },
  // Dutch clubs (tids 320-359): real Dutch cities and towns with invented
  // Dutch trade/landscape suffixes (Molenaars/Turfschippers/Sluiswachters/
  // etc.), same fictional styling as the rest of the world. ASCII-only, and
  // deliberately avoiding every real club name and nickname (no Eagles, no
  // Sparta, no Excelsior, nothing built on a real club's badge). The
  // Netherlands is the strongest of the handicapped leagues — France's
  // immediate neighbour on the ladder, see COUNTRY_STRENGTH_OFFSET.
  { name: "Amsterdam Grachtwachters", abbrev: "AMT", colors: ["#c0392b", "#1a1a1a"] },
  { name: "Rotterdam Havenlieden", abbrev: "RTD", colors: ["#1b2631", "#f4d03f"] },
  { name: "Eindhoven Gloeikoppen", abbrev: "EIN", colors: ["#e74c3c", "#ffffff"] },
  { name: "Utrecht Domwachters",  abbrev: "UTR", colors: ["#c0392b", "#154360"] },
  { name: "Den Haag Duinridders", abbrev: "DHG", colors: ["#1a5276", "#f0f3f4"] },
  { name: "Groningen Veenmannen", abbrev: "GRO", colors: ["#0e6251", "#ffffff"] },
  { name: "Tilburg Wolkammers",   abbrev: "TLB", colors: ["#7d3c98", "#f7dc6f"] },
  { name: "Breda Turfschippers",  abbrev: "BRD", colors: ["#b7950b", "#1b2631"] },
  { name: "Nijmegen Waalzonen",   abbrev: "NIJ", colors: ["#196f3d", "#e74c3c"] },
  { name: "Enschede Twentenaren", abbrev: "ENS", colors: ["#c0392b", "#f0f3f4"] },
  { name: "Arnhem Rijnwachters",  abbrev: "ARN", colors: ["#1e8449", "#1a1a1a"] },
  { name: "Haarlem Zilvermeeuwen", abbrev: "HRL", colors: ["#5dade2", "#ecf0f1"] },
  { name: "Maastricht Mergelbrekers", abbrev: "MAA", colors: ["#873600", "#f8c471"] },
  { name: "Almere Polderbouwers", abbrev: "ALR", colors: ["#154360", "#5dade2"] },
  { name: "Apeldoorn Veluwelopers", abbrev: "APD", colors: ["#4a6741", "#f4d03f"] },
  { name: "Zwolle IJsselvaarders", abbrev: "ZWL", colors: ["#1a5276", "#e67e22"] },
  { name: "Leiden Sleutelhouders", abbrev: "LDN", colors: ["#7b241c", "#ffffff"] },
  { name: "Dordrecht Maasgangers", abbrev: "DDR", colors: ["#0b5345", "#f0f3f4"] },
  { name: "Deventer Hanzelieden", abbrev: "DVT", colors: ["#1b4f72", "#b7950b"] },
  { name: "Venlo Grensvaarders",  abbrev: "VNL", colors: ["#1e8449", "#1a1a1a"] },
  { name: "Delft Aardewerkers",   abbrev: "DFT", colors: ["#2874a6", "#ffffff"] },
  { name: "Helmond Smeden",       abbrev: "HLM", colors: ["#1a1a1a", "#e74c3c"] },
  { name: "Hilversum Omroepers",  abbrev: "HVS", colors: ["#6c3483", "#f0f3f4"] },
  { name: "Heerlen Mijnwerkers",  abbrev: "HRN", colors: ["#1b2631", "#f39c12"] },
  { name: "Leeuwarden Elfsteden", abbrev: "LWD", colors: ["#154360", "#ecf0f1"] },
  { name: "Sittard Grenswachters", abbrev: "SIT", colors: ["#196f3d", "#f7dc6f"] },
  { name: "Emmen Turfstekers",    abbrev: "EMM", colors: ["#7b241c", "#5d6d7e"] },
  { name: "Assen Hunebedders",    abbrev: "ASN", colors: ["#5d6d7e", "#f4d03f"] },
  { name: "Roosendaal Bietentelers", abbrev: "RSD", colors: ["#a04000", "#ecf0f1"] },
  { name: "Purmerend Marktlieden", abbrev: "PMR", colors: ["#0e6251", "#f8c471"] },
  { name: "Oss Vestingbouwers",   abbrev: "OSS", colors: ["#1a5276", "#e74c3c"] },
  { name: "Schiedam Scheepsbouwers", abbrev: "SCD", colors: ["#5d4037", "#ffffff"] },
  { name: "Vlaardingen Werfmannen", abbrev: "VLD", colors: ["#1b2631", "#5dade2"] },
  { name: "Gouda Kaarsenmakers",  abbrev: "GOU", colors: ["#b9770e", "#1a1a1a"] },
  { name: "Zeist Boslopers",      abbrev: "ZST", colors: ["#4a6741", "#f0f3f4"] },
  { name: "Kampen Koggevaarders", abbrev: "KMP", colors: ["#7d6608", "#154360"] },
  { name: "Middelburg Zeewachters", abbrev: "MDB", colors: ["#0b5345", "#f4d03f"] },
  { name: "Terneuzen Sluiswachters", abbrev: "TRZ", colors: ["#2874a6", "#f5b041"] },
  // Dutch third-division clubs, same styling as the block above.
  { name: "Alkmaar Kaasdragers",               abbrev: "AKA", colors: ["#c0392b", "#ffffff"] },
  { name: "Amersfoort Keientrekkers",          abbrev: "AMK", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Bergen Duinlopers",                 abbrev: "BED", colors: ["#145a32", "#ecf0f1"] },
  { name: "Doetinchem Achterhoekers",          abbrev: "DOE", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Ede Heidelopers",                   abbrev: "EDE", colors: ["#2980b9", "#ffffff"] },
  { name: "Emmeloord Polderaars",              abbrev: "EMP", colors: ["#e67e22", "#2c3e50"] },
  { name: "Gorinchem Lingewaarders",           abbrev: "GOL", colors: ["#16a085", "#ecf0f1"] },
  { name: "Harderwijk Vissersvolk",            abbrev: "HAV", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Heerenveen Friezen",                abbrev: "HEE", colors: ["#d35400", "#1a1a1a"] },
  { name: "Hengelo Metaalwerkers",             abbrev: "HEM", colors: ["#2c3e50", "#f39c12"] },
  { name: "Hoorn Zeevaarders",                 abbrev: "HOO", colors: ["#27ae60", "#ffffff"] },
  { name: "Katwijk Strandvissers",             abbrev: "KAT", colors: ["#922b21", "#f7dc6f"] },
  { name: "Lelystad Nieuwlanders",             abbrev: "LEL", colors: ["#4a235a", "#d7bde2"] },
  { name: "Meppel Nijveraars",                 abbrev: "MNI", colors: ["#0e6251", "#f9e79f"] },
  { name: "Sneek Watersporters",               abbrev: "SNE", colors: ["#873600", "#fdebd0"] },
  { name: "Veendam Turfstekers",               abbrev: "VEE", colors: ["#154360", "#abebc6"] },
  { name: "Weert Bosuilen",                    abbrev: "WEE", colors: ["#6c3483", "#f4ecf7"] },
  { name: "Zutphen Torenwachters",             abbrev: "ZUT", colors: ["#784212", "#f6ddcc"] },
  // Scottish clubs (tids 360-399): real Scottish burghs and towns with
  // invented Scots suffixes (Reivers/Kelpies/Drovers/etc.), same fictional
  // styling. ASCII-only, and deliberately steering clear of every real club
  // name and suffix — no Thistle, Albion, Accies, Caledonian, County, Rangers
  // or Athletic, and no town whose senior club is simply the town's own name.
  // Scotland is the weakest league on the pitch and the poorest off it (see
  // COUNTRY_STRENGTH_OFFSET and COUNTRY_BUDGET_SCALE), a two-point step below
  // Turkey rather than the one-point steps further up the ladder.
  { name: "Glasgow Kelpies",      abbrev: "GLK", colors: ["#154360", "#f4d03f"] },
  { name: "Edinburgh Claymores",  abbrev: "EDB", colors: ["#7b241c", "#ecf0f1"] },
  { name: "Perth Drovers",        abbrev: "PTH", colors: ["#1e8449", "#ffffff"] },
  { name: "Stirling Bannermen",   abbrev: "STG", colors: ["#5d4037", "#f8c471"] },
  { name: "Paisley Weavers",      abbrev: "PSL", colors: ["#1a5276", "#e74c3c"] },
  { name: "Inverness Highlanders", abbrev: "IVN", colors: ["#0e6251", "#f0f3f4"] },
  { name: "Dumfries Nithsiders",  abbrev: "DMF", colors: ["#6c3483", "#f4d03f"] },
  { name: "Kirkcaldy Linoleumers", abbrev: "KKD", colors: ["#873600", "#1a1a1a"] },
  { name: "Greenock Firthmen",    abbrev: "GRK", colors: ["#1b2631", "#5dade2"] },
  { name: "Bathgate Shalemen",    abbrev: "BTG", colors: ["#7d6608", "#ffffff"] },
  { name: "Musselburgh Honestmen", abbrev: "MSB", colors: ["#c0392b", "#f0f3f4"] },
  { name: "Galashiels Tweedsiders", abbrev: "GLS", colors: ["#196f3d", "#b7950b"] },
  { name: "Peebles Rowans",       abbrev: "PBL", colors: ["#1e8449", "#f0f3f4"] },
  { name: "Selkirk Souters",      abbrev: "SLK", colors: ["#5d4037", "#f4d03f"] },
  { name: "Melrose Abbeymen",     abbrev: "MLR", colors: ["#a04000", "#ecf0f1"] },
  { name: "Jedburgh Callants",    abbrev: "JDB", colors: ["#1a5276", "#f8c471"] },
  { name: "Kelso Tacksmen",       abbrev: "KLS", colors: ["#6c3483", "#ffffff"] },
  { name: "Lanark Lampmen",       abbrev: "LNK", colors: ["#b9770e", "#1b2631"] },
  { name: "Biggar Cairns",        abbrev: "BGR", colors: ["#0e6251", "#f7dc6f"] },
  { name: "Moffat Braes",         abbrev: "MFT", colors: ["#5d6d7e", "#e74c3c"] },
  { name: "Langholm Reivers",     abbrev: "LGH", colors: ["#1b2631", "#f4d03f"] },
  { name: "Annan Borderers",      abbrev: "ANN", colors: ["#196f3d", "#ffffff"] },
  // Scottish third-division clubs, same styling as the block above.
  { name: "Arbroath Cliffmen",                 abbrev: "ARB", colors: ["#c0392b", "#ffffff"] },
  { name: "Ayr Burghers",                      abbrev: "AYR", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Brechin Glensmen",                  abbrev: "BGL", colors: ["#145a32", "#ecf0f1"] },
  { name: "Dunbar Baxters",                    abbrev: "DUN", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Elgin Laichmen",                    abbrev: "ELG", colors: ["#2980b9", "#ffffff"] },
  { name: "Forfar Angusmen",                   abbrev: "FOR", colors: ["#e67e22", "#2c3e50"] },
  { name: "Montrose Basinmen",                 abbrev: "MON", colors: ["#16a085", "#ecf0f1"] },
  { name: "Nairn Firthmen",                    abbrev: "NAF", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Oban Puffers",                      abbrev: "OBA", colors: ["#d35400", "#1a1a1a"] },
  { name: "Thurso Norsemen",                   abbrev: "THU", colors: ["#2c3e50", "#f39c12"] },
  // Greek clubs (tids 400-439): real Greek cities and islands with invented
  // Greek-noun suffixes (Anemomyloi/Elaiones/Faroi/etc.), ASCII transliterations
  // throughout. Deliberately avoids every real club name and the -iakos/-ikos
  // club-name pattern, and steers clear of the real nicknames.
  { name: "Athina Anemomyloi",   abbrev: "ATH", colors: ["#1a5276", "#f0f3f4"] },
  { name: "Thessaloniki Faroi",  abbrev: "THS", colors: ["#7b241c", "#f4d03f"] },
  { name: "Patra Elaiones",      abbrev: "PTR", colors: ["#196f3d", "#ffffff"] },
  { name: "Irakleio Minoes",     abbrev: "IRK", colors: ["#0e6251", "#f8c471"] },
  { name: "Larisa Kentavroi",    abbrev: "LRS", colors: ["#5d4037", "#f7dc6f"] },
  { name: "Volos Argonaftes",    abbrev: "VLS", colors: ["#154360", "#5dade2"] },
  { name: "Ioannina Limnaioi",   abbrev: "IAN", colors: ["#1b2631", "#b7950b"] },
  { name: "Chania Amfores",      abbrev: "CHA", colors: ["#2874a6", "#ecf0f1"] },
  { name: "Kavala Kapnergates",  abbrev: "KVL", colors: ["#873600", "#f5b041"] },
  { name: "Serres Ampelourgoi",  abbrev: "SRR", colors: ["#4a6741", "#f0f3f4"] },
  { name: "Rodos Kastropolites", abbrev: "ROD", colors: ["#c0392b", "#1a1a1a"] },
  { name: "Kerkyra Kytharodoi",  abbrev: "KER", colors: ["#6c3483", "#f4d03f"] },
  { name: "Kalamata Sykies",     abbrev: "KLM", colors: ["#1e8449", "#ffffff"] },
  { name: "Xanthi Kapnades",     abbrev: "XNT", colors: ["#7d6608", "#1b2631"] },
  { name: "Komotini Thrakes",    abbrev: "KMT", colors: ["#7b241c", "#f0f3f4"] },
  { name: "Drama Dryades",       abbrev: "DRM", colors: ["#0e6251", "#f8c471"] },
  { name: "Kozani Krokades",     abbrev: "KZN", colors: ["#a04000", "#ffffff"] },
  { name: "Alexandroupoli Evrites", abbrev: "ALX", colors: ["#1b4f72", "#5dade2"] },
  { name: "Karditsa Sitares",    abbrev: "KRD", colors: ["#7d3c98", "#f7dc6f"] },
  { name: "Pyrgos Alfeioi",      abbrev: "PYR", colors: ["#196f3d", "#e74c3c"] },
  { name: "Korinthos Stafidades", abbrev: "KOR", colors: ["#1a5276", "#f4d03f"] },
  { name: "Tripoli Arkades",     abbrev: "TRP", colors: ["#5d4037", "#ecf0f1"] },
  { name: "Sparti Oplites",      abbrev: "SPT", colors: ["#c0392b", "#1a1a1a"] },
  { name: "Nafplio Kastelia",    abbrev: "NFP", colors: ["#0b5345", "#f5b041"] },
  { name: "Mytilini Ouzades",    abbrev: "MYT", colors: ["#2874a6", "#f0f3f4"] },
  { name: "Chios Mastichades",   abbrev: "CHS", colors: ["#4a6741", "#ffffff"] },
  { name: "Samos Ampelia",       abbrev: "SAM", colors: ["#7d6608", "#154360"] },
  { name: "Kos Ippokrates",      abbrev: "KOS", colors: ["#1e8449", "#f7dc6f"] },
  { name: "Naxos Marmaroi",      abbrev: "NXS", colors: ["#ecf0f1", "#2e86c1"] },
  { name: "Syros Karnagia",      abbrev: "SYR", colors: ["#1b2631", "#f39c12"] },
  // Greek third-division clubs, same styling as the block above.
  { name: "Agrinio Kapnofytoi",                abbrev: "AGR", colors: ["#c0392b", "#ffffff"] },
  { name: "Amfissa Ladades",                   abbrev: "AMF", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Arta Gefyrites",                    abbrev: "ART", colors: ["#145a32", "#ecf0f1"] },
  { name: "Edessa Katarraktes",                abbrev: "EDK", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Florina Arkoudes",                  abbrev: "FLO", colors: ["#2980b9", "#ffffff"] },
  { name: "Grevena Manitaria",                 abbrev: "GRE", colors: ["#e67e22", "#2c3e50"] },
  { name: "Kastoria Gounarades",               abbrev: "KAG", colors: ["#16a085", "#ecf0f1"] },
  { name: "Kilkis Oreinoi",                    abbrev: "KIL", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Lamia Thermopyles",                 abbrev: "LAM", colors: ["#d35400", "#1a1a1a"] },
  { name: "Naousa Oinopoioi",                  abbrev: "NAO", colors: ["#2c3e50", "#f39c12"] },
  { name: "Preveza Alieis",                    abbrev: "PRA", colors: ["#27ae60", "#ffffff"] },
  { name: "Veroia Rodakina",                   abbrev: "VRO", colors: ["#922b21", "#f7dc6f"] },
  // Serbian clubs (tids 440-479): real Serbian cities and towns with invented
  // Serbian-noun suffixes (Vitezovi/Splavari/Suncokreti/etc.), ASCII
  // transliterations (no carons or acutes). Deliberately avoids every real club
  // name and the recurring Serbian club words (Radnicki, Napredak, Partizan,
  // Zvezda, Vojvodina, Spartak, Mladost, Sloboda, Borac, Proleter). Serbia is
  // the weakest league on the pitch and the poorest off it.
  { name: "Beograd Splavari",    abbrev: "BGD", colors: ["#7b241c", "#ffffff"] },
  { name: "Novi Sad Dunavci",    abbrev: "NSD", colors: ["#154360", "#f4d03f"] },
  { name: "Nis Carevi",          abbrev: "NIS", colors: ["#1a1a1a", "#e74c3c"] },
  { name: "Kragujevac Topolivci", abbrev: "KGJ", colors: ["#5d6d7e", "#f0f3f4"] },
  { name: "Subotica Salasari",   abbrev: "SBT", colors: ["#1e8449", "#f7dc6f"] },
  { name: "Zrenjanin Ravnicari", abbrev: "ZRN", colors: ["#b9770e", "#1b2631"] },
  { name: "Pancevo Tkaci",       abbrev: "PNC", colors: ["#2874a6", "#ecf0f1"] },
  { name: "Cacak Vinogradari",   abbrev: "CCK", colors: ["#0e6251", "#f8c471"] },
  { name: "Krusevac Kruskari",   abbrev: "KRV", colors: ["#c0392b", "#1a1a1a"] },
  { name: "Kraljevo Bedemi",     abbrev: "KJV", colors: ["#4a6741", "#ffffff"] },
  { name: "Novi Pazar Carsijci", abbrev: "NPZ", colors: ["#196f3d", "#f4d03f"] },
  { name: "Smederevo Kovaci",    abbrev: "SMD", colors: ["#1b2631", "#f39c12"] },
  { name: "Zajecar Vinari",      abbrev: "ZJC", colors: ["#6c3483", "#f0f3f4"] },
  { name: "Kikinda Zetelci",     abbrev: "KKN", colors: ["#1e8449", "#f8c471"] },
  { name: "Sremska Mitrovica Legije", abbrev: "SRM", colors: ["#154360", "#e74c3c"] },
  { name: "Jagodina Pcelari",    abbrev: "JGD", colors: ["#b9770e", "#1a1a1a"] },
  { name: "Vrsac Lozari",        abbrev: "VRS", colors: ["#0e6251", "#ecf0f1"] },
  { name: "Bor Bakarci",         abbrev: "BOR", colors: ["#a04000", "#f5b041"] },
  { name: "Prokuplje Zitari",    abbrev: "PRK", colors: ["#4a6741", "#ffffff"] },
  { name: "Loznica Solari",      abbrev: "LZN", colors: ["#5d6d7e", "#f4d03f"] },
  { name: "Gornji Milanovac Kamenari", abbrev: "GML", colors: ["#1b4f72", "#f0f3f4"] },
  { name: "Backa Palanka Splavovi", abbrev: "BPL", colors: ["#196f3d", "#f7dc6f"] },
  { name: "Ruma Cardaci",        abbrev: "RUM", colors: ["#7d6608", "#ecf0f1"] },
  { name: "Aleksinac Ugljari",   abbrev: "ALE", colors: ["#1a1a1a", "#5dade2"] },
  // Serbian third-division clubs, same styling as the block above.
  { name: "Arandjelovac Banjari",              abbrev: "ABA", colors: ["#c0392b", "#ffffff"] },
  { name: "Becej Ribari",                      abbrev: "BEC", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Bogatic Macvani",                   abbrev: "BOG", colors: ["#145a32", "#ecf0f1"] },
  { name: "Despotovac Rudari",                 abbrev: "DES", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Indjija Sremci",                    abbrev: "IND", colors: ["#2980b9", "#ffffff"] },
  { name: "Ivanjica Planinari",                abbrev: "IVA", colors: ["#e67e22", "#2c3e50"] },
  { name: "Kanjiza Ciglari",                   abbrev: "KAN", colors: ["#16a085", "#ecf0f1"] },
  { name: "Knjazevac Stocari",                 abbrev: "KNJ", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Lajkovac Kolubarci",                abbrev: "LAJ", colors: ["#d35400", "#1a1a1a"] },
  { name: "Mladenovac Sumadinci",              abbrev: "MLA", colors: ["#2c3e50", "#f39c12"] },
  { name: "Obrenovac Savci",                   abbrev: "OBR", colors: ["#27ae60", "#ffffff"] },
  { name: "Pirot Cilimari",                    abbrev: "PIR", colors: ["#922b21", "#f7dc6f"] },
  // Brazilian clubs: real towns and cities with invented club nicknames, ASCII
  // only, following the same no-real-clubs rule as the rest of this table.
  { name: "Recife Jangadeiros", abbrev: "REI", colors: ["#c0392b", "#ffffff"] },
  { name: "Salvador Violeiros", abbrev: "SAV", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Fortaleza Capivaras", abbrev: "FOT", colors: ["#145a32", "#ecf0f1"] },
  { name: "Belem Rendeiras", abbrev: "BEL", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Manaus Garimpeiros", abbrev: "MAU", colors: ["#2980b9", "#ffffff"] },
  { name: "Curitiba Barqueiros", abbrev: "CUR", colors: ["#e67e22", "#2c3e50"] },
  { name: "Goiania Jacarandas", abbrev: "GOI", colors: ["#16a085", "#ecf0f1"] },
  { name: "Campinas Seringueiros", abbrev: "CAP", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Natal Caboclos", abbrev: "NAT", colors: ["#d35400", "#1a1a1a"] },
  { name: "Maceio Cajueiros", abbrev: "MAE", colors: ["#2c3e50", "#f39c12"] },
  { name: "Joao Pessoa Tropeiros", abbrev: "JOA", colors: ["#27ae60", "#ffffff"] },
  { name: "Teresina Sertanejos", abbrev: "TEE", colors: ["#922b21", "#f7dc6f"] },
  { name: "Sao Luis Sabias", abbrev: "SAO", colors: ["#4a235a", "#d7bde2"] },
  { name: "Aracaju Salineiros", abbrev: "ARC", colors: ["#0e6251", "#f9e79f"] },
  { name: "Florianopolis Cangaceiros", abbrev: "FLR", colors: ["#873600", "#fdebd0"] },
  { name: "Londrina Tucanos", abbrev: "LON", colors: ["#154360", "#abebc6"] },
  { name: "Ribeirao Preto Boiadeiros", abbrev: "RIB", colors: ["#1a1a1a", "#f4d03f"] },
  { name: "Sorocaba Vaqueiros", abbrev: "SOR", colors: ["#b03a2e", "#1b2631"] },
  { name: "Juiz de Fora Candangos", abbrev: "JUI", colors: ["#117864", "#f5b041"] },
  { name: "Uberlandia Coqueiros", abbrev: "UBR", colors: ["#5b2c6f", "#ffffff"] },
  // Brazilian division 2 clubs, same styling as the block above.
  { name: "Caxias do Sul Canoeiros", abbrev: "CAX", colors: ["#ffffff", "#1b4f72"] },
  { name: "Pelotas Lenhadores", abbrev: "PEL", colors: ["#f1c40f", "#145a32"] },
  { name: "Campo Grande Carnaubas", abbrev: "CGR", colors: ["#6e2c00", "#f8c471"] },
  { name: "Porto Velho Jangadeiros", abbrev: "POR", colors: ["#1f618d", "#e74c3c"] },
  { name: "Macapa Violeiros", abbrev: "MAP", colors: ["#239b56", "#f7dc6f"] },
  { name: "Boa Vista Capivaras", abbrev: "BOA", colors: ["#c0392b", "#ffffff"] },
  { name: "Palmas Rendeiras", abbrev: "PAA", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Joinville Garimpeiros", abbrev: "JOI", colors: ["#145a32", "#ecf0f1"] },
  { name: "Blumenau Barqueiros", abbrev: "BLU", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Maringa Jacarandas", abbrev: "MAG", colors: ["#2980b9", "#ffffff"] },
  { name: "Cascavel Seringueiros", abbrev: "CAV", colors: ["#e67e22", "#2c3e50"] },
  { name: "Chapeco Caboclos", abbrev: "CHP", colors: ["#16a085", "#ecf0f1"] },
  { name: "Itajai Cajueiros", abbrev: "ITA", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Volta Redonda Tropeiros", abbrev: "VOL", colors: ["#d35400", "#1a1a1a"] },
  { name: "Petropolis Sertanejos", abbrev: "PEO", colors: ["#2c3e50", "#f39c12"] },
  { name: "Niteroi Sabias", abbrev: "NIT", colors: ["#27ae60", "#ffffff"] },
  { name: "Bauru Salineiros", abbrev: "BAU", colors: ["#922b21", "#f7dc6f"] },
  { name: "Piracicaba Cangaceiros", abbrev: "PIC", colors: ["#4a235a", "#d7bde2"] },
  { name: "Jundiai Tucanos", abbrev: "JUN", colors: ["#0e6251", "#f9e79f"] },
  { name: "Limeira Boiadeiros", abbrev: "LIM", colors: ["#873600", "#fdebd0"] },
  // Brazilian division 3 clubs, same styling as the block above.
  { name: "Franca Vaqueiros", abbrev: "FRN", colors: ["#154360", "#abebc6"] },
  { name: "Presidente Prudente Candangos", abbrev: "PPR", colors: ["#1a1a1a", "#f4d03f"] },
  { name: "Marilia Coqueiros", abbrev: "MRI", colors: ["#b03a2e", "#1b2631"] },
  { name: "Araraquara Canoeiros", abbrev: "ARQ", colors: ["#117864", "#f5b041"] },
  { name: "Santarem Lenhadores", abbrev: "SAT", colors: ["#5b2c6f", "#ffffff"] },
  { name: "Imperatriz Carnaubas", abbrev: "IMP", colors: ["#ffffff", "#1b4f72"] },
  { name: "Mossoro Jangadeiros", abbrev: "MOO", colors: ["#f1c40f", "#145a32"] },
  { name: "Caruaru Violeiros", abbrev: "CAU", colors: ["#6e2c00", "#f8c471"] },
  { name: "Feira de Santana Capivaras", abbrev: "FEI", colors: ["#1f618d", "#e74c3c"] },
  { name: "Juazeiro Rendeiras", abbrev: "JUA", colors: ["#239b56", "#f7dc6f"] },
  { name: "Montes Claros Garimpeiros", abbrev: "MCL", colors: ["#c0392b", "#ffffff"] },
  { name: "Ipatinga Barqueiros", abbrev: "IPA", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Governador Valadares Jacarandas", abbrev: "GOV", colors: ["#145a32", "#ecf0f1"] },
  { name: "Divinopolis Seringueiros", abbrev: "DIV", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Anapolis Caboclos", abbrev: "ANA", colors: ["#2980b9", "#ffffff"] },
  { name: "Rio Verde Cajueiros", abbrev: "RIO", colors: ["#e67e22", "#2c3e50"] },
  { name: "Dourados Tropeiros", abbrev: "DOU", colors: ["#16a085", "#ecf0f1"] },
  { name: "Rondonopolis Sertanejos", abbrev: "ROO", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Parintins Sabias", abbrev: "PAI", colors: ["#d35400", "#1a1a1a"] },
  { name: "Arapiraca Salineiros", abbrev: "ARP", colors: ["#2c3e50", "#f39c12"] },
  // Argentine clubs: real towns and cities with invented club nicknames, ASCII
  // only, following the same no-real-clubs rule as the rest of this table.
  { name: "Rosario Arrieros", abbrev: "ROR", colors: ["#e67e22", "#2c3e50"] },
  { name: "Cordoba Payadores", abbrev: "COD", colors: ["#16a085", "#ecf0f1"] },
  { name: "Mendoza Chajaes", abbrev: "MEO", colors: ["#7f8c8d", "#e67e22"] },
  { name: "La Plata Esquiladores", abbrev: "LAP", colors: ["#d35400", "#1a1a1a"] },
  { name: "Mar del Plata Canoeros", abbrev: "MDE", colors: ["#2c3e50", "#f39c12"] },
  { name: "Tucuman Guanacos", abbrev: "TUC", colors: ["#27ae60", "#ffffff"] },
  { name: "Salta Molineros", abbrev: "SAA", colors: ["#922b21", "#f7dc6f"] },
  { name: "Santa Fe Vinateros", abbrev: "SFE", colors: ["#4a235a", "#d7bde2"] },
  { name: "San Juan Zorzales", abbrev: "SJU", colors: ["#0e6251", "#f9e79f"] },
  { name: "Resistencia Ceibos", abbrev: "RES", colors: ["#873600", "#fdebd0"] },
  { name: "Neuquen Troperos", abbrev: "NEU", colors: ["#154360", "#abebc6"] },
  { name: "Corrientes Horneros", abbrev: "COI", colors: ["#1a1a1a", "#f4d03f"] },
  { name: "Posadas Quebrachos", abbrev: "POS", colors: ["#b03a2e", "#1b2631"] },
  { name: "Bahia Blanca Chacareros", abbrev: "BAH", colors: ["#117864", "#f5b041"] },
  { name: "Parana Baqueanos", abbrev: "PAN", colors: ["#5b2c6f", "#ffffff"] },
  { name: "Santiago del Estero Calandrias", abbrev: "SDE", colors: ["#ffffff", "#1b4f72"] },
  { name: "Jujuy Tamberos", abbrev: "JUJ", colors: ["#f1c40f", "#145a32"] },
  { name: "Formosa Yerbateros", abbrev: "FOM", colors: ["#6e2c00", "#f8c471"] },
  { name: "La Rioja Carpinchos", abbrev: "LAR", colors: ["#1f618d", "#e74c3c"] },
  { name: "Catamarca Ombues", abbrev: "CTA", colors: ["#239b56", "#f7dc6f"] },
  { name: "Rafaela Hacheros", abbrev: "RAF", colors: ["#c0392b", "#ffffff"] },
  { name: "San Rafael Condores", abbrev: "SRA", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Villa Carlos Paz Algarrobos", abbrev: "VCP", colors: ["#145a32", "#ecf0f1"] },
  { name: "Chilecito Arrieros", abbrev: "CHL", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Rio Grande Payadores", abbrev: "RGR", colors: ["#2980b9", "#ffffff"] },
  { name: "Cipolletti Chajaes", abbrev: "CIP", colors: ["#e67e22", "#2c3e50"] },
  { name: "Alta Gracia Esquiladores", abbrev: "ALG", colors: ["#16a085", "#ecf0f1"] },
  { name: "Zapala Canoeros", abbrev: "ZAP", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Concepcion del Uruguay Guanacos", abbrev: "CDU", colors: ["#d35400", "#1a1a1a"] },
  { name: "Saenz Pena Molineros", abbrev: "SPE", colors: ["#2c3e50", "#f39c12"] },
  // Argentine division 2 clubs, same styling as the block above.
  { name: "San Luis Hacheros", abbrev: "SLU", colors: ["#c0392b", "#ffffff"] },
  { name: "Rio Cuarto Condores", abbrev: "RCU", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Tandil Algarrobos", abbrev: "TAN", colors: ["#145a32", "#ecf0f1"] },
  { name: "Olavarria Arrieros", abbrev: "OLA", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Pergamino Payadores", abbrev: "PEG", colors: ["#2980b9", "#ffffff"] },
  { name: "Junin Chajaes", abbrev: "JNI", colors: ["#e67e22", "#2c3e50"] },
  { name: "Zarate Esquiladores", abbrev: "ZAA", colors: ["#16a085", "#ecf0f1"] },
  { name: "Campana Canoeros", abbrev: "CMP", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Lujan Guanacos", abbrev: "LUJ", colors: ["#d35400", "#1a1a1a"] },
  { name: "Chivilcoy Molineros", abbrev: "CHI", colors: ["#2c3e50", "#f39c12"] },
  { name: "Azul Vinateros", abbrev: "AZU", colors: ["#27ae60", "#ffffff"] },
  { name: "Necochea Zorzales", abbrev: "NEC", colors: ["#922b21", "#f7dc6f"] },
  { name: "Trelew Ceibos", abbrev: "TRE", colors: ["#4a235a", "#d7bde2"] },
  { name: "Comodoro Rivadavia Troperos", abbrev: "CRI", colors: ["#0e6251", "#f9e79f"] },
  { name: "Rio Gallegos Horneros", abbrev: "RGA", colors: ["#873600", "#fdebd0"] },
  { name: "Ushuaia Quebrachos", abbrev: "USH", colors: ["#154360", "#abebc6"] },
  { name: "Bariloche Chacareros", abbrev: "BAO", colors: ["#1a1a1a", "#f4d03f"] },
  { name: "Viedma Baqueanos", abbrev: "VIE", colors: ["#b03a2e", "#1b2631"] },
  { name: "Santa Rosa Calandrias", abbrev: "SRO", colors: ["#117864", "#f5b041"] },
  { name: "General Roca Tamberos", abbrev: "GEE", colors: ["#5b2c6f", "#ffffff"] },
  { name: "Pehuajo Arrieros", abbrev: "PEH", colors: ["#c0392b", "#ffffff"] },
  { name: "Nueve de Julio Payadores", abbrev: "NDJ", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Trenque Lauquen Chajaes", abbrev: "TRL", colors: ["#145a32", "#ecf0f1"] },
  { name: "Coronel Suarez Esquiladores", abbrev: "COS", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Chascomus Canoeros", abbrev: "CHM", colors: ["#2980b9", "#ffffff"] },
  { name: "Dolores Guanacos", abbrev: "DOL", colors: ["#e67e22", "#2c3e50"] },
  { name: "San Pedro Molineros", abbrev: "SPD", colors: ["#16a085", "#ecf0f1"] },
  { name: "Baradero Vinateros", abbrev: "BDR", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Rufino Zorzales", abbrev: "RUF", colors: ["#d35400", "#1a1a1a"] },
  { name: "Casilda Ceibos", abbrev: "CSL", colors: ["#2c3e50", "#f39c12"] },
  { name: "Esperanza Troperos", abbrev: "ESR", colors: ["#27ae60", "#ffffff"] },
  { name: "Gualeguay Horneros", abbrev: "GUY", colors: ["#922b21", "#f7dc6f"] },
  { name: "Crespo Quebrachos", abbrev: "CRP", colors: ["#4a235a", "#d7bde2"] },
  { name: "Tafi Viejo Chacareros", abbrev: "TAF", colors: ["#0e6251", "#f9e79f"] },
  { name: "Monteros Baqueanos", abbrev: "MTR", colors: ["#873600", "#fdebd0"] },
  { name: "Aguilares Calandrias", abbrev: "AGL", colors: ["#154360", "#abebc6"] },
  // Argentine division 3 clubs, same styling as the block above.
  { name: "Villa Maria Yerbateros", abbrev: "VIL", colors: ["#ffffff", "#1b4f72"] },
  { name: "San Francisco Carpinchos", abbrev: "SFR", colors: ["#f1c40f", "#145a32"] },
  { name: "Venado Tuerto Ombues", abbrev: "VTU", colors: ["#6e2c00", "#f8c471"] },
  { name: "Reconquista Hacheros", abbrev: "REO", colors: ["#1f618d", "#e74c3c"] },
  { name: "Concordia Condores", abbrev: "COC", colors: ["#239b56", "#f7dc6f"] },
  { name: "Gualeguaychu Algarrobos", abbrev: "GUL", colors: ["#c0392b", "#ffffff"] },
  { name: "Goya Arrieros", abbrev: "GOY", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Obera Payadores", abbrev: "OBE", colors: ["#145a32", "#ecf0f1"] },
  { name: "Tartagal Chajaes", abbrev: "TAT", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Oran Esquiladores", abbrev: "ORA", colors: ["#2980b9", "#ffffff"] },
  { name: "Clorinda Canoeros", abbrev: "CLO", colors: ["#e67e22", "#2c3e50"] },
  { name: "San Nicolas Guanacos", abbrev: "SNI", colors: ["#16a085", "#ecf0f1"] },
  { name: "Balcarce Molineros", abbrev: "BAC", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Bragado Vinateros", abbrev: "BRO", colors: ["#d35400", "#1a1a1a"] },
  { name: "Chacabuco Zorzales", abbrev: "CHC", colors: ["#2c3e50", "#f39c12"] },
  { name: "Tres Arroyos Ceibos", abbrev: "TRA", colors: ["#27ae60", "#ffffff"] },
  { name: "Villa Mercedes Troperos", abbrev: "VME", colors: ["#922b21", "#f7dc6f"] },
  { name: "Esquel Horneros", abbrev: "ESQ", colors: ["#4a235a", "#d7bde2"] },
  { name: "Cafayate Quebrachos", abbrev: "CAF", colors: ["#0e6251", "#f9e79f"] },
  { name: "Puerto Madryn Chacareros", abbrev: "PUE", colors: ["#873600", "#fdebd0"] },
  // Mexican clubs: real towns and cities with invented club nicknames, ASCII
  // only, following the same no-real-clubs rule as the rest of this table.
  { name: "Guadalajara Magueyeros", abbrev: "GUD", colors: ["#27ae60", "#ffffff"] },
  { name: "Puebla Cocuyos", abbrev: "PUB", colors: ["#922b21", "#f7dc6f"] },
  { name: "Leon Huaraches", abbrev: "LEN", colors: ["#4a235a", "#d7bde2"] },
  { name: "Queretaro Magueyeros", abbrev: "QUR", colors: ["#0e6251", "#f9e79f"] },
  { name: "Merida Cocuyos", abbrev: "MER", colors: ["#873600", "#fdebd0"] },
  { name: "Tijuana Huaraches", abbrev: "TIJ", colors: ["#154360", "#abebc6"] },
  { name: "Chihuahua Magueyeros", abbrev: "CHH", colors: ["#1a1a1a", "#f4d03f"] },
  { name: "Hermosillo Cocuyos", abbrev: "HER", colors: ["#b03a2e", "#1b2631"] },
  { name: "Culiacan Huaraches", abbrev: "CUL", colors: ["#117864", "#f5b041"] },
  { name: "Aguascalientes Magueyeros", abbrev: "AGU", colors: ["#5b2c6f", "#ffffff"] },
  { name: "Morelia Cocuyos", abbrev: "MOE", colors: ["#ffffff", "#1b4f72"] },
  { name: "Saltillo Huaraches", abbrev: "SAI", colors: ["#f1c40f", "#145a32"] },
  { name: "Veracruz Magueyeros", abbrev: "VEA", colors: ["#6e2c00", "#f8c471"] },
  { name: "Acapulco Cocuyos", abbrev: "ACP", colors: ["#1f618d", "#e74c3c"] },
  { name: "Oaxaca Huaraches", abbrev: "OAX", colors: ["#239b56", "#f7dc6f"] },
  { name: "Cancun Magueyeros", abbrev: "CNC", colors: ["#c0392b", "#ffffff"] },
  { name: "Durango Cocuyos", abbrev: "DUR", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Tepic Huaraches", abbrev: "TEP", colors: ["#145a32", "#ecf0f1"] },
  // Mexican division 2 clubs, same styling as the block above.
  { name: "Colima Magueyeros", abbrev: "COL", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Tampico Cocuyos", abbrev: "TAM", colors: ["#2980b9", "#ffffff"] },
  { name: "Mazatlan Huaraches", abbrev: "MAZ", colors: ["#e67e22", "#2c3e50"] },
  { name: "Ensenada Magueyeros", abbrev: "ENE", colors: ["#16a085", "#ecf0f1"] },
  { name: "Mexicali Cocuyos", abbrev: "MEX", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Torreon Huaraches", abbrev: "TOE", colors: ["#d35400", "#1a1a1a"] },
  { name: "Irapuato Magueyeros", abbrev: "IRA", colors: ["#2c3e50", "#f39c12"] },
  { name: "Celaya Cocuyos", abbrev: "CEA", colors: ["#27ae60", "#ffffff"] },
  { name: "Uruapan Huaraches", abbrev: "URU", colors: ["#922b21", "#f7dc6f"] },
  { name: "Tuxtla Gutierrez Magueyeros", abbrev: "TUX", colors: ["#4a235a", "#d7bde2"] },
  { name: "Villahermosa Cocuyos", abbrev: "VIA", colors: ["#0e6251", "#f9e79f"] },
  { name: "Campeche Huaraches", abbrev: "CME", colors: ["#873600", "#fdebd0"] },
  { name: "Chetumal Magueyeros", abbrev: "CHE", colors: ["#154360", "#abebc6"] },
  { name: "Tlaxcala Cocuyos", abbrev: "TLA", colors: ["#1a1a1a", "#f4d03f"] },
  { name: "Cuernavaca Huaraches", abbrev: "CUE", colors: ["#b03a2e", "#1b2631"] },
  { name: "San Luis Potosi Magueyeros", abbrev: "SLP", colors: ["#117864", "#f5b041"] },
  // Mexican division 3 clubs, same styling as the block above.
  { name: "Ciudad Juarez Cocuyos", abbrev: "CIU", colors: ["#5b2c6f", "#ffffff"] },
  { name: "Matamoros Huaraches", abbrev: "MAT", colors: ["#ffffff", "#1b4f72"] },
  { name: "Reynosa Magueyeros", abbrev: "REY", colors: ["#f1c40f", "#145a32"] },
  { name: "Nuevo Laredo Cocuyos", abbrev: "NUE", colors: ["#6e2c00", "#f8c471"] },
  { name: "Los Mochis Huaraches", abbrev: "LMO", colors: ["#1f618d", "#e74c3c"] },
  { name: "Ciudad Obregon Magueyeros", abbrev: "COB", colors: ["#239b56", "#f7dc6f"] },
  { name: "La Paz Cocuyos", abbrev: "LPA", colors: ["#c0392b", "#ffffff"] },
  { name: "Guanajuato Huaraches", abbrev: "GUN", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Zamora Magueyeros", abbrev: "ZAM", colors: ["#145a32", "#ecf0f1"] },
  { name: "Tehuacan Cocuyos", abbrev: "TEH", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Coatzacoalcos Huaraches", abbrev: "COA", colors: ["#2980b9", "#ffffff"] },
  { name: "Poza Rica Magueyeros", abbrev: "PRI", colors: ["#e67e22", "#2c3e50"] },
  { name: "Salamanca Cocuyos", abbrev: "SAC", colors: ["#16a085", "#ecf0f1"] },
  { name: "Orizaba Huaraches", abbrev: "ORI", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Zacatecas Magueyeros", abbrev: "ZAC", colors: ["#d35400", "#1a1a1a"] },
  { name: "Monclova Cocuyos", abbrev: "MOC", colors: ["#2c3e50", "#f39c12"] },
  // US clubs: real towns and cities with invented club nicknames, ASCII
  // only, following the same no-real-clubs rule as the rest of this table.
  //
  // The top flight's 30 are ORDERED BY GEOGRAPHY: the first fifteen are the
  // Eastern Conference and the last fifteen the Western, because a club's
  // conference is seeded from its slot order (see core/conferences.ts). Keep new
  // entries on the right side of that line.
  // Eastern Conference
  { name: "Providence Flatboatmen", abbrev: "PRO", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Hartford Canalmen", abbrev: "HAF", colors: ["#2980b9", "#ffffff"] },
  { name: "Worcester Hatters", abbrev: "WOR", colors: ["#922b21", "#f7dc6f"] },
  { name: "Buffalo Glassblowers", abbrev: "BUF", colors: ["#e67e22", "#2c3e50"] },
  { name: "Rochester Surveyors", abbrev: "ROC", colors: ["#16a085", "#ecf0f1"] },
  { name: "Syracuse Lamplighters", abbrev: "SYA", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Harrisburg Brickmakers", abbrev: "HBG", colors: ["#4a235a", "#d7bde2"] },
  { name: "Richmond Millwrights", abbrev: "RIC", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Norfolk Ironmasters", abbrev: "NOF", colors: ["#145a32", "#ecf0f1"] },
  { name: "Greensboro Weavers", abbrev: "GRB", colors: ["#0e6251", "#f9e79f"] },
  { name: "Savannah Tinsmiths", abbrev: "SAH", colors: ["#c0392b", "#ffffff"] },
  { name: "Knoxville Tanners", abbrev: "KNO", colors: ["#239b56", "#f7dc6f"] },
  { name: "Chattanooga Smelters", abbrev: "CHT", colors: ["#873600", "#fdebd0"] },
  { name: "Akron Sawyers", abbrev: "AKR", colors: ["#d35400", "#1a1a1a"] },
  { name: "Dayton Chandlers", abbrev: "DAY", colors: ["#2c3e50", "#f39c12"] },
  // Western Conference
  { name: "Des Moines Cordwainers", abbrev: "DMO", colors: ["#6e2c00", "#f8c471"] },
  { name: "Omaha Coopers", abbrev: "OMA", colors: ["#154360", "#abebc6"] },
  { name: "Wichita Farriers", abbrev: "WIC", colors: ["#f1c40f", "#145a32"] },
  { name: "Tulsa Keelboats", abbrev: "TUL", colors: ["#1a1a1a", "#f4d03f"] },
  { name: "Little Rock Drovers", abbrev: "LIT", colors: ["#1f618d", "#e74c3c"] },
  { name: "Albuquerque Riveters", abbrev: "ALU", colors: ["#117864", "#f5b041"] },
  { name: "Colorado Springs Wagoners", abbrev: "CSP", colors: ["#b03a2e", "#1b2631"] },
  { name: "Ogden Lumbermen", abbrev: "OGD", colors: ["#117864", "#f5b041"] },
  { name: "Provo Tollkeepers", abbrev: "PRV", colors: ["#5b2c6f", "#ffffff"] },
  { name: "Boise Bargemen", abbrev: "BOI", colors: ["#b03a2e", "#1b2631"] },
  { name: "Spokane Ropemakers", abbrev: "SPO", colors: ["#5b2c6f", "#ffffff"] },
  { name: "Tacoma Loggers", abbrev: "TAC", colors: ["#154360", "#abebc6"] },
  { name: "Sacramento Assayers", abbrev: "SAR", colors: ["#f1c40f", "#145a32"] },
  { name: "Modesto Blacksmiths", abbrev: "MDS", colors: ["#1a1a1a", "#f4d03f"] },
  { name: "Fresno Wheelwrights", abbrev: "FRS", colors: ["#ffffff", "#1b4f72"] },
  // US division 2 clubs, same styling as the block above. 25 clubs, ORDERED BY
  // GEOGRAPHY like the top flight: the first thirteen are the Eastern Conference,
  // the last twelve the Western (see core/conferences.ts, which gives the odd
  // club to the first half).
  // Eastern Conference
  { name: "Toledo Quarrymen", abbrev: "TOD", colors: ["#27ae60", "#ffffff"] },
  { name: "Grand Rapids Homesteaders", abbrev: "GRD", colors: ["#922b21", "#f7dc6f"] },
  { name: "Madison Stonecutters", abbrev: "MAS", colors: ["#4a235a", "#d7bde2"] },
  { name: "Lansing Toolmakers", abbrev: "LNS", colors: ["#0e6251", "#f9e79f"] },
  { name: "Evansville Boatwrights", abbrev: "EVA", colors: ["#873600", "#fdebd0"] },
  { name: "Lexington Coopers", abbrev: "LEX", colors: ["#0e6251", "#f9e79f"] },
  { name: "Roanoke Railmen", abbrev: "RNK", colors: ["#154360", "#abebc6"] },
  { name: "Wilmington Pilots", abbrev: "WLM", colors: ["#1a1a1a", "#f4d03f"] },
  { name: "Charleston Shipwrights", abbrev: "CSN", colors: ["#b03a2e", "#1b2631"] },
  { name: "Greenville Spinners", abbrev: "GVL", colors: ["#117864", "#f5b041"] },
  { name: "Columbia Printers", abbrev: "CMB", colors: ["#5b2c6f", "#ffffff"] },
  { name: "Huntsville Machinists", abbrev: "HSV", colors: ["#ffffff", "#1b4f72"] },
  { name: "Memphis Keelboats", abbrev: "MEM", colors: ["#873600", "#fdebd0"] },
  // Western Conference
  { name: "Shreveport Riveters", abbrev: "SHR", colors: ["#1a1a1a", "#f4d03f"] },
  { name: "Corpus Christi Drovers", abbrev: "CCH", colors: ["#f1c40f", "#145a32"] },
  { name: "El Paso Wheelwrights", abbrev: "ELP", colors: ["#117864", "#f5b041"] },
  { name: "Lubbock Farriers", abbrev: "LUB", colors: ["#5b2c6f", "#ffffff"] },
  { name: "Amarillo Cordwainers", abbrev: "AMR", colors: ["#ffffff", "#1b4f72"] },
  { name: "Tucson Tanners", abbrev: "TUS", colors: ["#6e2c00", "#f8c471"] },
  { name: "Pueblo Steelmen", abbrev: "PUO", colors: ["#1f618d", "#e74c3c"] },
  { name: "Sioux Falls Glassblowers", abbrev: "SIO", colors: ["#8e44ad", "#f1c40f"] },
  { name: "Fargo Surveyors", abbrev: "FAG", colors: ["#2980b9", "#ffffff"] },
  { name: "Reno Tinsmiths", abbrev: "RNO", colors: ["#1f618d", "#e74c3c"] },
  { name: "Bakersfield Flatboatmen", abbrev: "BAF", colors: ["#1b4f72", "#f4d03f"] },
  { name: "Visalia Growers", abbrev: "VSL", colors: ["#239b56", "#f7dc6f"] },
  // US division 3 clubs, same styling as the block above.
  { name: "Billings Lamplighters", abbrev: "BIG", colors: ["#e67e22", "#2c3e50"] },
  { name: "Cheyenne Sawyers", abbrev: "CHY", colors: ["#16a085", "#ecf0f1"] },
  { name: "Lincoln Chandlers", abbrev: "LIN", colors: ["#7f8c8d", "#e67e22"] },
  { name: "Topeka Quarrymen", abbrev: "TOP", colors: ["#d35400", "#1a1a1a"] },
  { name: "Peoria Homesteaders", abbrev: "PEI", colors: ["#2c3e50", "#f39c12"] },
  { name: "Rockford Stonecutters", abbrev: "ROK", colors: ["#27ae60", "#ffffff"] },
  { name: "Fort Wayne Coopers", abbrev: "FWA", colors: ["#922b21", "#f7dc6f"] },
  { name: "South Bend Keelboats", abbrev: "SOU", colors: ["#4a235a", "#d7bde2"] },
  { name: "Scranton Bargemen", abbrev: "SCR", colors: ["#0e6251", "#f9e79f"] },
  { name: "Allentown Riveters", abbrev: "ALL", colors: ["#873600", "#fdebd0"] },
  { name: "Burlington Ropemakers", abbrev: "BUL", colors: ["#154360", "#abebc6"] },
  { name: "Duluth Wheelwrights", abbrev: "DUL", colors: ["#1a1a1a", "#f4d03f"] },
  { name: "Missoula Farriers", abbrev: "MIS", colors: ["#b03a2e", "#1b2631"] },
  { name: "Flagstaff Cordwainers", abbrev: "FLA", colors: ["#117864", "#f5b041"] },
  { name: "Yakima Drovers", abbrev: "YAK", colors: ["#5b2c6f", "#ffffff"] },
  { name: "Macon Tanners", abbrev: "MAO", colors: ["#ffffff", "#1b4f72"] },
  { name: "Casper Wildcatters", abbrev: "CPW", colors: ["#784212", "#f6ddcc"] },
];

/**
 * A call the user can make on an academy kid at the next rollover: keep or
 * release at the scholarship cut, promote or release at the professional cut.
 * See `StoredTeam.academyDecisions` and core/academyPipeline.ts.
 */
export type AcademyChoice = "keep" | "release" | "promote";

export interface StoredTeam {
  tid: number;
  name: string;
  abbrev: string;
  colors: [string, string];
  roster: number[];
  /**
   * The user's own youth-academy holding pool (see YOUTH_CONTRACT_LENGTH /
   * ACADEMY_STIPEND_WEEKLY in constants.ts): prospects here draw a flat
   * stipend, can't be transferred, and need an explicit "promote" action to
   * join `roster`. AI clubs' youth intake still lands straight on `roster`
   * (unchanged) — only the user's academy is a real holding pool — so this
   * stays empty for every AI team.
   */
  academyRoster: number[];
  /**
   * Which half of a split top flight this club plays its schedule in — 0 or 1,
   * MLS's Eastern/Western Conference or Argentina's Zone A/B (see
   * ConferenceFormat). Absent in a single table. Optional, and never required:
   * `conferenceMembers` seats a club without one wherever there is room, which
   * is what makes it sticky across promotion without being a migration.
   */
  conference?: number;
  /**
   * The user's own calls on academy kids at the next rollover, by pid. A kid
   * with no entry gets the scouts' default (see core/academyPipeline.ts): keep
   * or release at the scholarship cut, promote or release at the professional
   * cut. Only choices that fit are accepted (`setAcademyDecision`), the rollover
   * applies them and then clears the whole map, and a club switch drops it.
   *
   * **User's club only.** Optional, absent = every kid on his default, so there
   * is nothing to migrate.
   */
  academyDecisions?: Record<number, AcademyChoice>;
  /**
   * Countries the user has sent his youth scouts to, capped at
   * SCOUTING_REGION_MAX. They supply SCOUTING_REGION_SHARE of his academy's
   * yearly intake between them; his league's own nationality mix supplies the rest.
   *
   * **User's club only** — an AI club's intake is drawn from its league's mix
   * as it always was. Rating-neutral either way: nationality decides a player's
   * name and who can cap him, never how good he is.
   *
   * Optional; `migrate.ts` backfills `[]` (absent = scouts stay home).
   */
  scoutingRegions?: string[];
  /**
   * Positions the user has told his youth scouts to look for, capped at
   * SCOUT_POSITION_MAX. They take SCOUT_POSITION_SHARE of the SCOUTED part of
   * his academy's yearly intake between them; roster demand supplies the rest.
   *
   * **Reaches less of the group than `scoutingRegions` does, and that is a
   * constraint rather than a decision** — a country is relabelled onto the
   * whole group after the fact because nationality is rating-neutral, while a
   * position decides which tier row a player's ratings are rolled from, so it
   * can only apply where the ratings are still being rolled on a private
   * stream. See SCOUT_POSITION_SHARE.
   *
   * **User's club only.** Optional; `migrate.ts` backfills `[]`.
   */
  scoutingPositions?: Position[];
  /** Funds available to spend on wages, transfers, and scouting. */
  budget: number;
  /** Fame/popularity, 0-100; drives a damped ticket/jersey revenue channel. */
  hype: number;
  /**
   * The scouting spend locked in for the *current* season: deducted from
   * budget at season-end settlement, lowers transfer valuation noise, and
   * sharpens the user's potential fog-of-war (see potentialFog.ts). Only
   * changeable at the offseason boundary (it's set from nextScoutingSpend
   * there) — never mid-season — so a player can't crank scouting up to peek
   * at sharper info and turn it back down before paying.
   */
  scoutingSpend: number;
  /**
   * The scouting spend the user is setting for the *upcoming* season, editable
   * only during the offseason phase; becomes scoutingSpend at the next
   * offseason rollover. Kept equal to scoutingSpend for AI teams (they never
   * edit it) and for the user outside the offseason editing window.
   */
  nextScoutingSpend: number;
  /** Fixed generation-time strength anchor for this club's youth intake (see LeagueTeam.academyBase). */
  academyBase: number;
  /** Which competition this club currently plays in (see src/core/competitions.ts). Changes on promotion/relegation. */
  compId: number;
  /**
   * Non-null while academyBase is still converging toward this competition's
   * strength band after a promotion/relegation swap (see src/core/promotion.ts).
   * Null for a club that hasn't swapped divisions (or finished converging).
   */
  divisionConvergence: { seasonsRemaining: number } | null;
  /**
   * The formation this club lines up in (see FORMATIONS in
   * src/core/lineup/formations.js). The user picks theirs on the Roster page;
   * every AI team stays at the "4-3-3" default. Drives which 11 slots the XI
   * fills, so it feeds the real match sim, not just the pitch display.
   */
  formation: FormationId;
  /**
   * User-chosen starting XI (11 pids), or null to auto-select via selectXI.
   * Only ever set for the user's own team; AI teams always auto-select.
   */
  starters: number[] | null;
  /**
   * Pids the user has explicitly listed for transfer — a lower bar than
   * AI_MARKET_MIN_SURPLUS and priority within INBOUND_OFFERS_MAX for
   * inboundOfferCandidates (src/core/transfers/inboundOffers.ts), signaling
   * real willingness to sell rather than guaranteeing a buyer. Only ever set
   * for the user's own team; AI clubs never list (they already shop/sell via
   * the AI↔AI market's own evaluation).
   */
  transferListed: number[];
  /**
   * Pids the user has flagged to "give more minutes": in-match, the sub logic
   * favors bringing these bench players on (see SUB_MINUTES_BOOST). Only ever
   * set for the user's own team — AI clubs never flag — so it stays empty for
   * every AI team.
   */
  moreMinutes: number[];
  /**
   * Scouting fog-of-war: pid → the season the player was first seen on this
   * club's senior roster, so the user's potential estimate for him sharpens
   * with tenure (see src/core/scouting/potentialFog.ts). Only ever populated
   * for the user's own team — AI clubs don't have a fogged view — so it stays
   * an empty object for every AI team.
   */
  scoutingObserved: Record<number, number>;
  /**
   * This club's identity came from an imported roster file, so the built-in
   * crest art for its slot is not its crest and must not be drawn (see
   * ClubCrest). Crest images are keyed by tid — a slot — not by club, because a
   * club's name is editable while its tid never changes; that is right for the
   * shipped fictional clubs and wrong the moment a slot becomes a real club,
   * which would otherwise show Real Madrid wearing an English club's badge.
   * Such a club falls back to its two-color swatch, which the roster file
   * supplies. Absent on old saves and on every club an import didn't touch.
   */
  importedIdentity?: boolean;
}

/**
 * Zip club identities onto league teams: CLUBS[tid] provides the name,
 * abbreviation, and colors for each team. Season 1 starts like every other
 * season: the base allocation arrives and the initial squad's wages come
 * straight out of it, so a club's opening budget is its genuinely spendable
 * cash (expensive squads start with less of it).
 *
 * Difficulty scales the user's opening budget, but scales the SURPLUS (what's
 * left after wages) rather than the base allocation — deliberately different
 * from every later season, which scales income and lets the wage bill bite.
 * Scaling the allocation here would start a Brutal save at an expensive club
 * already in the red, before the user has made a single decision; scaling a
 * post-wage figure that is positive by construction never can. From season 2
 * on, `chargeSeasonStart` in offseason.ts applies the scale the normal way and
 * going broke becomes a consequence of how the user runs the club.
 */
/**
 * The shipped club block for a country, or null for a country the game does not
 * ship (one the player added). Derived from the shipped world's own tid layout
 * rather than from hardcoded block bounds, so it cannot drift from CLUBS.
 */
export function shippedClubsFor(country: string): ClubIdentity[] | null {
  const range = SHIPPED_RANGES.find((r) => r.country === country);
  return range ? CLUBS.slice(range.start, range.end) : null;
}

const SHIPPED_RANGES = countryClubRanges(worldCompetitions());

/**
 * The `count` club identities a country's clubs take, in slot order: its shipped
 * block where the game has one, generated names where it doesn't (and for any
 * slot past the end of a shipped block).
 *
 * Shared by world creation and by the new-league club picker, which is the point
 * — the picker previews clubs for a world that does not exist yet, so the two
 * must derive names the same way or the save renames every club the moment it
 * opens.
 */
export function clubIdentitiesFor(country: string, count: number): ClubIdentity[] {
  const shipped = shippedClubsFor(country);
  if (shipped && shipped.length >= count) return shipped.slice(0, count);
  const generated = generateClubIdentities(country, count);
  return Array.from({ length: count }, (_, i) => shipped?.[i] ?? generated[i]);
}

/**
 * Every club's identity, keyed by tid: its country's shipped block where there
 * is one, generated names where there isn't.
 *
 * Anchored to the club's **position within its own country**, never to its
 * absolute tid. That distinction is load-bearing the moment the world stops
 * being the shipped one: tids are handed out per country in table order, so
 * leaving a country out (or adding one ahead of another) shifts every later
 * country's tids, and a tid-indexed lookup would then hand Spain's clubs
 * England's names. Indexing within the country is invariant to both.
 *
 * For the shipped world this is exactly the old tid lookup — the country blocks
 * are contiguous and in the same order — which a test pins.
 */
function clubIdentities(
  league: League,
  competitions: Competition[],
): Map<number, ClubIdentity> {
  const byCountry = new Map<string, number[]>();
  for (const t of league.teams) {
    const country = competitionOf(competitions, t.compId).country;
    const tids = byCountry.get(country) ?? [];
    tids.push(t.tid);
    byCountry.set(country, tids);
  }
  const out = new Map<number, ClubIdentity>();
  for (const [country, tids] of byCountry) {
    const identities = clubIdentitiesFor(country, tids.length);
    tids.sort((a, b) => a - b).forEach((tid, i) => out.set(tid, identities[i]));
  }
  return out;
}

export function assignIdentities(
  league: League,
  competitions: Competition[],
  userTid = -1,
  difficulty: Difficulty | undefined = undefined,
): StoredTeam[] {
  const salaryMap = new Map(league.players.map((p) => [p.pid, p.contract.salary]));
  const openingScale = difficultyProfile(difficulty).budgetScale;
  const identities = clubIdentities(league, competitions);
  return league.teams.map((t) => {
    const club = identities.get(t.tid)!;
    const opening = chargeSeasonStart(0, wageBill(t.roster, salaryMap), financeScale(competitions, t.compId), HYPE_INITIAL);
    const budget = t.tid === userTid && opening > 0 ? Math.round(opening * openingScale) : opening;
    return {
      tid: t.tid,
      name: club.name,
      abbrev: club.abbrev,
      colors: club.colors,
      roster: t.roster,
      academyRoster: [],
      // Set at creation to match what migrate.ts backfills, so a save's
      // round trip through the database is an identity rather than gaining
      // two fields on load (leagueDb.test.ts compares the whole team).
      // The first real trial group arrives at the first offseason.
      scoutingRegions: [],
      scoutingPositions: [],
      budget,
      hype: HYPE_INITIAL,
      scoutingSpend: clampScoutingSpend(SCOUTING_SPEND_DEFAULT, budget),
      nextScoutingSpend: clampScoutingSpend(SCOUTING_SPEND_DEFAULT, budget),
      academyBase: t.academyBase,
      compId: t.compId,
      divisionConvergence: null,
      formation: "4-3-3",
      starters: null,
      transferListed: [],
      moreMinutes: [],
      scoutingObserved: {},
    };
  });
}

/**
 * Point every AI club at the formation that fields its strongest XI (via
 * chooseBestFormation on its current roster). The user's own club is skipped —
 * they pick their formation manually — so this is safe to re-run each offseason
 * without ever overwriting a user choice. Called at league creation and once
 * per offseason on the settled rosters.
 */
export function assignAIFormations(
  teams: StoredTeam[],
  players: Player[],
  userTid: number,
): StoredTeam[] {
  const byPid = new Map(players.map((p) => [p.pid, p]));
  return teams.map((t) => {
    if (t.tid === userTid) return t;
    const roster = t.roster
      .map((pid) => byPid.get(pid))
      .filter((p): p is Player => p !== undefined);
    return { ...t, formation: chooseBestFormation(roster) };
  });
}
