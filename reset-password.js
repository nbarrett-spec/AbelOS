const bcrypt = require('./node_modules/bcryptjs');

const password = 'Abel2026!';
const saltRounds = 12;
const email = 'n.barrett@abellumber.com';

bcrypt.hash(password, saltRounds, (err, hash) => {
  if (err) {
    console.error('Error generating hash:', err);
    process.exit(1);
  }

  console.log('\n========== PASSWORD HASH GENERATED ==========\n');
  console.log('Password:', password);
  console.log('Salt Rounds:', saltRounds);
  console.log('Hash:', hash);
  console.log('\n========== SQL UPDATE STATEMENT ==========\n');
  console.log(`UPDATE "Staff" SET "passwordHash" = '${hash}' WHERE "email" = '${email}';`);
  console.log('\n' + '='.repeat(42) + '\n');
});
