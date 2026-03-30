// scraper.js — à lancer avec : node scraper.js
import * as cheerio from 'cheerio';
import { writeFileSync } from 'fs';

const URL = 'https://www.pokebip.com/page/jeux-video/pokemon-pokopia/pokedex';

const res = await fetch(URL);
const html = await res.text();
const $ = cheerio.load(html);

const pokemons = [];

$('table tr').each((i, row) => {
  const cells = $(row).find('td');
  if (cells.length < 5) return;

  const numText   = $(cells[0]).text().trim();          // "1", "2"...
  const nameText  = $(cells[1]).text().trim();          // "Bulbizarre"
  const imgSrc    = $(cells[1]).find('img').attr('src'); // URL image
  const habitats  = $(cells[3]).text().trim()
                    .split('\n').map(h => h.trim()).filter(Boolean);
  const specs     = $(cells[4]).text().trim()
                    .split('\n').map(s => s.trim()).filter(Boolean);

  // Extraire le vrai numéro Pokédex depuis l'attribut alt de l'image
  const imgAlt = $(cells[1]).find('img').attr('alt') || '';
  const pokedexId = imgAlt.replace('Pokémon #', '').trim() || numText;

  pokemons.push({
    id: parseInt(numText),
    pokedexId,
    nom: nameText.replace(/^Pokémon #[\w]+ /, '').trim(),
    image: imgSrc
      ? `https://www.pokebip.com${imgSrc}`
      : `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokedexId}.png`,
    habitats,
    materiaux: specs, // spécialités = rôles/matériaux dans Pokopia
    trouve: false
  });
});

writeFileSync('pokemon.json', JSON.stringify(pokemons, null, 2));
console.log(`${pokemons.length} Pokémon exportés !`);