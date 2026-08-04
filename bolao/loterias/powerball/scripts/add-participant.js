#!/usr/bin/env node

/**
 * Script para injetar novos participantes na próxima rodada do Powerball pool
 *
 * Uso:
 *   node add-participant.js --draw-id 2026-08-05 --name "John Doe" --email "john@example.com"
 *   node add-participant.js --draw-id 2026-08-05 --csv participants.csv
 *
 * CSV Format:
 *   name,email
 *   John Doe,john@example.com
 *   Jane Smith,jane@example.com
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parse/sync');

// Parse arguments
const args = process.argv.slice(2);
const argMap = {};

for (let i = 0; i < args.length; i += 2) {
  if (args[i].startsWith('--')) {
    argMap[args[i].substring(2)] = args[i + 1];
  }
}

const drawId = argMap['draw-id'];
const name = argMap['name'];
const email = argMap['email'];
const csvPath = argMap['csv'];

if (!drawId) {
  console.error('❌ Error: --draw-id is required');
  console.error('Usage: node add-participant.js --draw-id 2026-08-05 --name "John" --email "john@example.com"');
  process.exit(1);
}

// Load data.js
const dataPath = path.join(__dirname, '..', 'js', 'data.js');
let dataContent = fs.readFileSync(dataPath, 'utf8');

// Parse current participants
const drawMatch = dataContent.match(
  new RegExp(`{[\\s\\S]*?id:\\s*"${drawId}"[\\s\\S]*?participants:\\s*\\[(.*?)\\]`, 'm')
);

if (!drawMatch) {
  console.error(`❌ Error: Draw ${drawId} not found in data.js`);
  process.exit(1);
}

const participantsStr = drawMatch[1];
const newParticipants = [];

// Process CSV or single entry
if (csvPath) {
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ Error: CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  const records = csv.parse(fs.readFileSync(csvPath), {
    columns: true,
    skip_empty_lines: true
  });

  records.forEach(r => {
    if (r.name && r.email) {
      newParticipants.push({
        name: r.name.trim(),
        email: r.email.trim()
      });
    }
  });
} else if (name && email) {
  newParticipants.push({ name, email });
} else {
  console.error('❌ Error: Either --csv or (--name AND --email) required');
  process.exit(1);
}

// Validate emails
const invalidEmails = newParticipants.filter(p => !p.email.includes('@'));
if (invalidEmails.length > 0) {
  console.warn(`⚠️  Warning: ${invalidEmails.length} participant(s) have invalid emails:`);
  invalidEmails.forEach(p => console.warn(`   - ${p.name}: ${p.email}`));
  process.exit(1);
}

// Check for duplicates
const existingNames = participantsStr.match(/name:\s*"([^"]+)"/g) || [];
const duplicates = newParticipants.filter(p =>
  existingNames.some(n => n.includes(p.name))
);

if (duplicates.length > 0) {
  console.error(`❌ Error: ${duplicates.length} participant(s) already exist:`);
  duplicates.forEach(p => console.error(`   - ${p.name}`));
  process.exit(1);
}

// Build new participant objects
const participantStrings = newParticipants.map(p => `
      { name: "${p.name}", email: "${p.email}", cotas: null, valor: null, metodo: "Saldo anterior", data: "${new Date().toLocaleDateString('pt-BR')}", hora: "—", txId: "—", status: "recorrente" }`);

// Insert before closing bracket
const newParticipantsSection = participantStrings.join(',');
const oldClosing = participantsStr.split('\n').pop();
const newParticipantsStr = participantsStr + ',' + newParticipantsSection;

const oldPattern = new RegExp(
  `(id:\\s*"${drawId}"[\\s\\S]*?participants:\\s*\\[)([\\s\\S]*?)(\\n\\s*\\],)`,
  'm'
);

const updated = dataContent.replace(
  oldPattern,
  `$1${newParticipantsStr}$3`
);

// Write back
fs.writeFileSync(dataPath, updated);

console.log(`✅ Added ${newParticipants.length} participant(s) to draw ${drawId}:`);
newParticipants.forEach(p => {
  console.log(`   ✓ ${p.name} (${p.email})`);
});

console.log(`\n📝 Next steps:`);
console.log(`   1. Verify changes: cat js/data.js | grep -A 20 "id: \\"${drawId}\\""  `);
console.log(`   2. Run audit: python3 ../scripts/audit_scoring.py`);
console.log(`   3. Commit: git add js/data.js && git commit -m "Add ${newParticipants.length} new participant(s)"`);
