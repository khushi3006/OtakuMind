const fs = require('fs');

const data = fs.readFileSync('raw_anime_data.txt', 'utf-8');
const lines = data.split('\n');

const result = [];
for (let line of lines) {
  line = line.trim();
  if (!line) continue;
  const match = line.match(/^(\d+)\.\s+(.*?)(?:\s*\((.*)\))?$/);
  if (match) {
    result.push({
      id: parseInt(match[1]),
      title: match[2].trim(),
      details: match[3] ? match[3].trim() : null
    });
  }
}

console.log(`Parsed ${result.length} items.`);
console.log(result.slice(0, 10));
console.log(result.slice(595, 605));
