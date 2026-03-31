/**
 * Pokopia Scraper v5
 * - Matériaux extraits depuis les images alt (page individuelle)
 * - Horaires/météo/rareté/zones extraits depuis les images alt dans les tableaux
 * Usage : node scraper.mjs
 */

import * as cheerio from 'cheerio';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const BASE    = 'https://www.pokebip.com';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
const DELAY   = 500;
const sleep   = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function toSlug(nom) {
  return nom.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

// ── Icônes horaires et météo ──
const HORAIRES_MAP = {
  'matin':    { label: 'Matin',    icon: `${BASE}/pokedex-images/pokopia/horaires/matin.png` },
  'journee':  { label: 'Journée',  icon: `${BASE}/pokedex-images/pokopia/horaires/journee.png` },
  'journée':  { label: 'Journée',  icon: `${BASE}/pokedex-images/pokopia/horaires/journee.png` },
  'soir':     { label: 'Soir',     icon: `${BASE}/pokedex-images/pokopia/horaires/soir.png` },
  'nuit':     { label: 'Nuit',     icon: `${BASE}/pokedex-images/pokopia/horaires/nuit.png` },
};
const METEO_MAP = {
  'ensoleille':  { label: 'Ensoleillé', icon: `${BASE}/pokedex-images/pokopia/meteo/soleil.png` },
  'ensoleillé':  { label: 'Ensoleillé', icon: `${BASE}/pokedex-images/pokopia/meteo/soleil.png` },
  'couvert':     { label: 'Couvert',    icon: `${BASE}/pokedex-images/pokopia/meteo/nuageux.png` },
  'pluie':       { label: 'Pluie',      icon: `${BASE}/pokedex-images/pokopia/meteo/pluie.png` },
  'neige':       { label: 'Neige',      icon: `${BASE}/pokedex-images/pokopia/meteo/neige.png` },
};

// Normalise une chaîne pour comparaison
function norm(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// Extrait horaires depuis les alt d'images dans une cellule
function extractHoraires($, cell) {
  const result = [];
  const seen = new Set();
  $(cell).find('img').each((_, img) => {
    const alt = norm($(img).attr('alt') || '');
    for (const [key, val] of Object.entries(HORAIRES_MAP)) {
      if (alt.includes(norm(key)) && !seen.has(val.icon)) {
        result.push(val); seen.add(val.icon);
      }
    }
  });
  // Fallback : texte brut
  if (!result.length) {
    const txt = norm($(cell).text());
    for (const [key, val] of Object.entries(HORAIRES_MAP)) {
      if (txt.includes(norm(key)) && !seen.has(val.icon)) {
        result.push(val); seen.add(val.icon);
      }
    }
  }
  return result;
}

function extractMeteo($, cell) {
  const result = [];
  const seen = new Set();
  $(cell).find('img').each((_, img) => {
    const alt = norm($(img).attr('alt') || '');
    for (const [key, val] of Object.entries(METEO_MAP)) {
      if (alt.includes(norm(key)) && !seen.has(val.icon)) {
        result.push(val); seen.add(val.icon);
      }
    }
  });
  if (!result.length) {
    const txt = norm($(cell).text());
    for (const [key, val] of Object.entries(METEO_MAP)) {
      if (txt.includes(norm(key)) && !seen.has(val.icon)) {
        result.push(val); seen.add(val.icon);
      }
    }
  }
  return result;
}

function parseRarete(text) {
  const t = norm(text);
  if (t.includes('tres rare') || t.includes('très rare')) return { label: 'Très rare', etoiles: 3 };
  if (t.includes('rare'))   return { label: 'Rare',    etoiles: 2 };
  if (t.includes('commun')) return { label: 'Commun',  etoiles: 1 };
  return { label: text.trim(), etoiles: 0 };
}

// Toutes les zones connues
const ZONES_KNOWN = ['Toutes', 'Île-Nuage', 'Ville-Nouvelle', 'Grisemer', 'Terrassec', 'Collinangle', 'Flotîle-Millefeux'];
function parseZones(text) {
  const t = norm(text);
  const found = ZONES_KNOWN.filter(z => t.includes(norm(z)));
  if (found.length) return found.join(', ');
  return text.trim();
}

// ── Étape 1 : liste depuis le Pokédex (sans matériaux — on les récupère en détail) ──
async function scrapePokemonList() {
  console.log('📋 Récupération de la liste...');
  const html = await fetchPage(`${BASE}/page/jeux-video/pokemon-pokopia/pokedex`);
  const $    = cheerio.load(html);
  const list = [];

  $('table tr').each((i, row) => {
    const cells = $(row).find('td');
    if (cells.length < 5) return;

    const numText  = $(cells[0]).text().trim();
    const nameCell = $(cells[1]);
    const imgEl    = nameCell.find('img');
    const imgSrc   = imgEl.attr('src') || '';
    const imgAlt   = imgEl.attr('alt') || '';

    let nom = nameCell.text().trim().replace(/^Pokémon\s+#[\w]+\s+/, '').trim();
    if (!nom) return;

    let pokedexId = imgAlt.replace('Pokémon #', '').trim();
    if (!pokedexId) {
      const m = imgSrc.match(/\/(\w+)\.png/);
      pokedexId = m ? m[1] : numText;
    }

    const image = imgSrc
      ? (imgSrc.startsWith('http') ? imgSrc : `${BASE}${imgSrc}`)
      : `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokedexId}.png`;

    list.push({ id: parseInt(numText) || i, pokedexId, nom, slug: toSlug(nom), image });
  });

  console.log(`✅ ${list.length} Pokémon`);
  return list;
}

// ── Étape 2 : page individuelle ──
async function scrapeDetail(pokemon) {
  const url  = `${BASE}/pokedex/pokopia/pokemon/${pokemon.slug}`;
  const html = await fetchPage(url);
  const $    = cheerio.load(html);

  // ── Matériaux : extraits des alt d'images de spécialités ──
  const materiaux = [];
  $('img[src*="/pokopia/specialites/"]').each((_, img) => {
    const alt = $(img).attr('title') || $(img).attr('alt') || '';
    if (alt && !materiaux.includes(alt)) materiaux.push(alt);
  });

  // ── Habitats ──
  const habitatsData = [];
  const seen = new Set();

  // Trouver tous les titres "Habitat : N°XXX - Nom"
  // On cherche dans les noeuds texte directs
  const habitatTitles = [];
  $('*').contents().each((_, node) => {
    if (node.type !== 'text') return;
    const t = (node.data || '').trim();
    const m = t.match(/^Habitat\s*:\s*N°(\d+)\s*[-–]\s*(.+)$/);
    if (m) habitatTitles.push({ node, num: m[1], nom: m[2].trim() });
  });

  // Fallback : chercher dans les éléments non-feuille aussi
  if (!habitatTitles.length) {
    $('*').each((_, el) => {
      if ($(el).children().length > 0) return;
      const t = $(el).text().trim();
      const m = t.match(/^Habitat\s*:\s*N°(\d+)\s*[-–]\s*(.+)$/);
      if (m) habitatTitles.push({ el, num: m[1], nom: m[2].trim() });
    });
  }

  for (const title of habitatTitles) {
    const nomHabitat = title.nom;
    if (seen.has(nomHabitat)) continue;
    seen.add(nomHabitat);

    // Remonter pour trouver le conteneur de la section habitat
    let container = title.el ? $(title.el).parent() : $(title.node.parent);
    for (let d = 0; d < 8; d++) {
      if (container.find('img[src*="/pokopia/habitats/"]').length > 0) break;
      container = container.parent();
    }

    // Image habitat
    const imgSrc = container.find('img[src*="/pokopia/habitats/"]').first().attr('src') || '';
    const image  = imgSrc ? (imgSrc.startsWith('http') ? imgSrc : `${BASE}${imgSrc}`) : '';

    // Ressources nécessaires
    let ressources = '';
    container.find('*').each((_, node) => {
      const txt = $(node).text();
      if (txt.includes('Ressources nécessaires')) {
        const cleaned = txt.replace(/Ressources nécessaires\s*:/gi, '').trim();
        if (cleaned && cleaned.length < 300 && !cleaned.includes('\n\n')) {
          ressources = cleaned.replace(/\s+/g, ' ').trim();
        }
      }
    });

    // Trouver la ligne du Pokémon dans le tableau habitat
    let horaires = [], meteo = [], rarete = { label: '', etoiles: 0 }, zones = '';
    const pokedexNum = `#${String(pokemon.pokedexId).padStart(3, '0')}`;

    container.find('table tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 8) return;

      const numCell = $(cells[0]).text().trim();
      const nomCell = $(cells[2]).text().trim();

      // Match par numéro ou par nom
      const matchNum = numCell.includes(pokedexNum);
      const matchNom = nomCell.toLowerCase().includes(pokemon.nom.toLowerCase());
      if (!matchNum && !matchNom) return;

      horaires = extractHoraires($, cells[5]);
      meteo    = extractMeteo($, cells[6]);
      rarete   = parseRarete($(cells[7]).text());
      zones    = parseZones($(cells[8]).text());
    });

    habitatsData.push({ nom: nomHabitat, image, ressources, horaires, meteo, rarete, zones });
  }

  return { materiaux, habitats: habitatsData };
}

// ── MAIN ──
async function main() {
  let cache = {};
  if (existsSync('pokemon.json')) {
    try {
      JSON.parse(readFileSync('pokemon.json', 'utf8'))
        .forEach(p => { cache[p.id] = p; });
      console.log(`📂 Cache : ${Object.keys(cache).length} Pokémon`);
    } catch {}
  }

  const list = await scrapePokemonList();
  console.log('\n🔍 Scraping des pages individuelles...\n');

  const pokemons = [];

  for (let i = 0; i < list.length; i++) {
    const base   = list[i];
    const cached = cache[base.id];

    // Cache valide : matériaux propres + habitats avec horaires
    const cacheOk = cached?.materiaux?.length > 0
      && !cached.materiaux[0]?.includes(cached.materiaux[1] || 'NOPE') // pas collés
      && cached?.habitats?.length > 0
      && cached.habitats[0]?.horaires?.length > 0;

    if (cacheOk) {
      pokemons.push({ ...base, materiaux: cached.materiaux, habitats: cached.habitats, trouve: cached.trouve || false });
      process.stdout.write(`  ⏩ #${base.id} ${base.nom} (cache)\n`);
      continue;
    }

    process.stdout.write(`  [${i+1}/${list.length}] ${base.nom}... `);
    try {
      const { materiaux, habitats } = await scrapeDetail(base);
      pokemons.push({ ...base, materiaux, habitats, trouve: cached?.trouve || false });
      const habStr = habitats.length > 0
        ? `${habitats.length} hab, ${habitats[0]?.horaires?.length || 0} horaires`
        : '0 hab';
      process.stdout.write(`✅ ${materiaux.length} mat | ${habStr}\n`);
    } catch(e) {
      process.stdout.write(`⚠️  ${e.message}\n`);
      pokemons.push({ ...base, materiaux: [], habitats: [], trouve: false });
    }

    if ((i + 1) % 10 === 0) {
      writeFileSync('pokemon.json', JSON.stringify(pokemons, null, 2));
      process.stdout.write(`  💾 Sauvegarde (${i+1}/${list.length})\n`);
    }

    await sleep(DELAY);
  }

  writeFileSync('pokemon.json', JSON.stringify(pokemons, null, 2));

  const withHab  = pokemons.filter(p => p.habitats.length > 0).length;
  const withHor  = pokemons.filter(p => p.habitats[0]?.horaires?.length > 0).length;
  console.log(`\n✅ ${pokemons.length} Pokémon exportés`);
  console.log(`🏕️  ${withHab} avec habitats | ⏰ ${withHor} avec horaires`);
  console.log('📁 pokemon.json généré !');
}

main().catch(console.error);
