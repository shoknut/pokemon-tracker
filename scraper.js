/**
 * Pokopia Scraper — pokebip.com
 * Récupère : nom, image, habitats + image habitat, matériaux
 * Usage : node scraper.mjs
 */

import * as cheerio from 'cheerio';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const BASE     = 'https://www.pokebip.com';
const POKEDEX  = `${BASE}/page/jeux-video/pokemon-pokopia/pokedex`;
const HEADERS  = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
const DELAY_MS = 400;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function toSlug(nom) {
  return nom.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '-');
}

async function fetchPage(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.text();
}

async function scrapePokemonList() {
  console.log('📋 Récupération de la liste des Pokémon...');
  const html = await fetchPage(POKEDEX);
  const $ = cheerio.load(html);
  const pokemons = [];

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
      const match = imgSrc.match(/\/(\w+)\.png$/);
      pokedexId = match ? match[1] : numText;
    }

    let image = imgSrc
      ? (imgSrc.startsWith('http') ? imgSrc : `${BASE}${imgSrc}`)
      : `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokedexId}.png`;

    const habitats = $(cells[3]).text().trim()
      .split('\n').map(h => h.trim()).filter(Boolean);
    const materiaux = $(cells[4]).text().trim()
      .split('\n').map(s => s.trim()).filter(Boolean);

    pokemons.push({
      id: parseInt(numText) || i,
      pokedexId,
      nom,
      slug: toSlug(nom),
      image,
      habitats,
      habitatImages: {},
      materiaux,
      trouve: false
    });
  });

  console.log(`✅ ${pokemons.length} Pokémon trouvés`);
  return pokemons;
}

async function scrapeHabitatImages(pokemon) {
  const url = `${BASE}/pokedex/pokopia/pokemon/${pokemon.slug}`;
  try {
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const habitatImages = {};

    // Méthode 1 : alt = nom de l'habitat
    $('img[src*="/pokopia/habitats/"]').each((_, img) => {
      const src = $(img).attr('src') || '';
      const alt = $(img).attr('alt') || '';
      const fullSrc = src.startsWith('http') ? src : `${BASE}${src}`;
      if (alt && pokemon.habitats.includes(alt)) {
        habitatImages[alt] = fullSrc;
      }
    });

    // Méthode 2 : si pas de match par alt, associer dans l'ordre
    if (Object.keys(habitatImages).length === 0) {
      const imgs = [];
      $('img[src*="/pokopia/habitats/"]').each((_, img) => {
        const src = $(img).attr('src') || '';
        imgs.push(src.startsWith('http') ? src : `${BASE}${src}`);
      });
      pokemon.habitats.forEach((hab, i) => {
        if (imgs[i]) habitatImages[hab] = imgs[i];
      });
    }

    return habitatImages;
  } catch(e) {
    console.warn(`  ⚠️  ${pokemon.slug}: ${e.message}`);
    return {};
  }
}

async function main() {
  let existing = {};
  if (existsSync('pokemon.json')) {
    try {
      const data = JSON.parse(readFileSync('pokemon.json', 'utf8'));
      data.forEach(p => { existing[p.id] = p; });
      console.log(`📂 ${data.length} Pokémon déjà en cache`);
    } catch {}
  }

  const pokemons = await scrapePokemonList();

  console.log('\n🖼️  Récupération des images d\'habitats...');
  for (let i = 0; i < pokemons.length; i++) {
    const p = pokemons[i];

    if (existing[p.id]?.habitatImages && Object.keys(existing[p.id].habitatImages).length > 0) {
      p.habitatImages = existing[p.id].habitatImages;
      p.trouve = existing[p.id].trouve || false;
      process.stdout.write(`  ⏩ #${p.id} ${p.nom} (cache)\n`);
      continue;
    }

    process.stdout.write(`  🔍 [${i+1}/${pokemons.length}] ${p.nom}...`);
    p.habitatImages = await scrapeHabitatImages(p);
    const count = Object.keys(p.habitatImages).length;
    process.stdout.write(` ${count} image(s)\n`);

    if ((i + 1) % 10 === 0) {
      writeFileSync('pokemon.json', JSON.stringify(pokemons, null, 2));
      console.log(`  💾 Sauvegarde intermédiaire (${i+1}/${pokemons.length})`);
    }

    await sleep(DELAY_MS);
  }

  writeFileSync('pokemon.json', JSON.stringify(pokemons, null, 2));
  const withImages = pokemons.filter(p => Object.keys(p.habitatImages).length > 0).length;
  console.log(`\n✅ ${pokemons.length} Pokémon | 🖼️ ${withImages} avec images d'habitat`);
}

main().catch(console.error);
