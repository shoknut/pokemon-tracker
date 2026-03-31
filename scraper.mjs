/**
 * Pokopia Scraper v4 — pokebip.com
 * Horaires et météo stockés comme URLs d'icônes
 * Usage : node scraper.mjs
 */

import * as cheerio from 'cheerio';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const BASE    = 'https://www.pokebip.com';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
const DELAY   = 500;

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

// Icônes horaires
const HORAIRES_ICONS = {
  'matin':    `${BASE}/pokedex-images/pokopia/horaires/matin.png`,
  'journée':  `${BASE}/pokedex-images/pokopia/horaires/journee.png`,
  'journee':  `${BASE}/pokedex-images/pokopia/horaires/journee.png`,
  'soir':     `${BASE}/pokedex-images/pokopia/horaires/soir.png`,
  'nuit':     `${BASE}/pokedex-images/pokopia/horaires/nuit.png`,
};

// Icônes météo
const METEO_ICONS = {
  'ensoleillé':  `${BASE}/pokedex-images/pokopia/meteo/soleil.png`,
  'ensoleillee': `${BASE}/pokedex-images/pokopia/meteo/soleil.png`,
  'couvert':     `${BASE}/pokedex-images/pokopia/meteo/nuageux.png`,
  'pluie':       `${BASE}/pokedex-images/pokopia/meteo/pluie.png`,
  'neige':       `${BASE}/pokedex-images/pokopia/meteo/neige.png`,
};

function parseHoraires(text) {
  const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const result = [];
  for (const [key, icon] of Object.entries(HORAIRES_ICONS)) {
    const kNorm = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (t.includes(kNorm) && !result.find(r => r.icon === icon)) {
      result.push({ label: key.charAt(0).toUpperCase() + key.slice(1), icon });
    }
  }
  return result;
}

function parseMeteo(text) {
  const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const result = [];
  for (const [key, icon] of Object.entries(METEO_ICONS)) {
    const kNorm = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (t.includes(kNorm) && !result.find(r => r.icon === icon)) {
      result.push({ label: key.charAt(0).toUpperCase() + key.slice(1), icon });
    }
  }
  return result;
}

// Rareté → nombre d'étoiles
function parseRarete(text) {
  const t = text.toLowerCase().trim();
  if (t.includes('très rare')) return { label: 'Très rare', etoiles: 3 };
  if (t.includes('rare'))      return { label: 'Rare',      etoiles: 2 };
  if (t.includes('commun'))    return { label: 'Commun',    etoiles: 1 };
  return { label: text.trim(), etoiles: 0 };
}

// ── Étape 1 : liste depuis le Pokédex ──
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

    const materiaux = $(cells[4]).text().trim()
      .split('\n').map(s => s.trim()).filter(Boolean);

    list.push({ id: parseInt(numText) || i, pokedexId, nom, slug: toSlug(nom), image, materiaux });
  });

  console.log(`✅ ${list.length} Pokémon`);
  return list;
}

// ── Étape 2 : page individuelle ──
async function scrapeDetail(pokemon) {
  const url  = `${BASE}/pokedex/pokopia/pokemon/${pokemon.slug}`;
  const html = await fetchPage(url);
  const $    = cheerio.load(html);

  const habitatsData = [];
  const seen = new Set();

  // Repère tous les titres "Habitat : N°XXX - Nom"
  const habitatTitles = [];
  $('*').each((_, el) => {
    if ($(el).children().length > 0) return;
    const t = $(el).text().trim();
    if (t.match(/^Habitat\s*:\s*N°\d+\s*[-–]/)) {
      habitatTitles.push({ el, t });
    }
  });

  for (const { el, t } of habitatTitles) {
    const match = t.match(/Habitat\s*:\s*N°(\d+)\s*[-–]\s*(.+)$/);
    if (!match) continue;
    const nomHabitat = match[2].trim();
    if (seen.has(nomHabitat)) continue;
    seen.add(nomHabitat);

    // Remonter pour trouver le conteneur de la section
    let container = $(el).parent();
    for (let d = 0; d < 6; d++) {
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
        const cleaned = txt
          .replace(/Ressources nécessaires\s*:/gi, '')
          .trim();
        if (cleaned && cleaned.length < 200) ressources = cleaned;
      }
    });

    // Trouver la ligne du Pokémon dans le tableau de l'habitat
    let horaires = [], meteo = [], rarete = { label: '', etoiles: 0 }, zones = '';
    const pokedexNum = `#${String(pokemon.pokedexId).padStart(3, '0')}`;

    container.find('table tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 8) return;

      const numCell = $(cells[0]).text().trim();
      const nomCell = $(cells[2]).text().trim();
      if (!numCell.includes(pokedexNum) && !nomCell.includes(pokemon.nom)) return;

      horaires = parseHoraires($(cells[5]).text());
      meteo    = parseMeteo($(cells[6]).text());
      rarete   = parseRarete($(cells[7]).text());
      zones    = $(cells[8]).text().trim();
    });

    habitatsData.push({ nom: nomHabitat, image, ressources, horaires, meteo, rarete, zones });
  }

  return habitatsData;
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

    // Cache valide : habitats sont des objets avec .nom
    if (cached?.habitats?.length > 0 && cached.habitats[0]?.nom && cached.habitats[0]?.horaires) {
      pokemons.push({ ...base, habitats: cached.habitats, trouve: cached.trouve || false });
      process.stdout.write(`  ⏩ #${base.id} ${base.nom} (cache)\n`);
      continue;
    }

    process.stdout.write(`  [${i+1}/${list.length}] ${base.nom}... `);
    try {
      const habitats = await scrapeDetail(base);
      pokemons.push({ ...base, habitats, trouve: cached?.trouve || false });
      process.stdout.write(`✅ ${habitats.length} habitat(s)\n`);
    } catch(e) {
      process.stdout.write(`⚠️  ${e.message}\n`);
      pokemons.push({ ...base, habitats: [], trouve: false });
    }

    if ((i + 1) % 10 === 0) {
      writeFileSync('pokemon.json', JSON.stringify(pokemons, null, 2));
      process.stdout.write(`  💾 Sauvegarde (${i+1}/${list.length})\n`);
    }

    await sleep(DELAY);
  }

  writeFileSync('pokemon.json', JSON.stringify(pokemons, null, 2));
  const withHab = pokemons.filter(p => p.habitats.length > 0).length;
  console.log(`\n✅ ${pokemons.length} Pokémon | 🏕️ ${withHab} avec habitats`);
  console.log('📁 pokemon.json généré !');
}

main().catch(console.error);
